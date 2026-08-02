/**
 * VideoFileSkeletonSource - Skeleton detection from video files
 *
 * Handles the complete video file workflow:
 * 1. Check cache for existing pose data
 * 2. If not cached, extract poses (streaming each frame as it's ready)
 * 3. Provide fast cache lookup for playback/seeking
 *
 * The key insight is that extraction and playback use different paths:
 * - Extraction: ML inference → cache + stream to subscribers
 * - Playback: cache lookup → instant skeleton (no ML)
 */

import { BehaviorSubject, type Observable, Subject } from 'rxjs';
import {
  extractPosesFromVideo,
  measureVideoFpsFromFile,
} from '../services/PoseExtractor';
import {
  loadPoseTrackFromStorage,
  savePoseTrackToStorage,
} from '../services/PoseTrackService';
import {
  recordCacheLoad,
  recordPoseTrackPersistFailure,
} from '../services/SessionRecorder';
import type {
  ExtractionFrame,
  ExtractionPoseTrack,
  PoseModel,
  PoseTrackFile,
} from '../types/posetrack';
import { computeFrameSpeeds } from '../utils/speedComputation';
import { computeQuickVideoHash } from '../utils/videoHash';
import { LivePoseCache } from './LivePoseCache';
import { buildSkeletonEventFromFrame } from './PipelineFactory';
import type { SkeletonEvent } from './PipelineInterfaces';
import type {
  SkeletonSource,
  SkeletonSourceState,
  VideoFileSourceConfig,
} from './SkeletonSource';

/**
 * How far above a cached track's recorded fps a measurement must land before
 * the track counts as under-sampled. The real defect doubles the rate (30
 * assumed for a 60fps source), so 1.5 separates that from estimator noise.
 */
const UNDER_SAMPLING_RATIO = 1.5;

/**
 * Cached frames replayed per macrotask. Each emission synchronously drives the
 * form analyzer and React state, so a 30-minute video (~54k frames) in one
 * task locks the tab. Sized so ordinary clips still replay in a single pass —
 * which also keeps the burst observable after one timer tick, as the tests
 * that await a single flush expect.
 */
const CACHED_REPLAY_CHUNK_SIZE = 500;

/**
 * Skeleton source for video files with caching support
 */
export class VideoFileSkeletonSource implements SkeletonSource {
  readonly type = 'video-file' as const;

  private readonly stateSubject: BehaviorSubject<SkeletonSourceState>;
  private readonly skeletonSubject = new Subject<SkeletonEvent>();
  private readonly stop$ = new Subject<void>();

  private liveCache: LivePoseCache | null = null;
  private poseTrack: ExtractionPoseTrack | null = null;
  private videoHash: string | null = null;
  private abortController: AbortController | null = null;
  private stopped = false;
  // Increments on every start(); pending async work (the cached-burst
  // setTimeout) captures its generation and bails if a newer start()
  // has superseded it. The boolean alone can't tell "stopped and
  // restarted" apart from "never stopped". Defensive: InputSession
  // currently constructs a fresh source per video, so same-instance
  // restart is only reachable through direct API use (and the tests).
  private generation = 0;

  private readonly videoFile: File;
  private readonly autoExtract: boolean;
  private readonly model: PoseModel;

  constructor(config: VideoFileSourceConfig) {
    this.videoFile = config.videoFile;
    // Note: videoElement and canvasElement from config are not used here
    // because extraction creates its own hidden video element.
    // They're kept in the config interface for API consistency with CameraSkeletonSource.
    this.autoExtract = config.autoExtract ?? true;
    this.model = config.model ?? 'blazepose';
    this.stateSubject = new BehaviorSubject<SkeletonSourceState>({
      type: 'idle',
    });
  }

  get state(): SkeletonSourceState {
    return this.stateSubject.getValue();
  }

  get state$(): Observable<SkeletonSourceState> {
    return this.stateSubject.asObservable();
  }

  get skeletons$(): Observable<SkeletonEvent> {
    return this.skeletonSubject.asObservable();
  }

  /**
   * Decide whether a cached track may be reused.
   *
   * Tracks written before fps measurement existed assumed 30fps, and that
   * assumption set the sampling interval (extraction steps by 1/fps), so a
   * 60fps source was cached at half resolution. Because cache hits skip
   * measurement, the under-sampled track would otherwise be reused forever
   * while a fresh extraction of the same file produced twice the frames.
   *
   * Rewriting `fps` on the existing frames is NOT a fix — playback maps
   * videoTime→index with it, so a corrected number against unchanged frames
   * desynchronizes every lookup. The only sound repair is re-extraction.
   *
   * The audit is deliberately one-sided. Only a measurement MUCH HIGHER than
   * the recorded fps is evidence of the defect; the reverse is not:
   *
   * - measured >> recorded (e.g. 60 vs 30): the source has frames the track
   *   never sampled. Re-extract.
   * - measured <= recorded (e.g. 25 vs 30): extraction seeked to
   *   frameIndex/fps, so the frames really are 1/recorded apart — some just
   *   repeat. Index math still holds, so re-extracting would burn minutes to
   *   fix nothing.
   * - measurement failed entirely: no evidence, so keep the cache.
   *
   * The margin matters because the estimate is noisy: it samples 12 frames
   * from a hidden element that is playing while the main thread is busy, so
   * dropped presentations stretch the median delta and read LOW. Treating any
   * inequality as staleness would let one throttled sample destroy a good
   * cache and re-persist a genuinely wrong fps as measured — cementing the
   * exact defect this audit exists to catch.
   */
  private async cachedTrackIsUsable(
    cached: PoseTrackFile,
    signal?: AbortSignal
  ): Promise<boolean> {
    if (cached.metadata.fpsMeasured) {
      return true;
    }

    let measuredFps: number | null;
    try {
      measuredFps = await measureVideoFpsFromFile(this.videoFile, signal);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error;
      }
      console.warn(
        '[VideoFileSkeletonSource] Could not audit assumed fps, keeping cache:',
        error
      );
      return true;
    }

    if (measuredFps === null) {
      return true;
    }

    const recordedFps = cached.metadata.fps;

    if (measuredFps > recordedFps * UNDER_SAMPLING_RATIO) {
      console.log(
        `[VideoFileSkeletonSource] Cached track sampled at ${recordedFps}fps but the video measures ${measuredFps}fps — re-extracting`
      );
      return false;
    }

    // Only stamp on a close agreement. A reading well below the recorded fps
    // keeps the cache but stays unstamped, so a later, cleaner measurement can
    // still catch a track this one was too noisy to judge.
    const agrees = Math.abs(measuredFps - recordedFps) <= recordedFps * 0.1;
    if (!agrees) {
      return true;
    }

    cached.metadata.fpsMeasured = true;
    try {
      await savePoseTrackToStorage(cached);
    } catch (error) {
      // Non-fatal: we just remeasure next load.
      console.warn(
        '[VideoFileSkeletonSource] Could not persist verified fps:',
        error
      );
    }
    return true;
  }

  /**
   * Get the live cache (for pipeline integration during extraction)
   */
  getLiveCache(): LivePoseCache | null {
    return this.liveCache;
  }

  /**
   * Get the final pose track (after extraction or from cache)
   */
  getPoseTrack(): ExtractionPoseTrack | null {
    return this.poseTrack;
  }

  /**
   * Get the video hash
   */
  getVideoHash(): string | null {
    return this.videoHash;
  }

  /**
   * Start the source - check cache, then extract if needed
   * @param signal - Optional AbortSignal to cancel the operation
   */
  async start(signal?: AbortSignal): Promise<void> {
    // Clean up any previous session
    this.stop();
    this.stopped = false;
    const generation = ++this.generation;

    // Check if already aborted
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    this.stateSubject.next({ type: 'starting' });

    try {
      // Compute video hash
      this.videoHash = await computeQuickVideoHash(this.videoFile);

      // Check if aborted after hash computation
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      // Check cache first
      this.stateSubject.next({ type: 'checking-cache' });
      let cached = await loadPoseTrackFromStorage(this.videoHash);

      // Check if aborted after cache lookup
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      if (cached && !(await this.cachedTrackIsUsable(cached, signal))) {
        // Sampled at an assumed fps that the source video contradicts — the
        // frames themselves are too sparse, so re-extract rather than reuse.
        cached = null;
      }

      // The audit above can block for seconds; the user may have switched
      // videos meanwhile, and publishing 'active' now would clobber the idle
      // state stop() just set.
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      if (cached) {
        // Use cached data
        this.poseTrack = cached;

        // Compute speeds if not already present (one-time pass with smoothing)
        const hasSpeeds = cached.frames.some(
          (f) => f.angles?.wristSpeed != null
        );
        if (!hasSpeeds && cached.frames.length > 0) {
          console.log(
            '[VideoFileSkeletonSource] Computing smoothed speeds for',
            cached.frames.length,
            'frames'
          );
          computeFrameSpeeds(cached.frames);
        }

        this.liveCache = LivePoseCache.fromPoseTrackFile(cached);
        this.stateSubject.next({ type: 'active' });

        // Record cache load for session debugging
        recordCacheLoad({
          frameCount: cached.frames.length,
          videoHash: this.videoHash!,
          videoDuration: cached.metadata.sourceVideoDuration,
        });

        // Emit all cached skeletons for initial pipeline processing
        // This allows the pipeline to count reps from cached data
        // Use setTimeout(0) to ensure all subscribers are set up before we emit
        console.log(
          '[VideoFileSkeletonSource] Scheduling emission of',
          cached.frames.length,
          'cached skeleton events'
        );
        setTimeout(() => {
          if (this.stopped || generation !== this.generation) {
            return;
          }
          const startTime = performance.now();
          console.log(
            '[VideoFileSkeletonSource] Emitting',
            cached.frames.length,
            'cached skeleton events'
          );
          const frames = cached.frames;
          let emitCount = 0;

          // Emit in chunks, yielding between them. Every emission runs the
          // analyzer and React updates synchronously, so replaying a long
          // video in one task froze the tab — on the path that exists to be
          // the FAST one. The chunk is large enough that ordinary videos
          // still finish in the first pass.
          const emitChunk = () => {
            if (this.stopped || generation !== this.generation) {
              return;
            }

            const chunkEnd = Math.min(
              emitCount + CACHED_REPLAY_CHUNK_SIZE,
              frames.length
            );
            for (; emitCount < chunkEnd; emitCount++) {
              this.skeletonSubject.next(
                buildSkeletonEventFromFrame(frames[emitCount])
              );
            }

            if (emitCount < frames.length) {
              setTimeout(emitChunk, 0);
              return;
            }

            const processingTime = performance.now() - startTime;
            console.log(
              '[VideoFileSkeletonSource] Done emitting',
              emitCount,
              'cached skeleton events in',
              processingTime.toFixed(0),
              'ms'
            );

            // Emit completion event after all skeletons processed
            // This is a signal that batch processing is done
            this.stateSubject.next({
              type: 'active',
              batch: {
                framesProcessed: emitCount,
                processingTimeMs: processingTime,
              },
            });
          };

          emitChunk();
        }, 0);

        return;
      }

      // No cache - extract if auto-extract enabled
      if (!this.autoExtract) {
        this.stateSubject.next({ type: 'idle' });
        return;
      }

      // Start extraction (pass signal to allow cancellation)
      await this.extract(signal);
    } catch (error) {
      // Re-throw abort errors without logging as error
      if (error instanceof DOMException && error.name === 'AbortError') {
        this.stateSubject.next({ type: 'idle' });
        throw error;
      }
      const message =
        error instanceof Error ? error.message : 'Failed to process video';
      this.stateSubject.next({ type: 'error', message });
      throw error;
    }
  }

  /**
   * Stop extraction if in progress
   */
  stop(): void {
    this.stopped = true;

    // Signal stop
    this.stop$.next();

    // Abort extraction
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // Clear live cache if extraction was in progress
    if (this.liveCache && !this.liveCache.isExtractionComplete()) {
      this.liveCache.abort();
      this.liveCache = null;
    }

    this.stateSubject.next({ type: 'idle' });
  }

  /**
   * Clean up all resources
   */
  dispose(): void {
    this.stop();

    if (this.liveCache) {
      this.liveCache.clear();
      this.liveCache = null;
    }

    this.poseTrack = null;
    this.videoHash = null;

    this.stateSubject.complete();
    this.skeletonSubject.complete();
    this.stop$.complete();
  }

  /**
   * Get skeleton at a specific video time (for seeking/stepping)
   * Returns cached skeleton if available, null otherwise
   */
  getSkeletonAtTime(videoTime: number): SkeletonEvent | null {
    if (!this.liveCache) {
      return null;
    }

    const frame = this.liveCache.getFrame(videoTime, this.lookupTolerance());
    if (!frame) {
      return null;
    }

    return buildSkeletonEventFromFrame(frame);
  }

  /**
   * Check if skeleton is available at time — same tolerance policy as
   * getSkeletonAtTime, so has(t) can never claim a frame get(t) refuses.
   */
  hasSkeletonAtTime(videoTime: number): boolean {
    return this.liveCache?.hasFrame(videoTime, this.lookupTolerance()) ?? false;
  }

  /**
   * While extraction is still filling the cache, only match frames near
   * the requested time — otherwise playback ahead of the extraction
   * frontier renders the last-extracted skeleton as if it were current.
   */
  private lookupTolerance(): number | undefined {
    return this.liveCache?.isExtractionComplete() ? undefined : 0.1;
  }

  /**
   * Save the current pose track to storage
   */
  async save(): Promise<void> {
    if (!this.poseTrack) {
      throw new Error('No pose track to save');
    }
    await savePoseTrackToStorage(this.poseTrack);
  }

  /**
   * Run extraction, streaming frames as they're processed
   * @param externalSignal - Optional external AbortSignal to link to
   */
  private async extract(externalSignal?: AbortSignal): Promise<void> {
    if (!this.videoHash) {
      throw new Error('Video hash not computed');
    }
    // Capture: this.videoHash is nulled by dispose(), which can race the
    // async work below (e.g. the persist-failure log after a rejection).
    const videoHash = this.videoHash;

    const extractStartTime = performance.now();

    // Create abort controller for cancellation
    this.abortController = new AbortController();

    // Listener reference for cleanup
    let abortListener: (() => void) | null = null;

    // Link external signal to our internal abort controller
    if (externalSignal) {
      if (externalSignal.aborted) {
        this.abortController.abort();
      } else {
        // Store listener reference so we can remove it in finally block
        abortListener = () => {
          this.abortController?.abort();
        };
        externalSignal.addEventListener('abort', abortListener, { once: true });
      }
    }

    // Create live cache for streaming
    this.liveCache = new LivePoseCache(this.videoHash);

    // Initial progress state
    this.stateSubject.next({
      type: 'extracting',
      progress: {
        currentFrame: 0,
        totalFrames: 0,
        percentage: 0,
        currentTime: 0,
        totalDuration: 0,
      },
    });

    try {
      const result = await extractPosesFromVideo(this.videoFile, {
        model: this.model,
        precomputeAngles: true,
        signal: this.abortController.signal,
        onProgress: (progress) => {
          this.stateSubject.next({
            type: 'extracting',
            progress: {
              currentFrame: progress.currentFrame,
              totalFrames: progress.totalFrames,
              percentage: progress.percentage,
              currentTime: progress.currentTime,
              totalDuration: progress.totalDuration,
            },
          });
        },
        onFrameExtracted: (frame: ExtractionFrame) => {
          // Add to cache
          this.liveCache?.addFrame(frame);

          // Stream to subscribers immediately
          const skeletonEvent = buildSkeletonEventFromFrame(frame);
          this.skeletonSubject.next(skeletonEvent);
        },
      });

      // Mark cache complete
      this.liveCache.markComplete(result.poseTrack.metadata);

      // Compute smoothed speeds for all frames (one-time pass)
      if (result.poseTrack.frames.length > 0) {
        console.log(
          '[VideoFileSkeletonSource] Computing smoothed speeds for',
          result.poseTrack.frames.length,
          'extracted frames'
        );
        computeFrameSpeeds(result.poseTrack.frames);
      }

      // Store final pose track
      this.poseTrack = result.poseTrack;

      // Persist for future loads (speeds included). Failure (e.g. storage
      // quota) must not kill the session — all frames are already live in
      // liveCache — but it must be DISCLOSED: quota exhaustion persists,
      // so every future load of this video silently re-extracts unless
      // the user learns storage is full.
      let persistFailed = false;
      try {
        await savePoseTrackToStorage(result.poseTrack);
      } catch (saveError) {
        persistFailed = true;
        console.warn(
          '[VideoFileSkeletonSource] Failed to persist pose track; continuing with in-memory poses:',
          saveError
        );
        recordPoseTrackPersistFailure({
          videoHash,
          frameCount: result.poseTrack.frames.length,
          error:
            saveError instanceof Error ? saveError.message : String(saveError),
        });
      }

      this.stateSubject.next({
        type: 'active',
        batch: {
          framesProcessed: result.poseTrack.frames.length,
          processingTimeMs: performance.now() - extractStartTime,
          ...(persistFailed ? { persistFailed: true } : {}),
        },
      });
    } catch (error) {
      // Clean up on error
      if (this.liveCache) {
        this.liveCache.abort();
      }

      if (error instanceof DOMException && error.name === 'AbortError') {
        // Cancelled is not a failure, but it is not success either: swallowing
        // it here resolved extract()'s promise normally, so the caller's
        // continuation ran as if the video had loaded and cleared the loading
        // UI that the REPLACEMENT video had already put up. Report idle, then
        // let the cancellation propagate so callers can tell the difference.
        this.stateSubject.next({ type: 'idle' });
      }
      throw error;
    } finally {
      // Clean up external signal listener to prevent memory leaks
      if (externalSignal && abortListener) {
        externalSignal.removeEventListener('abort', abortListener);
      }
      this.abortController = null;
    }
  }
}
