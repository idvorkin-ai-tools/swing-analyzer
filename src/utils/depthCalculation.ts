/**
 * Depth calculation utilities for pistol squat analysis.
 *
 * Uses ear Y position (head height) which is more stable than knee angles.
 * Higher ear Y = lower physical position (image coordinates: 0 = top).
 */

import type { PoseKeypoint } from '../types';

// MediaPipe keypoint indices
const LEFT_EAR = 7;
const RIGHT_EAR = 8;
const NOSE = 0;

/**
 * Get average ear Y position from keypoints.
 * Falls back to nose if ears not available.
 *
 * @param keypoints Array of keypoints from skeleton
 * @returns Y position (0 = top of frame, 1 = bottom)
 */
export function getEarY(keypoints: PoseKeypoint[]): number {
  const leftEar = keypoints[LEFT_EAR];
  const rightEar = keypoints[RIGHT_EAR];
  const nose = keypoints[NOSE];

  if (leftEar && rightEar) {
    return (leftEar.y + rightEar.y) / 2;
  } else if (leftEar) {
    return leftEar.y;
  } else if (rightEar) {
    return rightEar.y;
  }
  // Fallback to nose if ears not available
  return nose?.y ?? 0.2;
}

/**
 * Calculate depth percentage from ear Y position.
 *
 * Standing position: earY ~0.15-0.25 (person tall, head near top)
 * Deep squat: earY ~0.5-0.7 (person low, head near middle/bottom)
 *
 * @param earY Ear Y position (0-1 normalized)
 * @returns Depth percentage (0-100), clamped
 */
export function calculateDepthFromEarY(earY: number): number {
  // Convert ear Y to depth percentage
  // ~0.15 = 0% (standing), ~0.65 = 100% (full squat)
  const STANDING_EAR_Y = 0.15;
  const SQUAT_RANGE = 0.5; // earY travel from standing to full squat

  const depthRaw = ((earY - STANDING_EAR_Y) / SQUAT_RANGE) * 100;
  return Math.max(0, Math.min(100, Math.round(depthRaw)));
}

/**
 * Calculate depth percentage directly from keypoints.
 * Convenience function combining getEarY and calculateDepthFromEarY.
 *
 * @param keypoints Array of keypoints from skeleton
 * @returns Depth percentage (0-100)
 */
export function calculateDepthFromKeypoints(keypoints: PoseKeypoint[]): number {
  const earY = getEarY(keypoints);
  return calculateDepthFromEarY(earY);
}
