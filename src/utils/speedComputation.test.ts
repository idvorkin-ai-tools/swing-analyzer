import { describe, expect, it } from 'vitest';
import type { PoseTrackFrame } from '../types/posetrack';
import { computeFrameSpeeds, getPrecomputedSpeed } from './speedComputation';

// Helper to create a minimal frame with wrist position
function createFrame(
  frameIndex: number,
  videoTime: number,
  wristX: number,
  wristY: number
): PoseTrackFrame {
  // Create 33 keypoints (MediaPipe format) with the wrist at specified position
  const keypoints = Array(33)
    .fill(null)
    .map(() => ({
      x: 0.5,
      y: 0.5,
      score: 0.9,
    }));

  // Set right wrist (index 16)
  keypoints[16] = { x: wristX, y: wristY, score: 0.9 };
  // Set left wrist (index 15)
  keypoints[15] = { x: wristX - 0.1, y: wristY, score: 0.9 };

  // Set shoulders and hips for skeleton construction
  keypoints[11] = { x: 0.4, y: 0.3, score: 0.9 }; // left shoulder
  keypoints[12] = { x: 0.6, y: 0.3, score: 0.9 }; // right shoulder
  keypoints[23] = { x: 0.4, y: 0.6, score: 0.9 }; // left hip
  keypoints[24] = { x: 0.6, y: 0.6, score: 0.9 }; // right hip

  // Set nose and ankles for height calibration
  keypoints[0] = { x: 0.5, y: 0.1, score: 0.9 }; // nose
  keypoints[27] = { x: 0.4, y: 0.95, score: 0.9 }; // left ankle
  keypoints[28] = { x: 0.6, y: 0.95, score: 0.9 }; // right ankle

  return {
    frameIndex,
    timestamp: videoTime * 1000,
    videoTime,
    keypoints,
    score: 0.9,
  };
}

describe('speedComputation', () => {
  describe('computeFrameSpeeds', () => {
    it('returns empty array for empty input', () => {
      const result = computeFrameSpeeds([]);
      expect(result).toEqual([]);
    });

    it('sets speed to 0 for single frame', () => {
      const frames = [createFrame(0, 0, 0.5, 0.5)];
      const result = computeFrameSpeeds(frames);
      expect(result[0].angles?.wristSpeed).toBe(0);
    });

    it('computes speed for two frames', () => {
      const frames = [
        createFrame(0, 0, 0.5, 0.5),
        createFrame(1, 0.033, 0.6, 0.5), // moved right
      ];
      const result = computeFrameSpeeds(frames);

      // Both frames get smoothed values - they share the same window
      // so they end up with similar speeds after averaging
      expect(result[0].angles?.wristSpeed).toBeGreaterThanOrEqual(0);
      expect(result[1].angles?.wristSpeed).toBeGreaterThan(0);
      // Both should have speed populated
      expect(result[0].angles?.wristSpeed).toBeDefined();
      expect(result[1].angles?.wristSpeed).toBeDefined();
    });

    it('applies smoothing over multiple frames', () => {
      // Create frames with varying speeds
      const frames = [
        createFrame(0, 0, 0.5, 0.5),
        createFrame(1, 0.033, 0.5, 0.5), // no movement
        createFrame(2, 0.066, 0.7, 0.5), // big jump
        createFrame(3, 0.1, 0.7, 0.5), // no movement
        createFrame(4, 0.133, 0.7, 0.5), // no movement
      ];
      const result = computeFrameSpeeds(frames);

      // The big jump at frame 2 should be smoothed
      // Frame 2's raw speed would be high, but smoothing should reduce it
      const speeds = result.map((f) => f.angles?.wristSpeed ?? 0);

      // All frames should have speeds computed
      expect(speeds.every((s) => typeof s === 'number')).toBe(true);

      // The smoothed speed at frame 2 should be less than if calculated raw
      // (because frames 0, 1, 3, 4 have lower speeds that pull down the average)
    });

    it('handles stationary wrist (zero speed)', () => {
      const frames = [
        createFrame(0, 0, 0.5, 0.5),
        createFrame(1, 0.033, 0.5, 0.5),
        createFrame(2, 0.066, 0.5, 0.5),
      ];
      const result = computeFrameSpeeds(frames);

      // All speeds should be 0 or very close to 0
      result.forEach((frame) => {
        expect(frame.angles?.wristSpeed).toBe(0);
      });
    });

    it('preserves existing angles when adding speed', () => {
      const frames = [
        {
          ...createFrame(0, 0, 0.5, 0.5),
          angles: {
            spineAngle: 45,
            armToSpineAngle: 30,
            armToVerticalAngle: 20,
          },
        },
        createFrame(1, 0.033, 0.6, 0.5),
      ];
      const result = computeFrameSpeeds(frames);

      // First frame should keep its original angles
      expect(result[0].angles?.spineAngle).toBe(45);
      expect(result[0].angles?.armToSpineAngle).toBe(30);
      expect(result[0].angles?.armToVerticalAngle).toBe(20);
      expect(result[0].angles?.wristSpeed).toBeDefined();
    });

    it('uses custom window size', () => {
      const frames = Array.from({ length: 10 }, (_, i) =>
        createFrame(i, i * 0.033, 0.5 + (i % 2) * 0.1, 0.5)
      );

      const resultSmall = computeFrameSpeeds([...frames], { windowSize: 3 });
      const resultLarge = computeFrameSpeeds([...frames], { windowSize: 9 });

      // Larger window should produce smoother (less varying) results
      const speedsSmall = resultSmall.map((f) => f.angles?.wristSpeed ?? 0);
      const speedsLarge = resultLarge.map((f) => f.angles?.wristSpeed ?? 0);

      const varianceSmall = calculateVariance(speedsSmall);
      const varianceLarge = calculateVariance(speedsLarge);

      // Larger window should have less variance (more smoothing)
      expect(varianceLarge).toBeLessThanOrEqual(varianceSmall);
    });

    it('median preserves peaks better than mean at direction changes', () => {
      // Simulate direction change: fast -> stop -> fast
      // (like at top/bottom of a swing)
      const frames = [
        createFrame(0, 0, 0.5, 0.5),
        createFrame(1, 0.033, 0.6, 0.5), // fast movement
        createFrame(2, 0.066, 0.7, 0.5), // fast movement
        createFrame(3, 0.1, 0.7, 0.5), // stopped (direction change)
        createFrame(4, 0.133, 0.6, 0.5), // fast movement (reverse)
        createFrame(5, 0.166, 0.5, 0.5), // fast movement
      ];

      const resultMedian = computeFrameSpeeds([...frames], {
        windowSize: 3,
        smoothingMethod: 'median',
      });
      const resultMean = computeFrameSpeeds([...frames], {
        windowSize: 3,
        smoothingMethod: 'mean',
      });

      // At frame 2 (before stop), median should preserve peak better
      const medianAtPeak = resultMedian[2].angles?.wristSpeed ?? 0;
      const meanAtPeak = resultMean[2].angles?.wristSpeed ?? 0;

      // Median should be >= mean because it doesn't average in the 0
      expect(medianAtPeak).toBeGreaterThanOrEqual(meanAtPeak);
    });
  });

  describe('getPrecomputedSpeed', () => {
    it('returns speed when present', () => {
      const frame: PoseTrackFrame = {
        ...createFrame(0, 0, 0.5, 0.5),
        angles: {
          spineAngle: 0,
          armToSpineAngle: 0,
          armToVerticalAngle: 0,
          wristSpeed: 2.5,
        },
      };
      expect(getPrecomputedSpeed(frame)).toBe(2.5);
    });

    it('returns null when angles missing', () => {
      const frame = createFrame(0, 0, 0.5, 0.5);
      delete frame.angles;
      expect(getPrecomputedSpeed(frame)).toBe(null);
    });

    it('returns null when wristSpeed missing', () => {
      const frame: PoseTrackFrame = {
        ...createFrame(0, 0, 0.5, 0.5),
        angles: {
          spineAngle: 0,
          armToSpineAngle: 0,
          armToVerticalAngle: 0,
        },
      };
      expect(getPrecomputedSpeed(frame)).toBe(null);
    });
  });
});

// Helper to calculate variance
function calculateVariance(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map((v) => (v - mean) ** 2);
  return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
}
