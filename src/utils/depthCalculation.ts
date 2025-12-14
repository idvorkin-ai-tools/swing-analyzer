/**
 * Depth calculation utilities for pistol squat analysis.
 *
 * Uses ear Y position (head height) which is more stable than knee angles.
 * Higher ear Y = lower physical position (image coordinates: 0 = top).
 *
 * TYPE SAFETY: Uses branded types to prevent mixing pixel and normalized coordinates.
 * - PixelY: Raw pixel coordinates from BlazePose (e.g., 450 pixels)
 * - NormalizedY: Normalized to 0-1 range (e.g., 0.42)
 * - DepthPercent: Depth percentage 0-100
 */

import type { PoseKeypoint } from '../types';
import {
  asDepthPercent,
  asNormalizedY,
  asPixelY,
  DEFAULT_VIDEO_HEIGHT,
  type DepthPercent,
  type NormalizedY,
  normalizeY,
  type PixelY,
  type VideoHeight,
} from './brandedTypes';

// Re-export branded types for backwards compatibility
export {
  asDepthPercent,
  asNormalizedY,
  asPixelY,
  asVideoHeight,
  DEFAULT_VIDEO_HEIGHT,
  type DepthPercent,
  type NormalizedY,
  normalizeY,
  type PixelY,
  type VideoHeight,
} from './brandedTypes';

// ============================================
// Constants
// ============================================

// MediaPipe keypoint indices
const LEFT_EAR = 7;
const RIGHT_EAR = 8;
const NOSE = 0;

// ============================================
// Core Functions
// ============================================

/**
 * Get average ear Y position from keypoints (in pixels).
 * Falls back to nose if ears not available.
 *
 * @param keypoints Array of keypoints from skeleton
 * @returns Y position in pixels (0 = top of frame)
 */
export function getEarYPixels(keypoints: PoseKeypoint[]): PixelY {
  const leftEar = keypoints[LEFT_EAR];
  const rightEar = keypoints[RIGHT_EAR];
  const nose = keypoints[NOSE];

  if (leftEar && rightEar) {
    return asPixelY((leftEar.y + rightEar.y) / 2);
  } else if (leftEar) {
    return asPixelY(leftEar.y);
  } else if (rightEar) {
    return asPixelY(rightEar.y);
  }
  // Fallback to nose if ears not available
  // Return a typical standing position (about 20% down from top)
  return asPixelY(nose?.y ?? DEFAULT_VIDEO_HEIGHT * 0.2);
}

/**
 * Calculate depth percentage from normalized ear Y position.
 *
 * Standing position: normalizedEarY ~0.15-0.25 (person tall, head near top)
 * Deep squat: normalizedEarY ~0.5-0.7 (person low, head near middle/bottom)
 *
 * @param normalizedEarY Ear Y position normalized to 0-1
 * @returns Depth percentage (0-100), clamped
 */
export function calculateDepthFromNormalizedY(
  normalizedEarY: NormalizedY
): DepthPercent {
  // Convert normalized ear Y to depth percentage
  // ~0.15 = 0% (standing), ~0.65 = 100% (full squat)
  const STANDING_EAR_Y = 0.15;
  const SQUAT_RANGE = 0.5; // normalized earY travel from standing to full squat

  const depthRaw = ((normalizedEarY - STANDING_EAR_Y) / SQUAT_RANGE) * 100;
  return asDepthPercent(Math.max(0, Math.min(100, Math.round(depthRaw))));
}

/**
 * Calculate depth percentage directly from keypoints.
 * Normalizes pixel coordinates using videoHeight before calculating depth.
 *
 * @param keypoints Array of keypoints from skeleton (pixel coordinates)
 * @param videoHeight Video height in pixels for normalization (defaults to 1080)
 * @returns Depth percentage (0-100)
 */
export function calculateDepthFromKeypoints(
  keypoints: PoseKeypoint[],
  videoHeight: VideoHeight = DEFAULT_VIDEO_HEIGHT
): DepthPercent {
  const earYPixels = getEarYPixels(keypoints);
  const normalizedEarY = normalizeY(earYPixels, videoHeight);
  return calculateDepthFromNormalizedY(normalizedEarY);
}

// ============================================
// Legacy Compatibility (for existing tests)
// ============================================

/**
 * @deprecated Use getEarYPixels instead for type safety
 * Get average ear Y position from keypoints.
 */
export function getEarY(keypoints: PoseKeypoint[]): number {
  return getEarYPixels(keypoints);
}

/**
 * @deprecated Use calculateDepthFromNormalizedY instead for type safety
 * Calculate depth percentage from ear Y position.
 * IMPORTANT: Expects NORMALIZED ear Y (0-1), not pixels!
 */
export function calculateDepthFromEarY(normalizedEarY: number): number {
  return calculateDepthFromNormalizedY(asNormalizedY(normalizedEarY));
}
