import { describe, expect, it } from 'vitest';
import {
  asConfidence,
  asPixelX,
  asPixelY,
  asVideoHeight,
  asVideoWidth,
} from './brandedTypes';
import {
  type CropKeypoint,
  type CropOptions,
  calculatePersonCenteredCrop,
} from './thumbnailCrop';

// Standard thumbnail dimensions (3:4 portrait aspect ratio)
const THUMB_WIDTH = 120;
const THUMB_HEIGHT = 160;

// Standard 1080p video
const VIDEO_WIDTH = 1920;
const VIDEO_HEIGHT = 1080;

/** Helper to create keypoint with branded types */
function kp(x: number, y: number, score: number): CropKeypoint {
  return { x: asPixelX(x), y: asPixelY(y), score: asConfidence(score) };
}

function makeOptions(
  overrides: Omit<Partial<CropOptions>, 'videoWidth' | 'videoHeight'> & {
    videoWidth?: number;
    videoHeight?: number;
  } = {}
): CropOptions {
  const {
    videoWidth = VIDEO_WIDTH,
    videoHeight = VIDEO_HEIGHT,
    ...rest
  } = overrides;
  return {
    thumbWidth: THUMB_WIDTH,
    thumbHeight: THUMB_HEIGHT,
    videoWidth: asVideoWidth(videoWidth),
    videoHeight: asVideoHeight(videoHeight),
    ...rest,
  };
}

describe('calculatePersonCenteredCrop', () => {
  describe('with no keypoints', () => {
    it('returns center crop with fallback size', () => {
      const result = calculatePersonCenteredCrop([], makeOptions());

      // Fallback is 85% of video height
      const expectedHeight = VIDEO_HEIGHT * 0.85;
      const expectedWidth = expectedHeight * (THUMB_WIDTH / THUMB_HEIGHT);

      expect(result.cropHeight).toBeCloseTo(expectedHeight, 1);
      expect(result.cropWidth).toBeCloseTo(expectedWidth, 1);
      // Should be centered
      expect(result.cropX).toBeCloseTo((VIDEO_WIDTH - expectedWidth) / 2, 1);
      expect(result.cropY).toBeCloseTo((VIDEO_HEIGHT - expectedHeight) / 2, 1);
    });
  });

  describe('with low confidence keypoints', () => {
    it('ignores keypoints below confidence threshold', () => {
      const keypoints: CropKeypoint[] = [
        kp(100, 100, 0.1), // Below threshold
        kp(200, 200, 0.2), // Below threshold
      ];

      const result = calculatePersonCenteredCrop(keypoints, makeOptions());

      // Should use fallback since no confident keypoints
      const expectedHeight = VIDEO_HEIGHT * 0.85;
      expect(result.cropHeight).toBeCloseTo(expectedHeight, 1);
    });

    it('uses custom confidence threshold', () => {
      const keypoints: CropKeypoint[] = [kp(500, 300, 0.5), kp(600, 400, 0.5)];

      // With high threshold, these should be ignored
      const highThreshold = calculatePersonCenteredCrop(
        keypoints,
        makeOptions({ minConfidence: asConfidence(0.8) })
      );
      expect(highThreshold.cropHeight).toBeCloseTo(VIDEO_HEIGHT * 0.85, 1);

      // With low threshold, these should be used
      const lowThreshold = calculatePersonCenteredCrop(
        keypoints,
        makeOptions({ minConfidence: asConfidence(0.3) })
      );
      // Person-centered crop should be smaller than fallback
      expect(lowThreshold.cropHeight).toBeLessThan(VIDEO_HEIGHT * 0.85);
    });
  });

  describe('with confident keypoints (pixel coordinates)', () => {
    it('centers crop on person bounding box', () => {
      // Person in center of frame (pixel coordinates)
      const keypoints: CropKeypoint[] = [
        kp(900, 400, 0.9), // top
        kp(900, 700, 0.9), // bottom
        kp(800, 550, 0.9), // left
        kp(1000, 550, 0.9), // right
      ];

      const result = calculatePersonCenteredCrop(keypoints, makeOptions());

      // Person center should be at (900, 550)
      const expectedCenterX = 900;
      const expectedCenterY = 550;

      // Crop should be centered on person
      const actualCenterX = result.cropX + result.cropWidth / 2;
      const actualCenterY = result.cropY + result.cropHeight / 2;

      expect(actualCenterX).toBeCloseTo(expectedCenterX, 0);
      expect(actualCenterY).toBeCloseTo(expectedCenterY, 0);
    });

    it('handles person at left edge of frame', () => {
      // Person near left edge
      const keypoints: CropKeypoint[] = [kp(50, 400, 0.9), kp(150, 600, 0.9)];

      const result = calculatePersonCenteredCrop(keypoints, makeOptions());

      // Crop should be clamped to left edge
      expect(result.cropX).toBe(0);
      // Crop should still be valid
      expect(result.cropX + result.cropWidth).toBeLessThanOrEqual(VIDEO_WIDTH);
    });

    it('handles person at right edge of frame', () => {
      // Person near right edge
      const keypoints: CropKeypoint[] = [
        kp(1800, 400, 0.9),
        kp(1900, 600, 0.9),
      ];

      const result = calculatePersonCenteredCrop(keypoints, makeOptions());

      // Crop should be clamped to right edge
      expect(result.cropX + result.cropWidth).toBe(VIDEO_WIDTH);
    });

    it('handles person at top edge of frame', () => {
      // Person near top
      const keypoints: CropKeypoint[] = [kp(960, 50, 0.9), kp(960, 150, 0.9)];

      const result = calculatePersonCenteredCrop(keypoints, makeOptions());

      expect(result.cropY).toBe(0);
    });

    it('handles person at bottom edge of frame', () => {
      // Person near bottom
      const keypoints: CropKeypoint[] = [kp(960, 950, 0.9), kp(960, 1050, 0.9)];

      const result = calculatePersonCenteredCrop(keypoints, makeOptions());

      expect(result.cropY + result.cropHeight).toBe(VIDEO_HEIGHT);
    });
  });

  describe('aspect ratio preservation', () => {
    it('maintains target aspect ratio for tall person', () => {
      // Tall thin person
      const keypoints: CropKeypoint[] = [kp(950, 200, 0.9), kp(970, 800, 0.9)];

      const result = calculatePersonCenteredCrop(keypoints, makeOptions());

      const actualAspect = result.cropWidth / result.cropHeight;
      const targetAspect = THUMB_WIDTH / THUMB_HEIGHT;
      expect(actualAspect).toBeCloseTo(targetAspect, 2);
    });

    it('maintains target aspect ratio for wide person', () => {
      // Wide pose (arms stretched)
      const keypoints: CropKeypoint[] = [
        kp(600, 500, 0.9),
        kp(1300, 500, 0.9),
        kp(950, 400, 0.9),
        kp(950, 600, 0.9),
      ];

      const result = calculatePersonCenteredCrop(keypoints, makeOptions());

      const actualAspect = result.cropWidth / result.cropHeight;
      const targetAspect = THUMB_WIDTH / THUMB_HEIGHT;
      expect(actualAspect).toBeCloseTo(targetAspect, 2);
    });
  });

  describe('minimum crop size', () => {
    it('enforces minimum crop height for small person', () => {
      // Very small person (far from camera)
      const keypoints: CropKeypoint[] = [kp(960, 500, 0.9), kp(980, 520, 0.9)];

      const result = calculatePersonCenteredCrop(keypoints, makeOptions());

      // Should be at least 40% of video height
      expect(result.cropHeight).toBeGreaterThanOrEqual(VIDEO_HEIGHT * 0.4);
    });

    it('uses custom minimum crop height fraction', () => {
      const keypoints: CropKeypoint[] = [kp(960, 500, 0.9), kp(980, 520, 0.9)];

      const result = calculatePersonCenteredCrop(
        keypoints,
        makeOptions({ minCropHeightFraction: 0.6 })
      );

      expect(result.cropHeight).toBeGreaterThanOrEqual(VIDEO_HEIGHT * 0.6);
    });
  });

  describe('video bounds clamping', () => {
    it('clamps crop width to video width for very wide source', () => {
      // Very wide aspect ratio video
      const options = makeOptions({
        videoWidth: 500, // Narrow video
        videoHeight: 1000,
      });

      const keypoints: CropKeypoint[] = [kp(250, 500, 0.9)];

      const result = calculatePersonCenteredCrop(keypoints, options);

      expect(result.cropWidth).toBeLessThanOrEqual(500);
      expect(result.cropX).toBeGreaterThanOrEqual(0);
      expect(result.cropX + result.cropWidth).toBeLessThanOrEqual(500);
    });
  });

  describe('regression: pixel vs normalized coordinates', () => {
    it('treats keypoints as pixel coordinates (not normalized)', () => {
      // This test ensures we don't accidentally multiply by video dimensions
      // BlazePose keypoints are already in pixel coordinates
      const keypoints: CropKeypoint[] = [
        kp(960, 540, 0.9), // Center of 1920x1080 video
      ];

      const result = calculatePersonCenteredCrop(keypoints, makeOptions());

      // Center should be around (960, 540), not (960*1920, 540*1080)
      const centerX = result.cropX + result.cropWidth / 2;
      const centerY = result.cropY + result.cropHeight / 2;

      // If we incorrectly multiplied by video dimensions, center would be way off
      expect(centerX).toBeCloseTo(960, 0);
      expect(centerY).toBeCloseTo(540, 0);
    });

    it('handles keypoints at exact pixel positions', () => {
      // Specific pixel positions that would be wrong if multiplied
      const keypoints: CropKeypoint[] = [kp(100, 100, 0.9), kp(200, 200, 0.9)];

      const result = calculatePersonCenteredCrop(keypoints, makeOptions());

      // Person center at (150, 150) in pixel coords
      // If normalized and multiplied by 1920x1080, would be at (288000, 162000) - way outside frame
      expect(result.cropX).toBeLessThan(VIDEO_WIDTH);
      expect(result.cropY).toBeLessThan(VIDEO_HEIGHT);
    });
  });
});
