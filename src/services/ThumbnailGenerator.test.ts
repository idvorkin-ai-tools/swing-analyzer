/**
 * ThumbnailQueue generation guard.
 *
 * The queue renders thumbnails by seeking a hidden video element that is
 * SHARED across videos. Requests describe rep numbers and checkpoints from the
 * video that was loaded when they were enqueued, so any request that outlives
 * a source swap would be painted with the NEW video's pixels and then written
 * straight into gallery state.
 *
 * These tests reach into private state on purpose. jsdom never fires
 * `loadeddata`, so isVideoReady stays false and processQueue returns before it
 * touches the queue at all — a black-box test here passes whether or not the
 * guard exists, which is worse than no test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepPosition } from '../analyzers';
import { ThumbnailQueue } from './ThumbnailGenerator';

type QueueInternals = {
  isVideoReady: boolean;
  hiddenVideo: unknown;
  seekVideo: (time: number) => Promise<void>;
  capturePersonCenteredThumbnail: (skeleton: unknown) => ImageData;
};

function makeRenderable(): RepPosition[] {
  // No frameImage => needs rendering, so it is queued rather than
  // short-circuiting to an immediate callback.
  return [
    { name: 'top', videoTime: 1.5, skeleton: null } as unknown as RepPosition,
  ];
}

/** Make the queue believe it has a ready video, without touching real media. */
function armQueue(queue: ThumbnailQueue): void {
  const internals = queue as unknown as QueueInternals;
  internals.isVideoReady = true;
  internals.hiddenVideo = { currentTime: 0, src: '', load: () => {} };
  internals.seekVideo = () => Promise.resolve();
  internals.capturePersonCenteredThumbnail = () => ({}) as ImageData;
}

describe('ThumbnailQueue video-generation guard', () => {
  let queue: ThumbnailQueue;

  beforeEach(() => {
    vi.useFakeTimers();
    queue = new ThumbnailQueue();
    armQueue(queue);
  });

  it('drops queued work when the video source changes before the flush', async () => {
    const callback = vi.fn();
    queue.enqueue(1, makeRenderable(), callback);

    // User picks a different video during the debounce window.
    queue.setVideoSource('blob:video-b');
    armQueue(queue); // setVideoSource resets readiness; re-arm for the flush

    await vi.runAllTimersAsync();

    // Rep 1 belonged to video A. Firing it now would populate video B's
    // gallery with A's checkpoints rendered from B's frames.
    expect(callback).not.toHaveBeenCalled();
  });

  it('still delivers work enqueued against the current source', async () => {
    const callback = vi.fn();
    queue.setVideoSource('blob:video-b');
    armQueue(queue);

    queue.enqueue(2, makeRenderable(), callback);
    await vi.runAllTimersAsync();

    expect(callback).toHaveBeenCalledWith(2, expect.anything());
  });
});
