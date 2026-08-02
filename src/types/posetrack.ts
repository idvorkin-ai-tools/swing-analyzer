/**
 * PoseTrack Types
 *
 * Types for storing and loading pose extraction data separate from video files.
 * This enables:
 * - Faster loading (skip ML model inference)
 * - Better testing (deterministic pose data)
 * - Offline analysis (no WebGL required)
 */

import type { PoseKeypoint } from '../types';

/**
 * Supported pose detection models
 */
export type PoseModel = 'blazepose';

/**
 * Crop region for auto-centering on person in landscape videos
 */
export interface CropRegion {
  /** Left edge in source video pixels */
  x: number;
  /** Top edge in source video pixels */
  y: number;
  /** Width in source video pixels */
  width: number;
  /** Height in source video pixels */
  height: number;
}

/**
 * Metadata about the pose track file
 */
export interface PoseTrackMetadata {
  /** Schema version for forward compatibility */
  version: '1.0';

  /** Model used for pose extraction */
  model: PoseModel;

  /** Specific version of the model (e.g., "1.0.0") */
  modelVersion: string;

  /** BlazePose variant used (lite, full, heavy) */
  modelVariant?: 'lite' | 'full' | 'heavy';

  /** Git SHA of the build that extracted this pose track */
  buildSha?: string;

  /** ISO 8601 timestamp of when the build was created */
  buildTimestamp?: string;

  /** SHA-256 hash of the source video file for matching */
  sourceVideoHash: string;

  /** Original video filename (informational only) */
  sourceVideoName?: string;

  /** Duration of the source video in seconds */
  sourceVideoDuration: number;

  /** ISO 8601 timestamp when poses were extracted */
  extractedAt: string;

  /** Total number of frames in the pose track */
  frameCount: number;

  /**
   * Frames per second of the source video, which is ALSO the spacing of the
   * frames in this track — extraction samples at 1/fps, and playback maps
   * videoTime→frame index with it. The two must stay consistent: correcting
   * this value on an existing track desynchronizes every index lookup.
   */
  fps: number;

  /**
   * True when `fps` came from measuring the source video. Tracks extracted
   * before measurement existed assumed 30, so they sampled a 60fps source at
   * half resolution. Absent/false means "assumed" — the loader remeasures and
   * re-extracts if the assumption was wrong. Always true on new extractions.
   */
  fpsMeasured?: boolean;

  /** Width of the source video in pixels */
  videoWidth: number;

  /** Height of the source video in pixels */
  videoHeight: number;

  /** Auto-detected crop region for landscape videos (optional) */
  cropRegion?: CropRegion;
}

/**
 * Pre-computed angles for a single frame (optional optimization)
 */
export interface PrecomputedAngles {
  /** Spine angle in degrees */
  spineAngle: number;

  /** Arm to spine angle in degrees */
  armToSpineAngle: number;

  /** Arm to vertical angle in degrees */
  armToVerticalAngle: number;

  /** Hip angle in degrees (optional) */
  hipAngle?: number;

  /** Knee angle in degrees (optional) */
  kneeAngle?: number;

  /** Wrist speed in m/s (smoothed over ~5 frames) */
  wristSpeed?: number;
}

/**
 * A single frame of pose data, in its PERSISTED shape.
 *
 * Deliberately cannot carry a frame image. ImageData is structured-cloneable,
 * so an image that reaches this type gets written to IndexedDB at ~77KB per
 * frame — the bloat regression that motivated the split. The `never` below is
 * what enforces it: an ExtractionFrame (frameImage?: ImageData) is NOT
 * assignable to PoseTrackFrame, so the compiler rejects handing runtime frames
 * to save/serialize. Omitting the field would not — TypeScript only flags
 * excess properties on fresh object literals, not on variables.
 */
export interface PoseTrackFrame {
  /** Frame index (0-based) */
  frameIndex: number;

  /** Timestamp in milliseconds from video start */
  timestamp: number;

  /** Video currentTime in seconds */
  videoTime: number;

  /** Array of keypoints detected in this frame */
  keypoints: PoseKeypoint[];

  /** Overall pose confidence score (0-1) */
  score?: number;

  /** Pre-computed angles (optional, saves ~20% analysis time) */
  angles?: PrecomputedAngles;

  /** Never present on persisted frames — see the note above. */
  frameImage?: never;
}

/**
 * A pose frame in flight: extraction and the live cache, where the captured
 * image is still attached for filmstrip thumbnails. Cross into the persisted
 * world through stripRuntimeFields(), which is the only supported converter.
 */
export type ExtractionFrame = Omit<PoseTrackFrame, 'frameImage'> & {
  /**
   * Frame image captured during extraction for filmstrip thumbnails.
   * Cleared after thumbnail creation to conserve memory.
   */
  frameImage?: ImageData;
};

/**
 * The fields common to both frame shapes. Use this for helpers that read or
 * mutate pose data and genuinely do not care whether an image is attached —
 * it accepts both without letting either leak into the other.
 */
export type PoseFrameData = Omit<PoseTrackFrame, 'frameImage'>;

/**
 * Complete pose track file structure (persisted shape)
 */
export interface PoseTrackFile {
  /** File metadata */
  metadata: PoseTrackMetadata;

  /** Array of pose frames */
  frames: PoseTrackFrame[];
}

/**
 * A pose track still holding runtime frame images — what extraction produces
 * before stripRuntimeFields() converts it for storage.
 */
export type ExtractionPoseTrack = Omit<PoseTrackFile, 'frames'> & {
  frames: ExtractionFrame[];
};

/**
 * Options for pose extraction
 */
export interface PoseExtractionOptions {
  /** Model to use for extraction */
  model: PoseModel;

  /** BlazePose variant (lite, full, heavy) */
  modelVariant?: 'lite' | 'full' | 'heavy';

  /** Whether to pre-compute angles during extraction */
  precomputeAngles?: boolean;

  /** Callback for progress updates */
  onProgress?: (progress: PoseExtractionProgress) => void;

  /**
   * Callback fired for each frame as it's extracted.
   * Use this to progressively populate a LivePoseCache for streaming playback.
   */
  onFrameExtracted?: (frame: ExtractionFrame) => void;

  /** AbortSignal for cancellation */
  signal?: AbortSignal;
}

/**
 * Progress information during pose extraction
 */
export interface PoseExtractionProgress {
  /** Current frame being processed */
  currentFrame: number;

  /** Total frames to process */
  totalFrames: number;

  /** Progress percentage (0-100) */
  percentage: number;

  /** Current video time in seconds */
  currentTime: number;

  /** Total video duration in seconds */
  totalDuration: number;

  /** Estimated time remaining in seconds */
  estimatedTimeRemaining?: number;

  /** Elapsed time in seconds */
  elapsedTime?: number;

  /** Current extraction speed in frames per second */
  fps?: number;

  /** Current keypoints (for live preview) */
  currentKeypoints?: PoseKeypoint[];
}

/**
 * Result of pose extraction
 */
export interface PoseExtractionResult {
  /** The extracted pose track */
  poseTrack: ExtractionPoseTrack;

  /** Time taken to extract in milliseconds */
  extractionTimeMs: number;

  /** Average frames per second during extraction */
  extractionFps: number;
}

/**
 * Status of pose track for a video
 */
export type PoseTrackStatus =
  | { type: 'none' }
  | { type: 'extracting'; progress: PoseExtractionProgress }
  | { type: 'ready'; poseTrack: PoseTrackFile; fromCache: boolean }
  | { type: 'error'; error: string };

/**
 * Storage info for a saved pose track
 */
export interface SavedPoseTrackInfo {
  /** Filename of the pose track */
  filename: string;

  /** Video hash this pose track is for */
  videoHash: string;

  /** Original video name */
  videoName?: string;

  /** Model used for extraction */
  model: PoseModel;

  /** Number of frames */
  frameCount: number;

  /** Duration in seconds */
  duration: number;

  /** File size in bytes */
  fileSize: number;

  /** When the pose track was created */
  createdAt: string;
}
