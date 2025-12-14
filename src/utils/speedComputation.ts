/**
 * Speed Computation Utilities
 *
 * Computes smoothed wrist speeds from pose track frames in a single pass.
 * Uses a centered moving average for smooth, stable speed values.
 */

import { buildSkeletonFromFrame } from '../pipeline/PipelineFactory';
import type { PoseTrackFrame } from '../types/posetrack';

/**
 * Configuration for speed computation
 */
export interface SpeedComputationConfig {
  /** Number of frames to average over (should be odd for centered average) */
  windowSize?: number;
  /** User height in cm for pixel-to-meter calibration */
  userHeightCm?: number;
  /** Which wrist to track */
  preferredSide?: 'left' | 'right';
}

const DEFAULT_CONFIG: Required<SpeedComputationConfig> = {
  windowSize: 5,
  userHeightCm: 173,
  preferredSide: 'right',
};

/**
 * Compute raw frame-to-frame speeds for all frames.
 * Returns array of speeds (m/s) aligned with frames.
 * First frame has speed 0 (no previous frame to compare).
 */
function computeRawSpeeds(
  frames: PoseTrackFrame[],
  config: Required<SpeedComputationConfig>
): (number | null)[] {
  const speeds: (number | null)[] = new Array(frames.length).fill(null);

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

    const dt = frames[i].videoTime - frames[i - 1].videoTime;
    if (dt <= 0 || dt > 0.5) {
      // Invalid time delta
      speeds[i] = null;
      continue;
    }

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
 * Apply centered moving average smoothing to speed values.
 * Handles null values by excluding them from the average.
 */
function smoothSpeeds(
  rawSpeeds: (number | null)[],
  windowSize: number
): number[] {
  const smoothed: number[] = new Array(rawSpeeds.length).fill(0);
  const halfWindow = Math.floor(windowSize / 2);

  for (let i = 0; i < rawSpeeds.length; i++) {
    const windowStart = Math.max(0, i - halfWindow);
    const windowEnd = Math.min(rawSpeeds.length - 1, i + halfWindow);

    let sum = 0;
    let count = 0;

    for (let j = windowStart; j <= windowEnd; j++) {
      const speed = rawSpeeds[j];
      if (speed !== null) {
        sum += speed;
        count++;
      }
    }

    smoothed[i] = count > 0 ? sum / count : 0;
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

  // Apply smoothing
  const smoothedSpeeds = smoothSpeeds(rawSpeeds, fullConfig.windowSize);

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
