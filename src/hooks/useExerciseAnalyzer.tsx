/**
 * useExerciseAnalyzer - Main hook for exercise form analysis
 *
 * Supports multiple exercise types (kettlebell swings, pistol squats, etc.)
 * using the unified InputSession state machine for managing video input.
 *
 * Key features:
 * 1. Single source of truth for input state (InputSession)
 * 2. Cache lookup for frame stepping (no redundant ML inference)
 * 3. Streaming during extraction (reps update live)
 * 4. Cleaner state management (explicit state machine)
 * 5. Auto-detection of exercise type from movement patterns
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DetectedExercise, HudConfig, RepPosition } from '../analyzers';
import {
  getSampleVideos,
  type SampleVideo,
} from '../analyzers/ExerciseRegistry';
import type { Skeleton } from '../models/Skeleton';
import { InputSession, type InputSessionState } from '../pipeline/InputSession';
import type { Pipeline, ThumbnailEvent } from '../pipeline/Pipeline';
import { createPipeline } from '../pipeline/PipelineFactory';
import type { SkeletonEvent } from '../pipeline/PipelineInterfaces';
import type { ExtractionProgress } from '../pipeline/SkeletonSource';
import { fetchAndCacheBundledPoseTrack } from '../services/PoseTrackService';
import {
  recordExtractionComplete,
  recordExtractionStart,
  recordPlaybackPause,
  recordPlaybackStart,
  recordRepDetected,
  recordSkeletonProcessingComplete,
  recordVideoLoad,
  sessionRecorder,
} from '../services/SessionRecorder';
import { ThumbnailQueue } from '../services/ThumbnailGenerator';
import type { AppState } from '../types';
import type { PositionCandidate } from '../types/exercise';
import type { CropRegion } from '../types/posetrack';
import {
  asMetersPerSecond,
  asVideoHeight,
  asVideoWidth,
  DEFAULT_VIDEO_HEIGHT,
  type MetersPerSecond,
  type VideoHeight,
} from '../utils/brandedTypes';
import { calculateStableCropRegion } from '../utils/videoCrop';
import { SkeletonRenderer } from '../viewmodels/SkeletonRenderer';
import { useExerciseDetection } from './useExerciseDetection';
import { useKeyboardNavigation } from './useKeyboardNavigation';
import { useRepNavigation } from './useRepNavigation';
import { calculateCanvasPlacement } from './utils/canvasSyncUtils';
import { estimateSwingPosition, extractHudAngles } from './utils/hudUtils';
import {
  fetchWithProgress,
  getFileNameFromUrl,
  getVideoLoadErrorMessage,
  isLandscapeVideo,
} from './utils/videoLoadingUtils';

// Throttle interval for rep/position sync during playback (see ARCHITECTURE.md "Throttled Playback Sync")
const REP_SYNC_INTERVAL_MS = 1000; // 1 second

export function useExerciseAnalyzer(initialState?: Partial<AppState>) {
  // ========================================
  // Core State
  // ========================================
  const [appState, setAppState] = useState<AppState>({
    displayMode: 'both',
    isModelLoaded: false,
    isProcessing: false,
    repCounter: {
      count: 0,
      isConnect: false,
      lastConnectState: false,
      connectThreshold: 45,
    },
    showBodyParts: true,
    bodyPartDisplayTime: 0.5,
    currentRepIndex: 0,
    ...initialState,
  });

  // UI state
  const [status, setStatus] = useState<string>('Loading...');
  const [repCount, setRepCount] = useState<number>(0);
  const [spineAngle, setSpineAngle] = useState<number>(0);
  const [armToSpineAngle, setArmToSpineAngle] = useState<number>(0);
  const [wristVelocity, setWristVelocity] = useState<MetersPerSecond>(
    asMetersPerSecond(0)
  );
  // Generic angles map for dynamic HUD rendering (exercise-specific)
  const [currentAngles, setCurrentAngles] = useState<Record<string, number>>(
    {}
  );
  const [repThumbnails, setRepThumbnails] = useState<
    Map<number, Map<string, PositionCandidate>>
  >(new Map());
  // Ref to track repThumbnails for non-render access (e.g., crop calculation)
  const repThumbnailsRef = useRef(repThumbnails);
  const [extractionProgress, setExtractionProgress] =
    useState<ExtractionProgress | null>(null);
  const [inputState, setInputState] = useState<InputSessionState>({
    type: 'idle',
  });
  const [hasPosesForCurrentFrame, setHasPosesForCurrentFrame] =
    useState<boolean>(false);
  const [currentPosition, setCurrentPosition] = useState<string | null>(null);

  // Track if we've recorded extraction start for current session (to avoid spam)
  const hasRecordedExtractionStartRef = useRef<boolean>(false);

  // Refs for elements
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const checkpointGridRef = useRef<HTMLDivElement>(null);

  // Core refs
  const inputSessionRef = useRef<InputSession | null>(null);
  const thumbnailQueueRef = useRef<ThumbnailQueue | null>(null);
  const pipelineRef = useRef<Pipeline | null>(null);
  const skeletonRendererRef = useRef<SkeletonRenderer | null>(null);
  const isPlayingRef = useRef<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentVideoFile, setCurrentVideoFile] = useState<File | null>(null);

  // Track current video's object URL for cleanup on video switch
  const currentVideoUrlRef = useRef<string | null>(null);

  // Media dialog loading state
  const [isVideoLoading, setIsVideoLoading] = useState<boolean>(false);
  const [videoLoadProgress, setVideoLoadProgress] = useState<
    number | undefined
  >(undefined);
  const [videoLoadMessage, setVideoLoadMessage] = useState<string>('');
  // Track if we're in the middle of loading a video (to abort on switch)
  const videoLoadAbortControllerRef = useRef<AbortController | null>(null);

  // Track if cache is being processed (between 'active' state and 'batchComplete')
  const [isCacheProcessing, setIsCacheProcessing] = useState<boolean>(false);

  // Throttle for rep/position sync during playback (see ARCHITECTURE.md "Throttled Playback Sync")
  const lastRepSyncTimeRef = useRef<number>(0);

  // Helper callback for setting current rep index (updates appState)
  const setCurrentRepIndexCallback = useCallback(
    (index: number) => {
      if (index < 0 || index >= repCount) return;
      setAppState((prev) => ({
        ...prev,
        currentRepIndex: index,
      }));
    },
    [repCount]
  );

  // ========================================
  // Exercise Detection (extracted hook)
  // ========================================
  const {
    detectedExercise,
    detectionConfidence,
    isDetectionLocked,
    currentPhases,
    workingLeg,
    handleDetectionEvent,
    setExerciseType,
    resetDetectionState,
    handleLegacyDetectionLock,
  } = useExerciseDetection({
    getPhasesFromPipeline: useCallback(
      () => pipelineRef.current?.getFormAnalyzer()?.getPhases() ?? null,
      []
    ),
    setPipelineExerciseType: useCallback(
      (exercise: DetectedExercise) =>
        pipelineRef.current?.setExerciseType(exercise),
      []
    ),
  });

  // ========================================
  // Rep Navigation (extracted hook)
  // ========================================
  const {
    navigateToPreviousRep,
    navigateToNextRep,
    navigateToPreviousCheckpoint,
    navigateToNextCheckpoint,
    repSyncHandlerRef,
  } = useRepNavigation({
    videoRef,
    repThumbnails,
    repCount,
    currentRepIndex: appState.currentRepIndex,
    currentPosition,
    currentPhases,
    setCurrentRepIndex: setCurrentRepIndexCallback,
    setCurrentPosition,
  });

  // Crop state for auto-centering on person in landscape videos
  const [cropRegion, setCropRegionState] = useState<CropRegion | null>(null);
  const [isCropEnabled, setIsCropEnabled] = useState<boolean>(false); // Default to off - user must enable
  const [isLandscape, setIsLandscape] = useState<boolean>(false); // Video aspect ratio > 1.2

  // ========================================
  // Canvas Sync (for skeleton alignment)
  // ========================================
  // Syncs canvas position/size to match video's rendered area.
  // Uses pure utility functions for calculations (see canvasSyncUtils.ts).
  const syncCanvasToVideo = useCallback(
    (isZoomed: boolean, crop: CropRegion | null) => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.videoWidth === 0) return;

      // Update landscape state using extracted utility
      setIsLandscape(isLandscapeVideo(video.videoWidth, video.videoHeight));

      // Set canvas internal dimensions to match video
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      // Get dimensions for calculation
      const videoRect = video.getBoundingClientRect();
      const container = canvas.parentElement;
      const containerRect = container?.getBoundingClientRect();

      const videoOffset = {
        x: containerRect ? videoRect.left - containerRect.left : 0,
        y: containerRect ? videoRect.top - containerRect.top : 0,
      };

      // Clear any transforms first
      canvas.style.transform = '';
      canvas.style.transformOrigin = '';

      // Use extracted pure function for placement calculation
      const placement = calculateCanvasPlacement(
        { videoWidth: video.videoWidth, videoHeight: video.videoHeight },
        { width: videoRect.width, height: videoRect.height },
        videoOffset,
        isZoomed,
        crop
      );

      // Apply placement to canvas
      canvas.style.width = `${placement.width}px`;
      canvas.style.height = `${placement.height}px`;
      canvas.style.left = `${placement.left}px`;
      canvas.style.top = `${placement.top}px`;

      // Apply object-position to video if provided
      if (placement.objectPosition) {
        video.style.objectPosition = placement.objectPosition;
      } else {
        video.style.objectPosition = '';
      }

      console.log(
        `[Canvas] ${isZoomed ? 'Zoomed' : 'Normal'}: ${placement.width.toFixed(0)}x${placement.height.toFixed(0)} at (${placement.left.toFixed(0)},${placement.top.toFixed(0)})`
      );
    },
    []
  );

  // Keep repThumbnails ref in sync with state for non-render access
  useEffect(() => {
    repThumbnailsRef.current = repThumbnails;
  }, [repThumbnails]);

  // Re-sync canvas on window resize
  useEffect(() => {
    const handleResize = () => {
      requestAnimationFrame(() => syncCanvasToVideo(isCropEnabled, cropRegion));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [syncCanvasToVideo, isCropEnabled, cropRegion]);

  // Cleanup Object URL and abort controller on unmount
  useEffect(() => {
    return () => {
      // Revoke any remaining blob URL to prevent memory leak
      if (currentVideoUrlRef.current?.startsWith('blob:')) {
        URL.revokeObjectURL(currentVideoUrlRef.current);
      }
      // Abort any in-flight video load
      videoLoadAbortControllerRef.current?.abort();
    };
  }, []);

  // ========================================
  // Safe Video Loading Helper
  // ========================================
  // Handles all cleanup and race conditions when switching videos
  const loadVideoSafely = useCallback(
    async (
      videoElement: HTMLVideoElement,
      url: string,
      signal: AbortSignal
    ): Promise<void> => {
      // 1. Pause any current playback
      videoElement.pause();
      videoElement.currentTime = 0;

      // 2. Clean up previous object URL if it was a blob URL
      if (currentVideoUrlRef.current?.startsWith('blob:')) {
        URL.revokeObjectURL(currentVideoUrlRef.current);
      }

      // 3. Set new source and track it
      currentVideoUrlRef.current = url;
      videoElement.src = url;

      // 4. Wait for metadata with proper event handling (no property assignment)
      await new Promise<void>((resolve, reject) => {
        // Check if aborted before we even start
        if (signal.aborted) {
          reject(new DOMException('Video load aborted', 'AbortError'));
          return;
        }

        const timeoutId = setTimeout(() => {
          cleanup();
          reject(new Error('Timeout loading video metadata'));
        }, 10000);

        const cleanup = () => {
          clearTimeout(timeoutId);
          videoElement.removeEventListener(
            'loadedmetadata',
            handleLoadedMetadata
          );
          videoElement.removeEventListener('error', handleError);
          signal.removeEventListener('abort', handleAbort);
        };

        const handleLoadedMetadata = () => {
          cleanup();
          // Sync canvas to video after a small delay (wait for layout)
          // Note: At load time, zoom is always off (isCropEnabled=false)
          requestAnimationFrame(() => syncCanvasToVideo(false, null));
          resolve();
        };

        const handleError = () => {
          cleanup();
          const mediaError = videoElement.error;
          let message = 'Failed to load video';
          if (mediaError) {
            switch (mediaError.code) {
              case MediaError.MEDIA_ERR_ABORTED:
                message = 'Video load was aborted';
                break;
              case MediaError.MEDIA_ERR_NETWORK:
                message = 'Network error loading video';
                break;
              case MediaError.MEDIA_ERR_DECODE:
                message = 'Video format could not be decoded';
                break;
              case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
                message = 'Video format not supported';
                break;
            }
          }
          reject(new Error(message));
        };

        const handleAbort = () => {
          cleanup();
          reject(new DOMException('Video load aborted', 'AbortError'));
        };

        // Use addEventListener (not property assignment) to avoid race conditions
        videoElement.addEventListener('loadedmetadata', handleLoadedMetadata, {
          once: true,
        });
        videoElement.addEventListener('error', handleError, { once: true });
        signal.addEventListener('abort', handleAbort, { once: true });
      });
    },
    [syncCanvasToVideo]
  );

  // ========================================
  // Pipeline Setup
  // ========================================
  const initializePipeline = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return null;

    const pipeline = createPipeline(videoRef.current);

    // Initialize thumbnail queue for lazy generation from cached pose tracks
    // Uses a hidden video element to avoid affecting main playback
    if (!thumbnailQueueRef.current) {
      thumbnailQueueRef.current = new ThumbnailQueue();
    }

    // Helper to update state with positions (used by both direct and queued paths)
    const updateThumbnailState = (
      repNumber: number,
      positions: RepPosition[]
    ) => {
      setRepThumbnails((prev) => {
        const updated = new Map(prev);
        const positionMap = new Map<string, PositionCandidate>();
        for (const pos of positions) {
          positionMap.set(pos.name, {
            position: pos.name,
            timestamp: pos.timestamp,
            videoTime: pos.videoTime,
            angles: pos.angles,
            score: pos.score,
            frameImage: pos.frameImage,
          });
        }
        updated.set(repNumber, positionMap);
        return updated;
      });
    };

    // Subscribe to thumbnail events
    // Uses ThumbnailQueue for lazy generation when loading from cached pose tracks
    pipeline.getThumbnailEvents().subscribe({
      next: (event: ThumbnailEvent) => {
        const needsThumbnails = event.positions.some((p) => !p.frameImage);

        if (needsThumbnails && thumbnailQueueRef.current) {
          // Queue for lazy generation using hidden video element
          // This won't affect main video playback
          thumbnailQueueRef.current.enqueue(
            event.repNumber,
            event.positions,
            updateThumbnailState
          );
        } else {
          // Thumbnails already present (extraction path), update immediately
          updateThumbnailState(event.repNumber, event.positions);
        }
      },
      error: (error) => {
        console.error('Error in thumbnail subscription:', error);
      },
    });

    return pipeline;
  }, []);

  // Initialize skeleton renderer
  useEffect(() => {
    if (!canvasRef.current) return;

    const renderer = new SkeletonRenderer(canvasRef.current);
    skeletonRendererRef.current = renderer;

    return () => {
      // Cleanup renderer if needed
    };
  }, []);

  // ========================================
  // HUD Update Helper
  // ========================================
  // Updates HUD display from a skeleton (called during playback and seek)
  // Uses pure utility functions for calculations (see hudUtils.ts)
  const updateHudFromSkeleton = useCallback(
    (skeleton: Skeleton, _videoTime?: number, precomputedSpeed?: number) => {
      // Get video height for depth calculation
      const videoHeight: VideoHeight = videoRef.current?.videoHeight
        ? asVideoHeight(videoRef.current.videoHeight)
        : DEFAULT_VIDEO_HEIGHT;

      // Use extracted pure function for angle calculations
      const angles = extractHudAngles(skeleton, videoHeight, precomputedSpeed);

      // Update legacy individual state (for backwards compatibility)
      setSpineAngle(angles.spineAngle);
      setArmToSpineAngle(angles.armAngle);
      if (precomputedSpeed !== undefined) {
        setWristVelocity(asMetersPerSecond(precomputedSpeed));
      }

      // Update generic angles map for dynamic HUD rendering
      // Convert HudAngles to Record<string, number> for state
      setCurrentAngles({ ...angles });

      // Estimate position from spine angle using extracted pure function
      const position = estimateSwingPosition(angles.spineAngle);
      if (position) {
        setStatus(position);
      }
    },
    []
  );

  // ========================================
  // Skeleton Event Handler
  // ========================================
  // Use a ref to hold the handler so video events can access it stably
  const skeletonHandlerRef = useRef<((event: SkeletonEvent) => void) | null>(
    null
  );

  // Track previous rep count for detecting new reps
  const prevRepCountRef = useRef<number>(0);
  // Track frame index for debugging
  const frameIndexRef = useRef<number>(0);
  // Track consecutive processing errors (for user feedback when analysis is degraded)
  const consecutiveErrorsRef = useRef<number>(0);
  const MAX_CONSECUTIVE_ERRORS = 5;

  // Process a skeleton event through the pipeline and update UI
  const processSkeletonEvent = useCallback((event: SkeletonEvent) => {
    if (!event.skeleton) {
      return;
    }

    const pipeline = pipelineRef.current;
    if (!pipeline) {
      return;
    }

    // Process through pipeline (updates rep count, form state, etc.)
    let result: number;
    try {
      result = pipeline.processSkeletonEvent(event);
      // Reset error count on success
      consecutiveErrorsRef.current = 0;
    } catch (error) {
      console.error('[processSkeletonEvent] Pipeline processing error:', error);
      consecutiveErrorsRef.current++;

      // Surface degraded analysis to user after multiple consecutive errors
      if (consecutiveErrorsRef.current === MAX_CONSECUTIVE_ERRORS) {
        setStatus('Analysis experiencing errors - some frames may be skipped');
      }
      return; // Don't crash component, just skip this frame
    }

    // Increment frame counter
    frameIndexRef.current++;
    const frameIndex = frameIndexRef.current;

    // Record rep detection event when rep count increases
    if (result > prevRepCountRef.current) {
      const skeleton = event.skeleton;
      const formAnalyzer = pipeline.getFormAnalyzer();
      // Algorithm always uses right arm - for left-handed users, mirror input data
      recordRepDetected(result, {
        frameIndex,
        videoTime: event.poseEvent.frameEvent.videoTime,
        angles: {
          spine: skeleton.getSpineAngle(),
          arm: skeleton.getArmToSpineAngle(),
          armToVertical: skeleton.getArmToVerticalAngle('right'),
          hip: skeleton.getHipAngle(),
        },
        phase: formAnalyzer.getPhase(),
      });
      prevRepCountRef.current = result;
    }

    // Debug: log every 100 frames and on rep changes
    if (
      event.poseEvent.frameEvent.videoTime !== undefined &&
      Math.floor(event.poseEvent.frameEvent.videoTime * 30) % 100 === 0
    ) {
      console.log(
        `[processSkeletonEvent] videoTime=${event.poseEvent.frameEvent.videoTime?.toFixed(2)}, repCount=${result}`
      );
    }

    // Update rep count (cumulative across all extracted frames)
    setRepCount(result);

    // NOTE: Do NOT update spineAngle/armToSpineAngle here!
    // This is called for every extraction frame, but the visible video isn't synced
    // to extraction. HUD angles should only reflect video.currentTime, updated via
    // updateHudFromSkeleton() during playback/seek.
  }, []);

  // ========================================
  // InputSession Setup
  // ========================================
  useEffect(() => {
    if (!videoRef.current || !canvasRef.current) return;

    // Initialize pipeline
    const pipeline = initializePipeline();
    if (!pipeline) return;
    pipelineRef.current = pipeline;

    // Create input session
    const session = new InputSession({
      videoElement: videoRef.current,
      canvasElement: canvasRef.current,
    });
    inputSessionRef.current = session;

    // Subscribe to session state
    const stateSubscription = session.state$.subscribe((state) => {
      setInputState(state);

      // Update app state based on session state
      if (state.type === 'video-file') {
        if (state.sourceState.type === 'extracting') {
          setStatus('Extracting poses...');
          // Cache wasn't found, clear the cache processing state
          setIsCacheProcessing(false);
          // Record extraction start only once per extraction session
          if (!hasRecordedExtractionStartRef.current) {
            hasRecordedExtractionStartRef.current = true;
            recordExtractionStart({ fileName: state.fileName });
          }
        } else if (state.sourceState.type === 'active') {
          setStatus('Ready');
          // Record extraction complete (only if we recorded start)
          if (hasRecordedExtractionStartRef.current) {
            recordExtractionComplete({ fileName: state.fileName });
          }
          // Record skeleton processing complete (for both extraction and cache load)
          const sourceState = state.sourceState as {
            batchComplete?: boolean;
            framesProcessed?: number;
            processingTimeMs?: number;
          };
          if (sourceState.batchComplete) {
            recordSkeletonProcessingComplete({
              framesProcessed: sourceState.framesProcessed ?? 0,
              finalRepCount: pipelineRef.current?.getRepCount() ?? 0,
              processingTimeMs: sourceState.processingTimeMs,
              totalFramesProcessed: frameIndexRef.current,
            });
            // Reset counters for next video
            prevRepCountRef.current = 0;
            frameIndexRef.current = 0;
            // Cache processing complete - clear the loading state
            setIsCacheProcessing(false);

            // Calculate crop region after batch complete (uses rep frames when available)
            const videoSource = session.getVideoFileSource();
            const poseTrack = videoSource?.getPoseTrack();
            if (poseTrack && poseTrack.frames.length > 0) {
              const { videoWidth, videoHeight } = poseTrack.metadata;

              // Get frames at rep position times (from repThumbnails ref)
              // Fall back to first 60 frames if no reps detected yet
              let sampleFrames = poseTrack.frames.slice(0, 60);

              // Read current repThumbnails from ref (synced via useEffect)
              const currentThumbnails = repThumbnailsRef.current;
              if (currentThumbnails.size > 0) {
                const repFrameIndices: number[] = [];
                currentThumbnails.forEach((positions) => {
                  positions.forEach((candidate) => {
                    if (candidate.videoTime !== undefined) {
                      // Find frame index closest to this video time
                      const fps = poseTrack.metadata.fps || 30;
                      const frameIndex = Math.round(candidate.videoTime * fps);
                      if (
                        frameIndex >= 0 &&
                        frameIndex < poseTrack.frames.length
                      ) {
                        repFrameIndices.push(frameIndex);
                      }
                    }
                  });
                });

                if (repFrameIndices.length > 0) {
                  sampleFrames = repFrameIndices.map(
                    (i) => poseTrack.frames[i]
                  );
                  console.log(
                    `[Crop] Using ${sampleFrames.length} rep position frames`
                  );
                }
              }

              const crop = calculateStableCropRegion(
                sampleFrames,
                asVideoWidth(videoWidth),
                asVideoHeight(videoHeight)
              );
              setCropRegionState(crop);
              if (crop && pipelineRef.current) {
                pipelineRef.current.setCropRegion(crop);
              }
            }
          }
          // Check if poses exist for current frame (for HUD visibility)
          const video = videoRef.current;
          if (video) {
            const skeletonEvent = session.getSkeletonAtTime(video.currentTime);
            const hasPoses = !!skeletonEvent?.skeleton;
            setHasPosesForCurrentFrame(hasPoses);
            if (skeletonEvent?.skeleton) {
              updateHudFromSkeleton(
                skeletonEvent.skeleton,
                video.currentTime,
                skeletonEvent.precomputedAngles?.wristSpeed
              );
              // Also render skeleton on canvas
              if (skeletonRendererRef.current) {
                skeletonRendererRef.current.renderSkeleton(
                  skeletonEvent.skeleton,
                  performance.now()
                );
              }
            }
          }
        } else if (state.sourceState.type === 'checking-cache') {
          setStatus('Checking cache...');
          // Mark cache processing as in progress (will be cleared when batchComplete arrives)
          setIsCacheProcessing(true);
        }
      } else if (state.type === 'error') {
        setStatus(`Error: ${state.message}`);
        setIsCacheProcessing(false); // Clear loading state on error
      } else {
        setStatus('Ready');
      }

      // Mark model as loaded once we have an active source
      if (state.type === 'video-file' && state.sourceState.type === 'active') {
        setAppState((prev) => ({ ...prev, isModelLoaded: true }));
      }
    });

    // Subscribe to skeleton events - use processSkeletonEvent via ref for stable access
    skeletonHandlerRef.current = processSkeletonEvent;
    let _skeletonEventCount = 0;
    const skeletonSubscription = session.skeletons$.subscribe((event) => {
      _skeletonEventCount++;
      // Use the ref to access the latest handler (avoids stale closure)
      skeletonHandlerRef.current?.(event);
    });

    // Subscribe to extraction progress
    const progressSubscription = session.extractionProgress$.subscribe(
      (progress) => {
        setExtractionProgress(progress);
      }
    );

    // Subscribe to pipeline error events to surface analysis issues
    const errorSubscription = pipeline.getErrorEvents().subscribe({
      next: (pipelineError) => {
        console.warn(
          `[Pipeline ${pipelineError.source}] Error at ${pipelineError.videoTime?.toFixed(2) ?? 'unknown'}s:`,
          pipelineError.error
        );
        // Errors are already tracked in processSkeletonEvent, but this catches
        // errors from the RxJS streaming path as well
      },
      error: (error) => {
        console.error('Error in pipeline error subscription:', error);
      },
    });

    // Subscribe to exercise detection events
    const detectionSubscription = pipeline
      .getExerciseDetectionEvents()
      .subscribe({
        next: (detection) => {
          // Get working leg from form analyzer
          const formAnalyzer = pipeline.getFormAnalyzer();
          const workingLegFromPipeline = formAnalyzer.getWorkingLeg?.() ?? null;

          // Use extracted hook to handle detection (manages lock state, phases, etc.)
          handleDetectionEvent(
            {
              exercise: detection.exercise,
              confidence: detection.confidence,
              workingLeg: workingLegFromPipeline,
            },
            isDetectionLocked
          );
        },
        error: (error) => {
          console.error('Error in exercise detection subscription:', error);
          // Provide user feedback and set a sensible default
          setStatus('Detection error - defaulting to kettlebell swing');
          handleLegacyDetectionLock('kettlebell-swing', [
            'top',
            'connect',
            'bottom',
            'release',
          ]);
        },
      });

    // Mark as ready
    setAppState((prev) => ({ ...prev, isModelLoaded: true }));
    setStatus('Ready');

    // Set up session recorder pipeline state getter for debugging
    const video = videoRef.current;
    sessionRecorder.setPipelineStateGetter(() => {
      // Cache skeleton to avoid multiple calls that could return different results
      const skeleton = pipelineRef.current?.getLatestSkeleton();
      return {
        repCount: pipelineRef.current?.getRepCount() ?? 0,
        isPlaying: video ? !video.paused : false,
        videoTime: video?.currentTime ?? 0,
        skeletonAngles: skeleton
          ? {
              spine: skeleton.getSpineAngle(),
              arm: skeleton.getArmToSpineAngle(),
              hip: skeleton.getHipAngle(),
              knee: skeleton.getKneeAngle(),
            }
          : undefined,
      };
    });

    // Set up pose track provider for debug downloads
    sessionRecorder.setPoseTrackProvider(() => {
      const videoSource = inputSessionRef.current?.getVideoFileSource();
      return videoSource?.getPoseTrack() ?? null;
    });

    return () => {
      stateSubscription.unsubscribe();
      skeletonSubscription.unsubscribe();
      progressSubscription.unsubscribe();
      errorSubscription.unsubscribe();
      detectionSubscription.unsubscribe();
      session.dispose();
      inputSessionRef.current = null;
      thumbnailQueueRef.current?.dispose();
      thumbnailQueueRef.current = null;
    };
  }, [
    initializePipeline,
    processSkeletonEvent,
    updateHudFromSkeleton,
    handleDetectionEvent,
    handleLegacyDetectionLock,
    isDetectionLocked,
  ]);

  // ========================================
  // Video Playback Handlers
  // ========================================
  // biome-ignore lint/correctness/useExhaustiveDependencies: repSyncHandlerRef is stable (ref from useRepNavigation)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlay = () => {
      isPlayingRef.current = true;
      setIsPlaying(true);
      setAppState((prev) => ({ ...prev, isProcessing: true }));
      recordPlaybackStart({ videoTime: video.currentTime });
    };

    const handlePause = () => {
      isPlayingRef.current = false;
      setIsPlaying(false);
      setAppState((prev) => ({ ...prev, isProcessing: false }));
      recordPlaybackPause({ videoTime: video.currentTime });
    };

    const handleEnded = () => {
      isPlayingRef.current = false;
      setIsPlaying(false);
      setAppState((prev) => ({ ...prev, isProcessing: false }));
      // Don't reset rep count when video ends - just stop processing
    };

    // Per-frame skeleton rendering using requestVideoFrameCallback
    // This fires once per actual video frame, perfectly synced with display
    let videoFrameCallbackId: number | null = null;

    const renderVideoFrame: VideoFrameRequestCallback = (now, metadata) => {
      // Look up skeleton at the exact video frame time
      const session = inputSessionRef.current;
      if (session && isPlayingRef.current) {
        const skeletonEvent = session.getSkeletonAtTime(metadata.mediaTime);
        const hasPoses = !!skeletonEvent?.skeleton;
        setHasPosesForCurrentFrame(hasPoses);
        if (skeletonEvent?.skeleton) {
          // Render the skeleton
          if (skeletonRendererRef.current) {
            skeletonRendererRef.current.renderSkeleton(
              skeletonEvent.skeleton,
              now
            );
          }
          // Update HUD with current frame's data (uses precomputed speed)
          updateHudFromSkeleton(
            skeletonEvent.skeleton,
            metadata.mediaTime,
            skeletonEvent.precomputedAngles?.wristSpeed
          );
        }

        // Throttled rep/position sync (every REP_SYNC_INTERVAL_MS)
        // This updates the rep counter and position display as video plays.
        // See ARCHITECTURE.md "Throttled Playback Sync" for rationale.
        if (now - lastRepSyncTimeRef.current >= REP_SYNC_INTERVAL_MS) {
          lastRepSyncTimeRef.current = now;
          repSyncHandlerRef.current?.(metadata.mediaTime);
        }
      }

      // Request next frame callback if still playing
      if (isPlayingRef.current) {
        videoFrameCallbackId =
          video.requestVideoFrameCallback(renderVideoFrame);
      }
    };

    const startVideoFrameCallback = () => {
      if (
        videoFrameCallbackId === null &&
        'requestVideoFrameCallback' in video
      ) {
        videoFrameCallbackId =
          video.requestVideoFrameCallback(renderVideoFrame);
      }
    };

    const stopVideoFrameCallback = () => {
      if (
        videoFrameCallbackId !== null &&
        'cancelVideoFrameCallback' in video
      ) {
        video.cancelVideoFrameCallback(videoFrameCallbackId);
        videoFrameCallbackId = null;
      }
    };

    // Start/stop video frame callback on play/pause
    const handlePlayWithCallback = () => {
      handlePlay();
      startVideoFrameCallback();
    };

    const handlePauseWithCallback = () => {
      stopVideoFrameCallback();
      handlePause();
    };

    const handleEndedWithCallback = () => {
      stopVideoFrameCallback();
      handleEnded();
    };

    const handleSeeked = () => {
      // On seek, render skeleton at current position (works when paused too)
      const session = inputSessionRef.current;
      if (!session) return;

      const skeletonEvent = session.getSkeletonAtTime(video.currentTime);
      const hasPoses = !!skeletonEvent?.skeleton;
      setHasPosesForCurrentFrame(hasPoses);
      if (skeletonEvent?.skeleton) {
        // Render the skeleton
        if (skeletonRendererRef.current) {
          skeletonRendererRef.current.renderSkeleton(
            skeletonEvent.skeleton,
            performance.now()
          );
        }
        // Update HUD with current frame's data (uses precomputed speed)
        updateHudFromSkeleton(
          skeletonEvent.skeleton,
          video.currentTime,
          skeletonEvent.precomputedAngles?.wristSpeed
        );
      }

      // Sync rep counter and position to seek location (immediate, not throttled)
      repSyncHandlerRef.current?.(video.currentTime);
    };

    video.addEventListener('play', handlePlayWithCallback);
    video.addEventListener('pause', handlePauseWithCallback);
    video.addEventListener('ended', handleEndedWithCallback);
    video.addEventListener('seeked', handleSeeked);

    return () => {
      video.removeEventListener('play', handlePlayWithCallback);
      video.removeEventListener('pause', handlePauseWithCallback);
      video.removeEventListener('ended', handleEndedWithCallback);
      video.removeEventListener('seeked', handleSeeked);
      stopVideoFrameCallback();
    };
  }, [updateHudFromSkeleton]); // repSyncHandlerRef is stable (ref), updateHudFromSkeleton is stable (useCallback)

  // ========================================
  // Video File Controls
  // ========================================

  // Helper: Reset all video-related state for a new video
  const resetVideoState = useCallback(() => {
    setRepCount(0);
    setRepThumbnails(new Map());
    pipelineRef.current?.reset();
    hasRecordedExtractionStartRef.current = false;
    resetDetectionState();
  }, [resetDetectionState]);

  // Helper: Clear loading UI state (used on abort or completion)
  const clearLoadingState = useCallback(() => {
    setIsVideoLoading(false);
    setVideoLoadProgress(undefined);
    setVideoLoadMessage('');
  }, []);

  // Helper: Prepare for video loading (abort previous, create new controller)
  const prepareVideoLoad = useCallback(() => {
    videoLoadAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    videoLoadAbortControllerRef.current = abortController;
    return abortController;
  }, []);

  // Core video loading function - handles both user uploads and sample videos
  const loadVideo = useCallback(
    async (
      videoFile: File,
      blobUrl: string,
      abortController: AbortController,
      context: string // For error messages (e.g., "video" or "sample video")
    ) => {
      const session = inputSessionRef.current;
      const video = videoRef.current;
      if (!session || !video) {
        console.error(`loadVideo: session or video element not initialized`);
        setStatus('Error: App not initialized. Please refresh.');
        return false;
      }

      try {
        // Load video into DOM
        await loadVideoSafely(video, blobUrl, abortController.signal);

        setCurrentVideoFile(videoFile);
        recordVideoLoad({
          source: context === 'video' ? 'upload' : 'hardcoded',
          fileName: videoFile.name,
        });

        // Set video source for thumbnail queue (uses hidden video element)
        thumbnailQueueRef.current?.setVideoSource(videoFile);

        // Start extraction/cache lookup - pass signal to allow cancellation
        setVideoLoadMessage('Processing video...');
        await session.startVideoFile(videoFile, abortController.signal);

        setStatus('Video loaded. Press Play to start.');
        clearLoadingState();
        return true;
      } catch (error) {
        // AbortError means user switched videos - clean up and return
        if (error instanceof DOMException && error.name === 'AbortError') {
          clearLoadingState();
          return false;
        }
        console.error(`Error loading ${context}:`, error);
        setStatus(`Error: ${getVideoLoadErrorMessage(error, context)}`);
        clearLoadingState();
        return false;
      }
    },
    [loadVideoSafely, clearLoadingState]
  );

  // Handle user-uploaded video files
  const handleVideoUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      if (!inputSessionRef.current || !videoRef.current) {
        console.error(
          'handleVideoUpload: session or video element not initialized'
        );
        setStatus('Error: App not initialized. Please refresh.');
        return;
      }

      const abortController = prepareVideoLoad();
      setIsVideoLoading(true);
      setVideoLoadProgress(undefined);
      setVideoLoadMessage(`Loading ${file.name}...`);
      resetVideoState();

      const url = URL.createObjectURL(file);
      await loadVideo(file, url, abortController, 'video');
    },
    [prepareVideoLoad, resetVideoState, loadVideo]
  );

  // Load a sample video for a given exercise using ExerciseRegistry as source of truth
  const loadSampleVideo = useCallback(
    async (
      exerciseId: Exclude<DetectedExercise, 'unknown'>,
      videoIndex: number = 0
    ) => {
      const sampleVideos = getSampleVideos(exerciseId);
      const config: SampleVideo | undefined = sampleVideos[videoIndex];
      if (!config) {
        console.error(
          `No sample video at index ${videoIndex} for exercise: ${exerciseId}`
        );
        return;
      }

      if (!inputSessionRef.current || !videoRef.current) {
        console.error(
          `loadSampleVideo: session or video element not initialized`
        );
        setStatus('Error: App not initialized. Please refresh.');
        return;
      }

      const abortController = prepareVideoLoad();
      setStatus(`Loading ${config.name.toLowerCase()} sample...`);
      setIsVideoLoading(true);
      setVideoLoadProgress(undefined);
      setVideoLoadMessage(`Downloading ${config.name}...`);
      resetVideoState();

      try {
        // If bundled pose track is available, fetch it first to pre-populate the cache.
        // This allows instant loading without ML extraction.
        if (config.bundledPoseTrackUrl) {
          setVideoLoadMessage('Loading pose data...');
          const poseTrackResult = await fetchAndCacheBundledPoseTrack(
            config.bundledPoseTrackUrl,
            undefined, // No local fallback - using GitHub permalink
            undefined, // We don't know the video hash yet
            abortController.signal
          );
          if (poseTrackResult.success) {
            console.log(
              `[loadSampleVideo] Bundled pose track loaded (fromCache: ${poseTrackResult.fromCache})`
            );
          } else if (poseTrackResult.error !== 'Aborted') {
            // Log warning and inform user - video can still be processed via ML extraction
            console.warn(
              `[loadSampleVideo] Failed to load bundled pose track: ${poseTrackResult.error}`
            );
            setVideoLoadMessage(
              'Pose data unavailable, will extract from video...'
            );
          }
        }

        // Try remote URL first, fall back to local
        let blob: Blob;
        try {
          blob = await fetchWithProgress(
            config.url,
            (percent) => {
              setStatus(
                `Downloading ${config.name.toLowerCase()}... ${percent}%`
              );
              setVideoLoadProgress(percent);
            },
            abortController.signal
          );
        } catch (fetchError) {
          // Check for abort before trying fallback
          if (
            fetchError instanceof DOMException &&
            fetchError.name === 'AbortError'
          ) {
            throw fetchError;
          }
          console.log(`Remote ${config.name} failed, falling back to local`);
          setStatus(`Loading ${config.name.toLowerCase()} (local)...`);
          setVideoLoadMessage('Loading from local cache...');
          setVideoLoadProgress(undefined);
          const response = await fetch(config.localFallback, {
            signal: abortController.signal,
          });
          if (!response.ok) {
            throw new Error(`Failed to fetch video: ${response.status}`);
          }
          blob = await response.blob();
        }

        const fileName = getFileNameFromUrl(config.url);
        const videoFile = new File([blob], fileName, {
          type: 'video/webm',
        });
        const blobUrl = URL.createObjectURL(blob);
        await loadVideo(videoFile, blobUrl, abortController, 'sample video');
      } catch (error) {
        // AbortError means user switched videos - silently reset
        if (error instanceof DOMException && error.name === 'AbortError') {
          clearLoadingState();
          return;
        }
        console.error(`Error loading ${config.name}:`, error);
        setStatus(`Error: ${getVideoLoadErrorMessage(error, 'sample video')}`);
        clearLoadingState();
      }
    },
    [prepareVideoLoad, resetVideoState, loadVideo, clearLoadingState]
  );

  // Convenience wrappers for specific samples (maintain existing API)
  const loadHardcodedVideo = useCallback(
    () => loadSampleVideo('kettlebell-swing'),
    [loadSampleVideo]
  );
  const loadPistolSquatSample = useCallback(
    () => loadSampleVideo('pistol-squat'),
    [loadSampleVideo]
  );

  // ========================================
  // Playback Controls
  // ========================================
  const togglePlayPause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      // Handle the play promise to avoid AbortError when pause() is called before play() resolves
      video.play().catch((err) => {
        // AbortError is expected when play() is interrupted by pause() - ignore it
        if (err.name === 'AbortError') {
          return;
        }
        console.error('Error playing video:', err);
        // Provide user feedback for play failures
        if (err.name === 'NotAllowedError') {
          setStatus('Playback blocked by browser. Click Play again to start.');
        } else if (err.name === 'NotSupportedError') {
          setStatus('Error: Video format not supported.');
        } else {
          setStatus('Error: Could not play video. Try reloading.');
        }
      });
    } else {
      video.pause();
    }
  }, []);

  const stopVideo = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    video.pause();
    video.currentTime = 0;
  }, []);

  // ========================================
  // Frame Navigation (Cache-Based)
  // ========================================
  const frameStep = 1 / 30; // Assuming 30fps

  const nextFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    // Guard against NaN when video metadata isn't loaded
    if (!Number.isFinite(video.duration) || !Number.isFinite(video.currentTime))
      return;

    video.pause();
    video.currentTime = Math.min(video.duration, video.currentTime + frameStep);
    // Skeleton will be rendered via 'seeked' event handler
  }, []);

  const previousFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    // Guard against NaN when video metadata isn't loaded
    if (!Number.isFinite(video.currentTime)) return;

    video.pause();
    video.currentTime = Math.max(0, video.currentTime - frameStep);
    // Skeleton will be rendered via 'seeked' event handler
  }, []);

  // Clear position label when playing or using frame navigation
  const clearPositionLabel = useCallback(() => {
    setCurrentPosition(null);
  }, []);

  // Set current rep index directly (used by gallery modal) - wraps the callback
  const setCurrentRepIndex = setCurrentRepIndexCallback;

  // ========================================
  // Keyboard Navigation
  // ========================================
  const { isFullscreen } = useKeyboardNavigation({
    currentRepIndex: appState.currentRepIndex,
    repCount,
    onNavigateToPreviousRep: navigateToPreviousRep,
    onNavigateToNextRep: navigateToNextRep,
    togglePlayPause,
    nextFrame,
    previousFrame,
  });

  // ========================================
  // Display Mode
  // ========================================
  const setDisplayMode = useCallback((mode: 'both' | 'video' | 'overlay') => {
    setAppState((prev) => ({ ...prev, displayMode: mode }));

    switch (mode) {
      case 'both':
        if (videoRef.current) videoRef.current.style.opacity = '1';
        if (canvasRef.current) canvasRef.current.style.display = 'block';
        break;
      case 'video':
        if (videoRef.current) videoRef.current.style.opacity = '1';
        if (canvasRef.current) canvasRef.current.style.display = 'none';
        break;
      case 'overlay':
        if (videoRef.current) videoRef.current.style.opacity = '0.1';
        if (canvasRef.current) canvasRef.current.style.display = 'block';
        break;
    }
  }, []);

  // ========================================
  // Crop Toggle
  // ========================================
  const toggleCrop = useCallback(() => {
    const pipeline = pipelineRef.current;
    if (!pipeline || !cropRegion) return;

    const newEnabled = !isCropEnabled;
    setIsCropEnabled(newEnabled);
    pipeline.setCropEnabled(newEnabled);

    // Re-sync canvas to match the new zoom state
    // Use requestAnimationFrame to ensure CSS has applied
    requestAnimationFrame(() => {
      syncCanvasToVideo(newEnabled, cropRegion);
    });
  }, [cropRegion, isCropEnabled, syncCanvasToVideo]);

  // ========================================
  // Reset
  // ========================================
  const reset = useCallback(() => {
    pipelineRef.current?.reset();
    setRepCount(0);
    setSpineAngle(0);
    setArmToSpineAngle(0);
    setRepThumbnails(new Map());
    // Reset exercise detection state (via extracted hook)
    resetDetectionState();
    setAppState((prev) => ({
      ...prev,
      currentRepIndex: 0,
      repCounter: {
        ...prev.repCounter,
        count: 0,
        isConnect: false,
        lastConnectState: false,
      },
    }));
  }, [resetDetectionState]);

  // ========================================
  // Helper Functions
  // ========================================
  const getVideoContainerClass = useCallback(() => {
    if (!videoRef.current) return '';
    const { videoWidth, videoHeight } = videoRef.current;
    return videoWidth > videoHeight ? 'video-landscape' : 'video-portrait';
  }, []);

  // Derived state
  const isExtracting =
    inputState.type === 'video-file' &&
    inputState.sourceState.type === 'extracting';

  // HUD configuration from the current form analyzer (changes when exercise type changes)
  // biome-ignore lint/correctness/useExhaustiveDependencies: detectedExercise triggers re-fetch of HUD config when exercise changes
  const hudConfig = useMemo((): HudConfig => {
    const formAnalyzer = pipelineRef.current?.getFormAnalyzer();
    if (formAnalyzer) {
      return formAnalyzer.getHudConfig();
    }
    // Default config (kettlebell swing) when no analyzer available
    return {
      metrics: [
        { key: 'spineAngle', label: 'SPINE', unit: '°', decimals: 0 },
        { key: 'armAngle', label: 'ARM', unit: '°', decimals: 0 },
        { key: 'speed', label: 'SPEED', unit: 'm/s', decimals: 1 },
      ],
    };
  }, [detectedExercise]);

  // ========================================
  // Return Public API (compatible with V1)
  // ========================================
  return {
    // State
    appState,
    status,
    repCount,
    spineAngle,
    armToSpineAngle,
    wristVelocity,
    isPlaying,
    videoStartTime: null, // Not tracked in V2
    isFullscreen,
    currentVideoFile,
    usingCachedPoses: inputState.type === 'video-file',
    repThumbnails,
    extractionProgress,
    isExtracting,
    inputState,

    // Refs
    videoRef,
    canvasRef,
    fileInputRef,
    checkpointGridRef,
    pipelineRef,

    // Actions
    handleVideoUpload,
    loadHardcodedVideo,
    loadPistolSquatSample,
    togglePlayPause,
    stopVideo,
    startProcessing: () => {}, // No-op in V2 (handled by InputSession)
    stopProcessing: () => {}, // No-op in V2
    reset,
    resetPipelineOnly: reset,
    nextFrame,
    previousFrame,
    setBodyPartDisplay: () => {}, // TODO: Implement
    setDisplayMode,
    setDebugMode: () => {}, // TODO: Implement
    navigateToPreviousRep,
    navigateToNextRep,
    navigateToPreviousCheckpoint,
    navigateToNextCheckpoint,
    setCurrentRepIndex,
    clearPositionLabel,
    getVideoContainerClass,
    reinitializeWithCachedPoses: async () => {}, // No-op in V2
    reinitializeWithLiveCache: async () => {}, // No-op in V2

    // V2-specific
    getSkeletonAtTime: (time: number) =>
      inputSessionRef.current?.getSkeletonAtTime(time) ?? null,

    // Crop/Zoom controls
    cropRegion,
    isCropEnabled,
    toggleCrop,
    hasCropRegion: cropRegion !== null,
    isLandscape,

    // HUD visibility (based on pose availability, not extraction state)
    hasPosesForCurrentFrame,

    // Current position (shown when navigating by checkpoint)
    currentPosition,

    // Exercise detection
    detectedExercise,
    detectionConfidence,
    isDetectionLocked,
    setExerciseType,

    // Current phases for this exercise (for rep gallery)
    currentPhases,

    // Working leg (for exercises that support it, e.g., pistol squat)
    workingLeg,

    // Cache processing state (true while loading from cache)
    isCacheProcessing,

    // Media dialog loading state
    isVideoLoading,
    videoLoadProgress,
    videoLoadMessage,

    // Dynamic HUD configuration
    hudConfig,
    currentAngles,
  };
}
