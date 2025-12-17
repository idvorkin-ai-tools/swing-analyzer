/**
 * useVideoLoader - Video loading state management for exercise analyzer.
 *
 * Handles:
 * - Loading videos safely into DOM with proper cleanup
 * - Managing abort controllers for video switching
 * - Loading sample videos with progress reporting
 * - Handling user-uploaded videos
 * - Integration with InputSession for pose extraction
 *
 * Extracted from useExerciseAnalyzer for testability.
 */

import { useCallback, useRef } from 'react';
import type { DetectedExercise } from '../analyzers';
import {
  getSampleVideos,
  type SampleVideo,
} from '../analyzers/ExerciseRegistry';
import type { InputSession } from '../pipeline/InputSession';
import type { Pipeline } from '../pipeline/Pipeline';
import { fetchAndCacheBundledPoseTrack } from '../services/PoseTrackService';
import { recordVideoLoad } from '../services/SessionRecorder';
import type { ThumbnailQueue } from '../services/ThumbnailGenerator';
import type { CropRegion } from '../types/posetrack';
import {
  fetchWithProgress,
  getFileNameFromUrl,
  getVideoLoadErrorMessage,
} from './utils/videoLoadingUtils';

/**
 * Parameters for the video loader hook.
 */
export interface UseVideoLoaderParams {
  /** Ref to the video element */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Ref to the InputSession instance */
  inputSessionRef: React.RefObject<InputSession | null>;
  /** Ref to the ThumbnailQueue instance */
  thumbnailQueueRef: React.RefObject<ThumbnailQueue | null>;
  /** Ref to the Pipeline instance */
  pipelineRef: React.RefObject<Pipeline | null>;
  /** Reducer actions */
  actions: {
    setRepCount: (count: number) => void;
    clearThumbnails: () => void;
    setStatus: (status: string) => void;
    startLoading: (message: string) => void;
    setLoadingProgress: (progress: number, message: string) => void;
    videoLoaded: (file: File) => void;
    error: (message: string) => void;
  };
  /** Callback to sync canvas to video dimensions */
  syncCanvasToVideo: (
    isCropEnabled: boolean,
    cropRegion: CropRegion | null
  ) => void;
  /** Callback to reset exercise detection state */
  resetDetectionState: () => void;
  /** Ref to track if extraction has been recorded (prevents spam) */
  hasRecordedExtractionStartRef: React.MutableRefObject<boolean>;
}

/**
 * Return value from the video loader hook.
 */
export interface UseVideoLoaderReturn {
  /** Handle user-uploaded video files */
  handleVideoUpload: (
    event: React.ChangeEvent<HTMLInputElement>
  ) => Promise<void>;
  /** Load a sample video by exercise type and optional index */
  loadSampleVideo: (
    exerciseId: Exclude<DetectedExercise, 'unknown'>,
    videoIndex?: number
  ) => Promise<void>;
  /** Load the default kettlebell swing sample video */
  loadHardcodedVideo: () => Promise<void>;
  /** Load the pistol squat sample video */
  loadPistolSquatSample: () => Promise<void>;
  /** Reset video-related state for a new video */
  resetVideoState: () => void;
  /** Ref to current video URL for cleanup */
  currentVideoUrlRef: React.MutableRefObject<string | null>;
  /** Ref to abort controller for cancelling video loads */
  videoLoadAbortControllerRef: React.MutableRefObject<AbortController | null>;
}

/**
 * Hook for video loading state management.
 *
 * Features:
 * - Safe video loading with metadata wait and error handling
 * - Automatic abort of previous load on new video
 * - Progress reporting for downloads
 * - Bundled pose track pre-fetching for instant loading
 * - Object URL cleanup on video switch
 */
export function useVideoLoader({
  videoRef,
  inputSessionRef,
  thumbnailQueueRef,
  pipelineRef,
  actions,
  syncCanvasToVideo,
  resetDetectionState,
  hasRecordedExtractionStartRef,
}: UseVideoLoaderParams): UseVideoLoaderReturn {
  // Track current video's object URL for cleanup on video switch
  const currentVideoUrlRef = useRef<string | null>(null);

  // Track if we're in the middle of loading a video (to abort on switch)
  const videoLoadAbortControllerRef = useRef<AbortController | null>(null);

  // ========================================
  // Internal Helpers
  // ========================================

  /**
   * Load a video safely into the DOM element.
   * Handles cleanup, metadata waiting, and abort signals.
   */
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

      // 4. Wait for metadata with proper event handling
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

  /**
   * Reset all video-related state for a new video.
   */
  const resetVideoState = useCallback(() => {
    actions.setRepCount(0);
    actions.clearThumbnails();
    pipelineRef.current?.reset();
    hasRecordedExtractionStartRef.current = false;
    resetDetectionState();
  }, [
    resetDetectionState,
    actions,
    pipelineRef,
    hasRecordedExtractionStartRef,
  ]);

  /**
   * Clear loading UI state (used on abort or completion).
   * Currently a no-op since loading state is derived from video state.
   */
  const clearLoadingState = useCallback(() => {
    // Video loading state is derived from reducer, so just dispatch VIDEO_LOADED
    // with a dummy file to reset, or rely on state transitions
    // For now, this is a no-op since loading state is derived from video state
  }, []);

  /**
   * Prepare for video loading (abort previous, create new controller).
   */
  const prepareVideoLoad = useCallback(() => {
    videoLoadAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    videoLoadAbortControllerRef.current = abortController;
    return abortController;
  }, []);

  /**
   * Core video loading function - handles both user uploads and sample videos.
   */
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
        actions.setStatus('Error: App not initialized. Please refresh.');
        return false;
      }

      try {
        // Load video into DOM
        await loadVideoSafely(video, blobUrl, abortController.signal);

        // Video loaded - dispatch to reducer
        actions.videoLoaded(videoFile);
        recordVideoLoad({
          source: context === 'video' ? 'upload' : 'hardcoded',
          fileName: videoFile.name,
        });

        // Set video source for thumbnail queue (uses hidden video element)
        thumbnailQueueRef.current?.setVideoSource(videoFile);

        // Start extraction/cache lookup - pass signal to allow cancellation
        actions.setLoadingProgress(50, 'Processing video...');
        await session.startVideoFile(videoFile, abortController.signal);

        actions.setStatus('Video loaded. Press Play to start.');
        clearLoadingState();
        return true;
      } catch (error) {
        // AbortError means user switched videos - clean up and return
        if (error instanceof DOMException && error.name === 'AbortError') {
          clearLoadingState();
          return false;
        }
        console.error(`Error loading ${context}:`, error);
        actions.error(getVideoLoadErrorMessage(error, context));
        clearLoadingState();
        return false;
      }
    },
    [
      loadVideoSafely,
      clearLoadingState,
      actions,
      videoRef,
      inputSessionRef,
      thumbnailQueueRef,
    ]
  );

  // ========================================
  // Public API
  // ========================================

  /**
   * Handle user-uploaded video files.
   */
  const handleVideoUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      if (!inputSessionRef.current || !videoRef.current) {
        console.error(
          'handleVideoUpload: session or video element not initialized'
        );
        actions.setStatus('Error: App not initialized. Please refresh.');
        return;
      }

      const abortController = prepareVideoLoad();
      actions.startLoading(`Loading ${file.name}...`);
      resetVideoState();

      const url = URL.createObjectURL(file);
      await loadVideo(file, url, abortController, 'video');
    },
    [
      prepareVideoLoad,
      resetVideoState,
      loadVideo,
      actions,
      inputSessionRef,
      videoRef,
    ]
  );

  /**
   * Load a sample video for a given exercise using ExerciseRegistry as source of truth.
   */
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
        actions.setStatus('Error: App not initialized. Please refresh.');
        return;
      }

      const abortController = prepareVideoLoad();
      actions.startLoading(`Downloading ${config.name}...`);
      resetVideoState();

      try {
        // If bundled pose track is available, fetch it first to pre-populate the cache.
        // This allows instant loading without ML extraction.
        if (config.bundledPoseTrackUrl) {
          actions.setLoadingProgress(10, 'Loading pose data...');
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
            actions.setLoadingProgress(
              15,
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
              actions.setLoadingProgress(
                percent,
                `Downloading ${config.name.toLowerCase()}... ${percent}%`
              );
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
          actions.startLoading('Loading from local cache...');
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
        actions.error(getVideoLoadErrorMessage(error, 'sample video'));
        clearLoadingState();
      }
    },
    [
      prepareVideoLoad,
      resetVideoState,
      loadVideo,
      clearLoadingState,
      actions,
      inputSessionRef,
      videoRef,
    ]
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

  return {
    handleVideoUpload,
    loadSampleVideo,
    loadHardcodedVideo,
    loadPistolSquatSample,
    resetVideoState,
    currentVideoUrlRef,
    videoLoadAbortControllerRef,
  };
}
