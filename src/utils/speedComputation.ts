/**
 * Speed Computation Utilities
 *
 * Computes smoothed wrist speeds from pose track frames in a single pass.
 * Uses median smoothing to preserve peaks while removing noise.
 * Median is better than mean for speed because it handles direction
 * changes (where speed drops to 0 briefly) without diluting peak speeds.
 */

import { buildSkeletonFromFrame } from '../pipeline/PipelineFactory';
import type { PoseTrackFrame } from '../types/posetrack';
import {
  asSeconds,
  DEFAULT_USER_HEIGHT_CM,
  type HeightCm,
  type MetersPerSecond,
  type Seconds,
} from './brandedTypes';

/**
 * Configuration for speed computation
 */
export interface SpeedComputationConfig {
  /** Number of frames for smoothing window (should be odd) */
  windowSize?: number;
  /** User height in cm for pixel-to-meter calibration */
  userHeightCm?: HeightCm;
  /** Which wrist to track */
  preferredSide?: 'left' | 'right';
  /** Smoothing method: 'median' preserves peaks, 'mean' smoother */
  smoothingMethod?: 'median' | 'mean';
}

const DEFAULT_CONFIG: Required<SpeedComputationConfig> = {
  windowSize: 3, // Small window preserves responsiveness
  userHeightCm: DEFAULT_USER_HEIGHT_CM,
  preferredSide: 'right',
  smoothingMethod: 'median', // Median preserves peaks at direction changes
};

/**
 * Compute raw frame-to-frame speeds for all frames.
 * Returns array of speeds (m/s) aligned with frames.
 * First frame has speed 0 (no previous frame to compare).
 */
function computeRawSpeeds(
  frames: PoseTrackFrame[],
  config: Required<SpeedComputationConfig>
): (MetersPerSecond | null)[] {
  const speeds: (MetersPerSecond | null)[] = new Array(frames.length).fill(
    null
  );

  if (frames.length < 2) return speeds;

  // Build skeletons for all frames
  const skeletons = frames.map((frame) => {
    try {
      return buildSkeletonFromFrame(frame.keypoints);
    } catch {
      return null;
    }
  });

  // Compute speed between consecutive frames
  for (let i = 1; i < frames.length; i++) {
    const prevSkeleton = skeletons[i - 1];
    const currSkeleton = skeletons[i];

    if (!prevSkeleton || !currSkeleton) {
      speeds[i] = null;
      continue;
    }

    const dtRaw = frames[i].videoTime - frames[i - 1].videoTime;
    if (dtRaw <= 0 || dtRaw > 0.5) {
      // Invalid time delta
      speeds[i] = null;
      continue;
    }
    const dt: Seconds = asSeconds(dtRaw);

    const speed = currSkeleton.getWristVelocityFromPrev(
      prevSkeleton,
      dt,
      config.userHeightCm,
      config.preferredSide
    );
    speeds[i] = speed;
  }

  return speeds;
}

/**
 * Get median of an array of numbers
 */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Apply smoothing to speed values.
 * - 'median': Preserves peaks, robust to outliers (direction changes)
 * - 'mean': Smoother but can dilute peaks
 */
function smoothSpeeds(
  rawSpeeds: (MetersPerSecond | null)[],
  windowSize: number,
  method: 'median' | 'mean' = 'median'
): number[] {
  const smoothed: number[] = new Array(rawSpeeds.length).fill(0);
  const halfWindow = Math.floor(windowSize / 2);

  for (let i = 0; i < rawSpeeds.length; i++) {
    const windowStart = Math.max(0, i - halfWindow);
    const windowEnd = Math.min(rawSpeeds.length - 1, i + halfWindow);

    const windowValues: number[] = [];
    for (let j = windowStart; j <= windowEnd; j++) {
      const speed = rawSpeeds[j];
      if (speed !== null) {
        windowValues.push(speed);
      }
    }

    if (windowValues.length === 0) {
      smoothed[i] = 0;
    } else if (method === 'median') {
      smoothed[i] = median(windowValues);
    } else {
      // mean
      smoothed[i] =
        windowValues.reduce((a, b) => a + b, 0) / windowValues.length;
    }
  }

  return smoothed;
}

/**
 * Compute smoothed wrist speeds for all frames in a pose track.
 * This is a one-time pass that populates the angles.wristSpeed field.
 *
 * @param frames - Array of pose track frames (modified in place)
 * @param config - Configuration options
 * @returns The modified frames array
 */
export function computeFrameSpeeds(
  frames: PoseTrackFrame[],
  config: SpeedComputationConfig = {}
): PoseTrackFrame[] {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };

  // Compute raw speeds
  const rawSpeeds = computeRawSpeeds(frames, fullConfig);

  // Apply smoothing (median preserves peaks at direction changes)
  const smoothedSpeeds = smoothSpeeds(
    rawSpeeds,
    fullConfig.windowSize,
    fullConfig.smoothingMethod
  );

  // Populate frames with smoothed speeds
  for (let i = 0; i < frames.length; i++) {
    // Ensure angles object exists
    const angles = frames[i].angles ?? {
      spineAngle: 0,
      armToSpineAngle: 0,
      armToVerticalAngle: 0,
    };
    // Round to 2 decimal places for display
    angles.wristSpeed = Math.round(smoothedSpeeds[i] * 100) / 100;
    frames[i].angles = angles;
  }

  return frames;
}

/**
 * Get the precomputed wrist speed for a frame, or null if not available.
 */
export function getPrecomputedSpeed(frame: PoseTrackFrame): number | null {
  return frame.angles?.wristSpeed ?? null;
}
