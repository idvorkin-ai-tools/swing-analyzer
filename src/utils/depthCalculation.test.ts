import { describe, expect, it } from 'vitest';
import type { PoseKeypoint } from '../types';
import {
  calculateDepthFromEarY,
  calculateDepthFromKeypoints,
  getEarY,
} from './depthCalculation';

// Helper to create a keypoint
function kp(x: number, y: number, score = 0.9): PoseKeypoint {
  return { x, y, z: 0, score };
}

// Helper to create keypoints array with ears at specific Y
function createKeypointsWithEars(
  leftEarY: number | null,
  rightEarY: number | null,
  noseY = 0.2
): PoseKeypoint[] {
  const keypoints: PoseKeypoint[] = new Array(33).fill(null);
  keypoints[0] = kp(0.5, noseY); // NOSE
  if (leftEarY !== null) {
    keypoints[7] = kp(0.4, leftEarY); // LEFT_EAR
  }
  if (rightEarY !== null) {
    keypoints[8] = kp(0.6, rightEarY); // RIGHT_EAR
  }
  return keypoints;
}

describe('depthCalculation', () => {
  describe('getEarY', () => {
    it('returns average of both ears when both available', () => {
      const keypoints = createKeypointsWithEars(0.3, 0.4);
      expect(getEarY(keypoints)).toBe(0.35);
    });

    it('returns left ear Y when only left ear available', () => {
      const keypoints = createKeypointsWithEars(0.3, null);
      expect(getEarY(keypoints)).toBe(0.3);
    });

    it('returns right ear Y when only right ear available', () => {
      const keypoints = createKeypointsWithEars(null, 0.4);
      expect(getEarY(keypoints)).toBe(0.4);
    });

    it('falls back to nose when no ears available', () => {
      const keypoints = createKeypointsWithEars(null, null, 0.25);
      expect(getEarY(keypoints)).toBe(0.25);
    });

    it('returns default 0.2 when no keypoints available', () => {
      const keypoints: PoseKeypoint[] = new Array(33).fill(null);
      expect(getEarY(keypoints)).toBe(0.2);
    });
  });

  describe('calculateDepthFromEarY', () => {
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
      // Standing: ears at Y = 0.15 -> 0% depth
      const keypoints = createKeypointsWithEars(0.15, 0.15);
      expect(calculateDepthFromKeypoints(keypoints)).toBe(0);
    });

    it('calculates depth from squat position keypoints', () => {
      // Half squat: ears at Y = 0.4 -> 50% depth
      const keypoints = createKeypointsWithEars(0.4, 0.4);
      expect(calculateDepthFromKeypoints(keypoints)).toBe(50);
    });

    it('calculates depth from deep squat keypoints', () => {
      // Deep squat: ears at Y = 0.65 -> 100% depth
      const keypoints = createKeypointsWithEars(0.65, 0.65);
      expect(calculateDepthFromKeypoints(keypoints)).toBe(100);
    });

    it('handles asymmetric ear positions', () => {
      // Ears at different Y (tilted head): average = 0.4 -> 50%
      const keypoints = createKeypointsWithEars(0.35, 0.45);
      expect(calculateDepthFromKeypoints(keypoints)).toBe(50);
    });
  });
});
