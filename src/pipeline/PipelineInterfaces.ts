import type { Skeleton } from '../models/Skeleton';
import type { PrecomputedAngles } from '../types/posetrack';
import type { TimestampMs, VideoTimeSeconds } from '../utils/brandedTypes';
import type { PoseEvent } from './PoseSkeletonTransformer';

/**
 * Frame acquisition stage - processes raw video/camera frames
 */
export interface FrameAcquisition {
  /**
   * Get the current frame
   */
  getCurrentFrame(): HTMLCanvasElement | HTMLVideoElement;
}

/**
 * A frame event with the source element and timestamp
 */
export interface FrameEvent {
  frame: HTMLCanvasElement | HTMLVideoElement;
  timestamp: TimestampMs;
  videoTime?: VideoTimeSeconds; // video.currentTime in seconds (for seeking)

  /**
   * Frame image captured during extraction.
   * Only populated in extraction mode by PoseExtractor.
   * Undefined during playback, camera mode, or real-time processing.
   * Used for filmstrip thumbnail capture when main video is at wrong position.
   */
  frameImage?: ImageData;
}

/**
 * Skeleton transformer stage - transforms frames into skeleton models
 * Combines pose detection and skeleton construction into a single stage
 */
export interface SkeletonTransformer {
  /**
   * Initialize the skeleton transformer
   */
  initialize(): Promise<void>;

  /**
   * Transform a frame event into a skeleton (Promise-based)
   * Use this for video-event-driven processing without RxJS subscriptions.
   */
  transformToSkeletonAsync(frameEvent: FrameEvent): Promise<SkeletonEvent>;
}

/**
 * A skeleton event with the skeleton and original frame data
 */
export interface SkeletonEvent {
  skeleton: Skeleton | null;
  poseEvent: PoseEvent;
  /** Precomputed angles from pose track (optional, for cached data) */
  precomputedAngles?: PrecomputedAngles;
}
