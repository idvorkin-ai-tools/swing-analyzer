/**
 * VideoFileSkeletonSource tests — cache path, extraction path, completion
 * signaling, and stop() behavior. All collaborators are mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoseTrackFile } from '../types/posetrack';
import type { LivePoseCache } from './LivePoseCache';
import type { SkeletonSourceState } from './SkeletonSource';
import { VideoFileSkeletonSource } from './VideoFileSkeletonSource';

vi.mock('../services/PoseExtractor', () => ({
  extractPosesFromVideo: vi.fn(),
  measureVideoFpsFromFile: vi.fn(),
}));
vi.mock('../services/PoseTrackService', () => ({
  loadPoseTrackFromStorage: vi.fn(),
  savePoseTrackToStorage: vi.fn(),
}));
vi.mock('../services/SessionRecorder', () => ({
  recordCacheLoad: vi.fn(),
  recordPoseTrackPersistFailure: vi.fn(),
}));
vi.mock('../utils/videoHash', () => ({
  computeQuickVideoHash: vi.fn().mockResolvedValue('hash-abc'),
}));
vi.mock('./PipelineFactory', () => ({
  buildSkeletonEventFromFrame: vi.fn().mockReturnValue({
    skeleton: {},
    poseEvent: { frameEvent: { videoTime: 0 } },
  }),
}));

import {
  extractPosesFromVideo,
  measureVideoFpsFromFile,
} from '../services/PoseExtractor';
import {
  loadPoseTrackFromStorage,
  savePoseTrackToStorage,
} from '../services/PoseTrackService';
import { recordPoseTrackPersistFailure } from '../services/SessionRecorder';
import { computeQuickVideoHash } from '../utils/videoHash';

function makeTrack(
  frameCount = 3,
  metadataOverrides: Record<string, unknown> = {}
): PoseTrackFile {
  return {
    metadata: {
      version: '1.0',
      model: 'blazepose',
      modelVersion: '1.0.0',
      sourceVideoHash: 'hash-abc',
      sourceVideoDuration: 1,
      extractedAt: new Date().toISOString(),
      frameCount,
      fps: 30,
      fpsMeasured: true,
      videoWidth: 640,
      videoHeight: 480,
      ...metadataOverrides,
    },
    frames: Array.from({ length: frameCount }, (_, i) => ({
      frameIndex: i,
      timestamp: i * 33,
      videoTime: i / 30,
      keypoints: [],
    })),
  } as PoseTrackFile;
}

function makeSource(): VideoFileSkeletonSource {
  return new VideoFileSkeletonSource({
    videoFile: new File(['x'], 'a.mp4', { type: 'video/mp4' }),
    videoElement: {} as HTMLVideoElement,
    canvasElement: {} as HTMLCanvasElement,
  });
}

const flushTimers = () => new Promise((r) => setTimeout(r, 0));

describe('VideoFileSkeletonSource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(savePoseTrackToStorage).mockResolvedValue(undefined);
    // Re-set every test: the afterEach's vi.restoreAllMocks() resets non-spyOn
    // vi.fn() implementations (there's no "original" to restore to), so a
    // mockResolvedValue set only once inside the vi.mock() factory does not
    // survive past the first test.
    vi.mocked(computeQuickVideoHash).mockResolvedValue('hash-abc');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('cache path ends with an active state carrying the atomic batch payload', async () => {
    vi.mocked(loadPoseTrackFromStorage).mockResolvedValue(makeTrack());
    const source = makeSource();
    const states: SkeletonSourceState[] = [];
    source.state$.subscribe((s) => states.push(s));

    await source.start();
    await flushTimers();

    const last = states[states.length - 1];
    expect(last.type).toBe('active');
    expect(last).toMatchObject({ batch: { framesProcessed: 3 } });
  });

  it('extraction path ALSO ends with a batch payload (was cache-only)', async () => {
    vi.mocked(loadPoseTrackFromStorage).mockResolvedValue(null);
    vi.mocked(extractPosesFromVideo).mockResolvedValue({
      poseTrack: makeTrack(5),
    } as Awaited<ReturnType<typeof extractPosesFromVideo>>);
    const source = makeSource();
    const states: SkeletonSourceState[] = [];
    source.state$.subscribe((s) => states.push(s));

    await source.start();

    const last = states[states.length - 1];
    expect(last.type).toBe('active');
    expect(last).toMatchObject({ batch: { framesProcessed: 5 } });
  });

  it('storage quota failure still completes the batch, and discloses the failure', async () => {
    vi.mocked(loadPoseTrackFromStorage).mockResolvedValue(null);
    vi.mocked(extractPosesFromVideo).mockResolvedValue({
      poseTrack: makeTrack(),
    } as Awaited<ReturnType<typeof extractPosesFromVideo>>);
    vi.mocked(savePoseTrackToStorage).mockRejectedValue(
      new Error('QuotaExceededError: storage full')
    );
    const source = makeSource();
    const states: SkeletonSourceState[] = [];
    source.state$.subscribe((s) => states.push(s));

    await expect(source.start()).resolves.toBeUndefined();

    // The session completes normally (frames are live in memory)...
    const last = states[states.length - 1];
    expect(last.type).toBe('active');
    expect(last).toMatchObject({
      batch: { framesProcessed: 3, persistFailed: true },
    });
    // ...and the failure is recorded, not just console.warn'd: next load
    // silently re-extracts, so the session log must say why.
    expect(recordPoseTrackPersistFailure).toHaveBeenCalledWith(
      expect.objectContaining({ videoHash: 'hash-abc' })
    );
  });

  it('getSkeletonAtTime rejects far-from-frontier lookups while extraction is incomplete', async () => {
    vi.mocked(loadPoseTrackFromStorage).mockResolvedValue(makeTrack(3));
    const source = makeSource();
    await source.start();
    await flushTimers();

    // Frames exist at 0, 1/30, 2/30 s. Far beyond the frontier:
    // complete cache → closest-match is fine; the incomplete case is the
    // one that must NOT match (that's the stale-skeleton-ahead-of-the-
    // extraction-frontier bug). Assert the BEHAVIOR through the real
    // LivePoseCache, not just the plumbed arguments.
    const cache = source.getLiveCache();
    expect(cache).not.toBeNull();
    const incomplete = vi
      .spyOn(cache as LivePoseCache, 'isExtractionComplete')
      .mockReturnValue(false);

    expect(source.getSkeletonAtTime(5.0)).toBeNull();
    expect(source.getSkeletonAtTime(0.05)).not.toBeNull(); // near frontier

    incomplete.mockReturnValue(true);
    expect(source.getSkeletonAtTime(5.0)).not.toBeNull(); // complete → closest
  });

  it('hasSkeletonAtTime agrees with getSkeletonAtTime during incomplete extraction', async () => {
    vi.mocked(loadPoseTrackFromStorage).mockResolvedValue(makeTrack(3));
    const source = makeSource();
    await source.start();
    await flushTimers();

    const cache = source.getLiveCache();
    vi.spyOn(cache as LivePoseCache, 'isExtractionComplete').mockReturnValue(
      false
    );

    // has(t) must not claim a frame that get(t) refuses to return.
    expect(source.getSkeletonAtTime(5.0)).toBeNull();
    expect(source.hasSkeletonAtTime(5.0)).toBe(false);
  });

  it('restarting the same instance cancels the previous pending cached burst', async () => {
    // start() #1 schedules its burst (3 frames), then start() #2 begins
    // before that macrotask fires. #2 resets the stopped flag, so a plain
    // boolean would let #1's stale burst pass the guard and emit the OLD
    // track's frames (plus a spurious batch state) into the new session.
    vi.mocked(loadPoseTrackFromStorage).mockResolvedValue(makeTrack(3));
    const source = makeSource();
    const skeletons: unknown[] = [];
    source.skeletons$.subscribe((e) => skeletons.push(e));

    await source.start(); // burst #1 pending
    vi.mocked(loadPoseTrackFromStorage).mockResolvedValue(makeTrack(5));
    await source.start(); // burst #2 pending, stopped flag reset
    await flushTimers();

    expect(skeletons).toHaveLength(5); // only the new track's frames
  });

  it('stop() before the cached burst fires suppresses emissions', async () => {
    vi.mocked(loadPoseTrackFromStorage).mockResolvedValue(makeTrack());
    const source = makeSource();
    const skeletons: unknown[] = [];
    source.skeletons$.subscribe((e) => skeletons.push(e));

    await source.start(); // schedules the setTimeout(0) burst
    source.stop(); // stop BEFORE the timer fires
    await flushTimers();

    expect(skeletons).toHaveLength(0);
    expect(source.state.type).toBe('idle');
  });

  describe('replayCachedFrames', () => {
    /**
     * Switching exercise swaps the analyzer, which only affects LATER frames.
     * Re-scoring the video means pushing the cached frames through again —
     * the poses are already on disk, so no ML inference is involved.
     */
    it('re-emits every cached frame', async () => {
      vi.mocked(loadPoseTrackFromStorage).mockResolvedValue(makeTrack(4));
      const source = makeSource();
      const skeletons: unknown[] = [];

      await source.start();
      await flushTimers();
      source.skeletons$.subscribe((e) => skeletons.push(e));

      expect(source.replayCachedFrames()).toBe(true);
      await flushTimers();

      expect(skeletons).toHaveLength(4);
    });

    it('signals batch completion so the UI can drop its progress state', async () => {
      vi.mocked(loadPoseTrackFromStorage).mockResolvedValue(makeTrack(4));
      const source = makeSource();
      await source.start();
      await flushTimers();

      const states: SkeletonSourceState[] = [];
      source.state$.subscribe((s) => states.push(s));
      source.replayCachedFrames();
      await flushTimers();

      expect(states[states.length - 1]).toMatchObject({
        batch: { framesProcessed: 4 },
      });
    });

    it('refuses to replay while extraction is still in flight', async () => {
      // A partial track would double-process whatever the extractor delivers
      // next, so the caller has to wait for completion. In practice the
      // no-completed-track check is what rejects this (poseTrack is only
      // assigned once extraction resolves); the isExtractionComplete guard
      // behind it covers a cache that was populated but never closed out.
      vi.mocked(loadPoseTrackFromStorage).mockResolvedValue(null);
      vi.mocked(extractPosesFromVideo).mockImplementation(
        () => new Promise(() => {}) // never resolves: extraction in flight
      );
      const source = makeSource();
      source.start();
      await flushTimers();

      expect(source.canReplayCachedFrames()).toBe(false);
      expect(source.replayCachedFrames()).toBe(false);
      expect(source.getPoseTrack()).toBeNull();
    });

    it('reports replay feasibility before any state is discarded', async () => {
      // The caller must be able to ask WITHOUT committing: it clears the rep
      // count, gallery and the pipeline's stale-analysis flag before replaying,
      // and doing that for a replay that then refuses to start would drop the
      // re-score silently.
      vi.mocked(loadPoseTrackFromStorage).mockResolvedValue(makeTrack(4));
      const source = makeSource();
      await source.start();
      await flushTimers();

      expect(source.canReplayCachedFrames()).toBe(true);
      source.stop();
      expect(source.canReplayCachedFrames()).toBe(false);
    });

    it('refuses to replay when there is nothing cached', async () => {
      vi.mocked(loadPoseTrackFromStorage).mockResolvedValue(null);
      const source = new VideoFileSkeletonSource({
        videoFile: new File(['x'], 'a.mp4', { type: 'video/mp4' }),
        videoElement: {} as HTMLVideoElement,
        canvasElement: {} as HTMLCanvasElement,
        autoExtract: false,
      });
      await source.start();

      expect(source.replayCachedFrames()).toBe(false);
    });

    it('stops replaying when the source is stopped mid-flight', async () => {
      vi.mocked(loadPoseTrackFromStorage).mockResolvedValue(makeTrack(600));
      const source = makeSource();
      await source.start();
      await flushTimers();
      await flushTimers(); // initial pass drains

      const skeletons: unknown[] = [];
      source.skeletons$.subscribe((e) => skeletons.push(e));
      source.replayCachedFrames();
      await flushTimers(); // first chunk
      source.stop();
      await flushTimers();

      expect(skeletons).toHaveLength(500);
    });
  });

  describe('cached replay yields between chunks', () => {
    // Each emission synchronously drives the analyzer and React state, so a
    // long track replayed in one task freezes the tab. 500 frames per chunk.
    const CHUNK = 500;

    it('does not emit the whole track in a single task', async () => {
      vi.mocked(loadPoseTrackFromStorage).mockResolvedValue(makeTrack(600));
      const source = makeSource();
      const skeletons: unknown[] = [];
      source.skeletons$.subscribe((e) => skeletons.push(e));

      await source.start();
      await flushTimers();
      expect(skeletons).toHaveLength(CHUNK);

      await flushTimers();
      expect(skeletons).toHaveLength(600);
    });

    it('signals batch completion only after the last chunk', async () => {
      vi.mocked(loadPoseTrackFromStorage).mockResolvedValue(makeTrack(600));
      const source = makeSource();
      const states: SkeletonSourceState[] = [];
      source.state$.subscribe((s) => states.push(s));

      await source.start();
      await flushTimers();
      expect(states.some((s) => 'batch' in s && s.batch)).toBe(false);

      await flushTimers();
      const last = states[states.length - 1];
      expect(last).toMatchObject({ batch: { framesProcessed: 600 } });
    });

    it('stops mid-replay when the source is stopped between chunks', async () => {
      vi.mocked(loadPoseTrackFromStorage).mockResolvedValue(makeTrack(600));
      const source = makeSource();
      const skeletons: unknown[] = [];
      source.skeletons$.subscribe((e) => skeletons.push(e));

      await source.start();
      await flushTimers(); // first chunk lands
      source.stop();
      await flushTimers(); // second chunk must not run

      expect(skeletons).toHaveLength(CHUNK);
    });
  });

  /**
   * Tracks extracted before fps measurement landed carry an ASSUMED fps of 30.
   * That number is not just a label: extraction samples at 1/fps, so the track's
   * frames really are 30fps-spaced and every videoTime→index lookup depends on
   * it. A 60fps source therefore cached at half resolution, permanently — cache
   * hits skip measurement, so re-opening the same file never self-corrects while
   * a fresh extraction of it would. The fix must re-extract, NOT rewrite fps on
   * the existing frames (that would desynchronize the index math).
   */
  describe('legacy tracks with an assumed (unmeasured) fps', () => {
    it('re-extracts when the source video turns out to be denser than the cached track', async () => {
      const legacy = makeTrack(3, { fps: 30, fpsMeasured: undefined });
      vi.mocked(loadPoseTrackFromStorage).mockResolvedValue(legacy);
      vi.mocked(measureVideoFpsFromFile).mockResolvedValue(60);
      vi.mocked(extractPosesFromVideo).mockResolvedValue({
        poseTrack: makeTrack(6, { fps: 60 }),
      } as Awaited<ReturnType<typeof extractPosesFromVideo>>);

      const source = makeSource();
      await source.start();
      await flushTimers();

      expect(extractPosesFromVideo).toHaveBeenCalled();
      expect(source.getPoseTrack()?.metadata.fps).toBe(60);
    });

    it('keeps the cache and stamps it measured when the assumed fps was right', async () => {
      const legacy = makeTrack(3, { fps: 30, fpsMeasured: undefined });
      vi.mocked(loadPoseTrackFromStorage).mockResolvedValue(legacy);
      vi.mocked(measureVideoFpsFromFile).mockResolvedValue(30);

      const source = makeSource();
      await source.start();
      await flushTimers();

      expect(extractPosesFromVideo).not.toHaveBeenCalled();
      expect(source.getPoseTrack()?.metadata.fpsMeasured).toBe(true);
      // Persisted so the measurement cost is paid once, not on every load.
      expect(savePoseTrackToStorage).toHaveBeenCalled();
    });

    it('does not measure at all when the track already records a measured fps', async () => {
      vi.mocked(loadPoseTrackFromStorage).mockResolvedValue(makeTrack(3));

      const source = makeSource();
      await source.start();
      await flushTimers();

      expect(measureVideoFpsFromFile).not.toHaveBeenCalled();
      expect(extractPosesFromVideo).not.toHaveBeenCalled();
    });

    it('keeps the cache when the video measures SLOWER than the cached track', async () => {
      // 25fps source, track sampled at 1/30: the frames really are 1/30 apart
      // (extraction seeks to frameIndex/fps), some just repeat. Index math
      // still holds, so re-extracting would burn minutes to fix nothing.
      const legacy = makeTrack(3, { fps: 30, fpsMeasured: undefined });
      vi.mocked(loadPoseTrackFromStorage).mockResolvedValue(legacy);
      vi.mocked(measureVideoFpsFromFile).mockResolvedValue(25);

      const source = makeSource();
      await source.start();
      await flushTimers();

      expect(extractPosesFromVideo).not.toHaveBeenCalled();
    });

    it('does not stamp a measurement that disagrees, so a cleaner one can re-judge', async () => {
      // The estimator samples 12 frames from a hidden, playing element; dropped
      // presentations read LOW. Stamping on such a reading would exempt the
      // track from every future audit on the strength of one noisy sample.
      const legacy = makeTrack(3, { fps: 30, fpsMeasured: undefined });
      vi.mocked(loadPoseTrackFromStorage).mockResolvedValue(legacy);
      vi.mocked(measureVideoFpsFromFile).mockResolvedValue(15);

      const source = makeSource();
      await source.start();
      await flushTimers();

      expect(extractPosesFromVideo).not.toHaveBeenCalled();
      expect(source.getPoseTrack()?.metadata.fpsMeasured).toBeUndefined();
      expect(savePoseTrackToStorage).not.toHaveBeenCalled();
    });

    it('keeps the cache when measurement fails rather than discarding good data', async () => {
      const legacy = makeTrack(3, { fps: 30, fpsMeasured: undefined });
      vi.mocked(loadPoseTrackFromStorage).mockResolvedValue(legacy);
      vi.mocked(measureVideoFpsFromFile).mockRejectedValue(
        new Error('no rvfc support')
      );

      const source = makeSource();
      await source.start();
      await flushTimers();

      expect(extractPosesFromVideo).not.toHaveBeenCalled();
      expect(source.state.type).toBe('active');
    });
  });
});
