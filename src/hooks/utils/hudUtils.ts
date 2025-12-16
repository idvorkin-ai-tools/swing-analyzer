/**
 * Pure utility functions for HUD (Heads-Up Display) calculations.
 * These are extracted from useExerciseAnalyzer for testability.
 *
 * All functions are pure - same inputs produce same outputs.
 */

import type { Skeleton } from '../../models/Skeleton';
import type { PoseKeypoint } from '../../types';
import type { VideoHeight } from '../../utils/brandedTypes';
import { calculateDepthFromKeypoints } from '../../utils/depthCalculation';

/**
 * Angle data extracted from a skeleton for HUD display.
 */
export interface HudAngles {
  spineAngle: number;
  armAngle: number;
  speed: number;
  kneeAngle: number;
  hipAngle: number;
  depth: number;
}

/**
 * Extracts all HUD-relevant angles from a skeleton.
 * Returns rounded values ready for display.
 *
 * @param skeleton - The skeleton to extract angles from
 * @param videoHeight - Video height for depth calculation normalization
 * @param precomputedSpeed - Pre-calculated wrist speed (from smoothed data)
 * @returns All angles needed for HUD display
 */
export function extractHudAngles(
  skeleton: Skeleton,
  videoHeight: VideoHeight,
  precomputedSpeed?: number
): HudAngles {
  const spine = Math.round(skeleton.getSpineAngle() || 0);
  const arm = Math.round(skeleton.getArmToVerticalAngle() || 0);

  // Calculate working knee (more bent = lower angle = deeper squat)
  const leftKnee = skeleton.getKneeAngleForSide('left') || 180;
  const rightKnee = skeleton.getKneeAngleForSide('right') || 180;
  const workingKnee = Math.min(leftKnee, rightKnee);

  // Calculate working hip (more bent = lower angle)
  const leftHip = skeleton.getHipAngleForSide('left') || 180;
  const rightHip = skeleton.getHipAngleForSide('right') || 180;
  const workingHip = Math.min(leftHip, rightHip);

  // Depth percentage using ear Y position
  const depth = calculateDepthFromKeypoints(
    skeleton.getKeypoints() as PoseKeypoint[],
    videoHeight
  );

  return {
    spineAngle: spine,
    armAngle: arm,
    speed: precomputedSpeed ?? 0,
    kneeAngle: Math.round(workingKnee),
    hipAngle: Math.round(workingHip),
    depth,
  };
}

/**
 * Swing position (phase) names in the movement cycle.
 */
export type SwingPosition = 'Top' | 'Release' | 'Connect' | 'Bottom';

/**
 * Thresholds for spine angle position estimation.
 * Based on kettlebell swing biomechanics:
 * - Top: ~10° (upright standing)
 * - Release: ~37° (arms extending)
 * - Connect: ~45° (arm-spine connection)
 * - Bottom: ~75° (hip hinge)
 */
export interface SpineAngleThresholds {
  topMax: number; // Below this = Top
  releaseMax: number; // topMax to releaseMax = Release
  connectMax: number; // releaseMax to connectMax = Connect
  // Above connectMax = Bottom
}

/**
 * Default thresholds tuned for kettlebell swing.
 */
export const DEFAULT_SPINE_THRESHOLDS: SpineAngleThresholds = {
  topMax: 25,
  releaseMax: 41,
  connectMax: 60,
};

/**
 * Estimates the current swing position from spine angle.
 * Uses configurable thresholds for flexibility.
 *
 * @param spineAngle - Current spine angle in degrees
 * @param thresholds - Optional custom thresholds (defaults to kettlebell swing)
 * @returns The estimated position, or null if angle is invalid
 */
export function estimateSwingPosition(
  spineAngle: number,
  thresholds: SpineAngleThresholds = DEFAULT_SPINE_THRESHOLDS
): SwingPosition | null {
  if (!Number.isFinite(spineAngle) || spineAngle < 0) {
    return null;
  }

  if (spineAngle < thresholds.topMax) {
    return 'Top';
  }
  if (spineAngle < thresholds.releaseMax) {
    return 'Release';
  }
  if (spineAngle < thresholds.connectMax) {
    return 'Connect';
  }
  return 'Bottom';
}

/**
 * Determines if a spine angle indicates a hinged position (hip hinge).
 * Used for kettlebell swing form analysis.
 *
 * @param spineAngle - Spine angle in degrees
 * @param threshold - Minimum angle to be considered hinged (default 60)
 * @returns true if in a hinged position
 */
export function isHingedPosition(
  spineAngle: number,
  threshold: number = 60
): boolean {
  return Number.isFinite(spineAngle) && spineAngle >= threshold;
}

/**
 * Determines if a spine angle indicates an upright position.
 *
 * @param spineAngle - Spine angle in degrees
 * @param threshold - Maximum angle to be considered upright (default 25)
 * @returns true if in an upright position
 */
export function isUprightPosition(
  spineAngle: number,
  threshold: number = 25
): boolean {
  return Number.isFinite(spineAngle) && spineAngle < threshold;
}
