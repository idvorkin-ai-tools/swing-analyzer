import { describe, expect, it } from 'vitest';
import type { PoseKeypoint } from '../types';
import {
  asNormalizedY,
  asPixelY,
  asVideoHeight,
  calculateDepthFromEarY,
  calculateDepthFromKeypoints,
  calculateDepthFromNormalizedY,
  getEarY,
  getEarYPixels,
  type NormalizedY,
  normalizeY,
  type PixelY,
  type VideoHeight,
} from './depthCalculation';

// Test video height for consistent testing
const TEST_VIDEO_HEIGHT: VideoHeight = asVideoHeight(1000);

// Helper to create a keypoint with pixel coordinates
function kp(x: number, yPixels: number, score = 0.9): PoseKeypoint {
  return { x, y: yPixels, z: 0, score };
}

// Helper to convert normalized Y to pixels for test video height
function toPixels(normalizedY: number): number {
  return normalizedY * TEST_VIDEO_HEIGHT;
}

// Helper to create keypoints array with ears at specific normalized Y positions
// Internally converts to pixel coordinates based on TEST_VIDEO_HEIGHT
function createKeypointsWithEars(
  leftEarNormalizedY: number | null,
  rightEarNormalizedY: number | null,
  noseNormalizedY = 0.2
): PoseKeypoint[] {
  const keypoints: PoseKeypoint[] = new Array(33).fill(null);
  keypoints[0] = kp(0.5, toPixels(noseNormalizedY)); // NOSE
  if (leftEarNormalizedY !== null) {
    keypoints[7] = kp(0.4, toPixels(leftEarNormalizedY)); // LEFT_EAR
  }
  if (rightEarNormalizedY !== null) {
    keypoints[8] = kp(0.6, toPixels(rightEarNormalizedY)); // RIGHT_EAR
  }
  return keypoints;
}

describe('depthCalculation', () => {
  describe('branded types', () => {
    it('allows explicit conversion with type constructors', () => {
      const pixelY: PixelY = asPixelY(450);
      const normalizedY: NormalizedY = asNormalizedY(0.45);
      const videoHeight: VideoHeight = asVideoHeight(1080);

      // These compile because of explicit conversion
      expect(pixelY).toBe(450);
      expect(normalizedY).toBe(0.45);
      expect(videoHeight).toBe(1080);
    });

    it('normalizeY converts pixels to normalized correctly', () => {
      const pixelY: PixelY = asPixelY(540);
      const videoHeight: VideoHeight = asVideoHeight(1080);
      const normalized = normalizeY(pixelY, videoHeight);
      expect(normalized).toBe(0.5);
    });
  });

  describe('getEarYPixels', () => {
    it('returns average of both ears when both available', () => {
      const keypoints = createKeypointsWithEars(0.3, 0.4);
      expect(getEarYPixels(keypoints)).toBe(toPixels(0.35));
    });

    it('returns left ear Y when only left ear available', () => {
      const keypoints = createKeypointsWithEars(0.3, null);
      expect(getEarYPixels(keypoints)).toBe(toPixels(0.3));
    });

    it('returns right ear Y when only right ear available', () => {
      const keypoints = createKeypointsWithEars(null, 0.4);
      expect(getEarYPixels(keypoints)).toBe(toPixels(0.4));
    });

    it('falls back to nose when no ears available', () => {
      const keypoints = createKeypointsWithEars(null, null, 0.25);
      expect(getEarYPixels(keypoints)).toBe(toPixels(0.25));
    });
  });

  describe('getEarY (legacy)', () => {
    it('returns average of both ears when both available', () => {
      const keypoints = createKeypointsWithEars(0.3, 0.4);
      expect(getEarY(keypoints)).toBe(toPixels(0.35));
    });

    it('returns left ear Y when only left ear available', () => {
      const keypoints = createKeypointsWithEars(0.3, null);
      expect(getEarY(keypoints)).toBe(toPixels(0.3));
    });

    it('returns right ear Y when only right ear available', () => {
      const keypoints = createKeypointsWithEars(null, 0.4);
      expect(getEarY(keypoints)).toBe(toPixels(0.4));
    });

    it('falls back to nose when no ears available', () => {
      const keypoints = createKeypointsWithEars(null, null, 0.25);
      expect(getEarY(keypoints)).toBe(toPixels(0.25));
    });
  });

  describe('calculateDepthFromNormalizedY', () => {
    it('returns 0% for standing position (normalizedY = 0.15)', () => {
      expect(calculateDepthFromNormalizedY(asNormalizedY(0.15))).toBe(0);
    });

    it('returns 0% for positions above standing (normalizedY < 0.15)', () => {
      expect(calculateDepthFromNormalizedY(asNormalizedY(0.1))).toBe(0);
      expect(calculateDepthFromNormalizedY(asNormalizedY(0.05))).toBe(0);
    });

    it('returns ~50% for half squat (normalizedY = 0.4)', () => {
      // (0.4 - 0.15) / 0.5 * 100 = 50%
      expect(calculateDepthFromNormalizedY(asNormalizedY(0.4))).toBe(50);
    });

    it('returns 100% for full squat (normalizedY = 0.65)', () => {
      // (0.65 - 0.15) / 0.5 * 100 = 100%
      expect(calculateDepthFromNormalizedY(asNormalizedY(0.65))).toBe(100);
    });

    it('caps at 100% for very deep positions', () => {
      expect(calculateDepthFromNormalizedY(asNormalizedY(0.8))).toBe(100);
      expect(calculateDepthFromNormalizedY(asNormalizedY(1.0))).toBe(100);
    });

    it('returns reasonable intermediate values', () => {
      // Quarter squat: (0.275 - 0.15) / 0.5 * 100 = 25%
      expect(calculateDepthFromNormalizedY(asNormalizedY(0.275))).toBe(25);

      // Three-quarter squat: (0.525 - 0.15) / 0.5 * 100 = 75%
      expect(calculateDepthFromNormalizedY(asNormalizedY(0.525))).toBe(75);
    });
  });

  describe('calculateDepthFromEarY (legacy)', () => {
    it('returns 0% for standing position (earY = 0.15)', () => {
      expect(calculateDepthFromEarY(0.15)).toBe(0);
    });

    it('returns 0% for positions above standing (earY < 0.15)', () => {
      expect(calculateDepthFromEarY(0.1)).toBe(0);
      expect(calculateDepthFromEarY(0.05)).toBe(0);
    });

    it('returns ~50% for half squat (earY = 0.4)', () => {
      // (0.4 - 0.15) / 0.5 * 100 = 50%
      expect(calculateDepthFromEarY(0.4)).toBe(50);
    });

    it('returns 100% for full squat (earY = 0.65)', () => {
      // (0.65 - 0.15) / 0.5 * 100 = 100%
      expect(calculateDepthFromEarY(0.65)).toBe(100);
    });

    it('caps at 100% for very deep positions', () => {
      expect(calculateDepthFromEarY(0.8)).toBe(100);
      expect(calculateDepthFromEarY(1.0)).toBe(100);
    });

    it('returns reasonable intermediate values', () => {
      // Quarter squat: (0.275 - 0.15) / 0.5 * 100 = 25%
      expect(calculateDepthFromEarY(0.275)).toBe(25);

      // Three-quarter squat: (0.525 - 0.15) / 0.5 * 100 = 75%
      expect(calculateDepthFromEarY(0.525)).toBe(75);
    });
  });

  describe('calculateDepthFromKeypoints', () => {
    it('calculates depth from standing position keypoints', () => {
      // Standing: ears at normalized Y = 0.15 -> 0% depth
      const keypoints = createKeypointsWithEars(0.15, 0.15);
      expect(calculateDepthFromKeypoints(keypoints, TEST_VIDEO_HEIGHT)).toBe(0);
    });

    it('calculates depth from squat position keypoints', () => {
      // Half squat: ears at normalized Y = 0.4 -> 50% depth
      const keypoints = createKeypointsWithEars(0.4, 0.4);
      expect(calculateDepthFromKeypoints(keypoints, TEST_VIDEO_HEIGHT)).toBe(
        50
      );
    });

    it('calculates depth from deep squat keypoints', () => {
      // Deep squat: ears at normalized Y = 0.65 -> 100% depth
      const keypoints = createKeypointsWithEars(0.65, 0.65);
      expect(calculateDepthFromKeypoints(keypoints, TEST_VIDEO_HEIGHT)).toBe(
        100
      );
    });

    it('handles asymmetric ear positions', () => {
      // Ears at different Y (tilted head): average normalized = 0.4 -> 50%
      const keypoints = createKeypointsWithEars(0.35, 0.45);
      expect(calculateDepthFromKeypoints(keypoints, TEST_VIDEO_HEIGHT)).toBe(
        50
      );
    });

    it('works with default video height (1080p)', () => {
      // Create keypoints with pixel values for 1080p video
      const keypoints: PoseKeypoint[] = new Array(33).fill(null);
      keypoints[7] = kp(0.4, 432); // LEFT_EAR at 40% of 1080 = 432px
      keypoints[8] = kp(0.6, 432); // RIGHT_EAR at 40% of 1080 = 432px
      // normalized 0.4 -> 50% depth
      expect(calculateDepthFromKeypoints(keypoints)).toBe(50);
    });
  });
});
