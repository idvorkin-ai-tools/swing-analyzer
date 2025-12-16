import { describe, expect, it } from 'vitest';
import type { CropRegion } from '../../types/posetrack';
import {
  calculateCanvasPlacement,
  calculateNormalModePlacement,
  calculateScaleFactors,
  calculateZoomedModePlacement,
  type VideoDimensions,
  type VideoRect,
} from './canvasSyncUtils';

describe('canvasSyncUtils', () => {
  // Common test fixtures
  const portraitVideo: VideoDimensions = {
    videoWidth: 1080,
    videoHeight: 1920,
  };
  const landscapeVideo: VideoDimensions = {
    videoWidth: 1920,
    videoHeight: 1080,
  };
  const squareVideo: VideoDimensions = { videoWidth: 1000, videoHeight: 1000 };

  const portraitContainer: VideoRect = { width: 400, height: 800 };
  const landscapeContainer: VideoRect = { width: 800, height: 400 };
  const squareContainer: VideoRect = { width: 500, height: 500 };

  const zeroOffset = { x: 0, y: 0 };
  const nonZeroOffset = { x: 50, y: 100 };

  describe('calculateNormalModePlacement', () => {
    describe('portrait video in portrait container', () => {
      it('fits width when video is narrower than container', () => {
        const result = calculateNormalModePlacement(
          portraitVideo,
          portraitContainer,
          zeroOffset
        );

        // 1080/1920 = 0.5625 aspect ratio
        // Container is 400x800 = 0.5 aspect ratio
        // Video aspect (0.5625) > container aspect (0.5) = letterbox top/bottom
        expect(result.width).toBe(400);
        expect(result.height).toBeCloseTo(400 / 0.5625, 1);
      });

      it('centers vertically when letterboxing', () => {
        const result = calculateNormalModePlacement(
          portraitVideo,
          portraitContainer,
          zeroOffset
        );

        const expectedHeight = 400 / (1080 / 1920);
        const expectedOffset = (800 - expectedHeight) / 2;
        expect(result.top).toBeCloseTo(expectedOffset, 1);
        expect(result.left).toBe(0);
      });
    });

    describe('landscape video in portrait container', () => {
      it('fits width and letterboxes top/bottom', () => {
        const result = calculateNormalModePlacement(
          landscapeVideo,
          portraitContainer,
          zeroOffset
        );

        // 1920/1080 = 1.78 aspect ratio
        // Container is 400x800 = 0.5 aspect ratio
        // Video aspect (1.78) > container aspect (0.5) = letterbox top/bottom
        expect(result.width).toBe(400);
        expect(result.height).toBeCloseTo(400 / (1920 / 1080), 1);
      });
    });

    describe('portrait video in landscape container', () => {
      it('fits height and letterboxes left/right', () => {
        const result = calculateNormalModePlacement(
          portraitVideo,
          landscapeContainer,
          zeroOffset
        );

        // Video aspect (0.5625) < container aspect (2) = letterbox left/right
        expect(result.height).toBe(400);
        expect(result.width).toBeCloseTo(400 * (1080 / 1920), 1);
      });

      it('centers horizontally when letterboxing', () => {
        const result = calculateNormalModePlacement(
          portraitVideo,
          landscapeContainer,
          zeroOffset
        );

        const expectedWidth = 400 * (1080 / 1920);
        const expectedOffset = (800 - expectedWidth) / 2;
        expect(result.left).toBeCloseTo(expectedOffset, 1);
        expect(result.top).toBe(0);
      });
    });

    describe('square video in square container', () => {
      it('fills container with no letterboxing', () => {
        const result = calculateNormalModePlacement(
          squareVideo,
          squareContainer,
          zeroOffset
        );

        expect(result.width).toBe(500);
        expect(result.height).toBe(500);
        expect(result.left).toBe(0);
        expect(result.top).toBe(0);
      });
    });

    describe('offset handling', () => {
      it('adds offset to calculated position', () => {
        const result = calculateNormalModePlacement(
          squareVideo,
          squareContainer,
          nonZeroOffset
        );

        expect(result.left).toBe(50);
        expect(result.top).toBe(100);
      });
    });
  });

  describe('calculateZoomedModePlacement', () => {
    const centerCrop: CropRegion = {
      x: 400,
      y: 800,
      width: 200,
      height: 400,
    };

    describe('cover behavior', () => {
      it('scales to cover entire container', () => {
        const result = calculateZoomedModePlacement(
          portraitVideo,
          portraitContainer,
          zeroOffset,
          centerCrop
        );

        // Cover scale: max(400/1080, 800/1920) = max(0.37, 0.42) = 0.42
        const coverScale = Math.max(400 / 1080, 800 / 1920);
        expect(result.width).toBeCloseTo(1080 * coverScale, 1);
        expect(result.height).toBeCloseTo(1920 * coverScale, 1);
      });
    });

    describe('crop region centering', () => {
      it('calculates object-position for crop center', () => {
        const crop: CropRegion = { x: 0, y: 0, width: 1080, height: 1920 };
        const result = calculateZoomedModePlacement(
          portraitVideo,
          portraitContainer,
          zeroOffset,
          crop
        );

        // Crop center is (540, 960) / (1080, 1920) = (0.5, 0.5)
        expect(result.objectPosition).toBe('50% 50%');
      });

      it('handles off-center crop region', () => {
        const offCenterCrop: CropRegion = {
          x: 0,
          y: 0,
          width: 540,
          height: 960,
        };
        const result = calculateZoomedModePlacement(
          portraitVideo,
          portraitContainer,
          zeroOffset,
          offCenterCrop
        );

        // Crop center is (270, 480) / (1080, 1920) = (0.25, 0.25)
        expect(result.objectPosition).toBe('25% 25%');
      });

      it('handles edge crop region', () => {
        const edgeCrop: CropRegion = {
          x: 540,
          y: 960,
          width: 540,
          height: 960,
        };
        const result = calculateZoomedModePlacement(
          portraitVideo,
          portraitContainer,
          zeroOffset,
          edgeCrop
        );

        // Crop center is (810, 1440) / (1080, 1920) = (0.75, 0.75)
        expect(result.objectPosition).toBe('75% 75%');
      });
    });

    describe('offset handling', () => {
      it('incorporates video offset in canvas position', () => {
        const result = calculateZoomedModePlacement(
          squareVideo,
          squareContainer,
          nonZeroOffset,
          { x: 0, y: 0, width: 1000, height: 1000 }
        );

        // With matching aspects, no overflow offset
        // But videoOffset should still apply
        expect(result.left).toBe(50);
        expect(result.top).toBe(100);
      });
    });
  });

  describe('calculateCanvasPlacement', () => {
    const crop: CropRegion = { x: 0, y: 0, width: 100, height: 100 };

    it('uses normal mode when not zoomed', () => {
      const result = calculateCanvasPlacement(
        squareVideo,
        squareContainer,
        zeroOffset,
        false,
        null
      );

      expect(result.objectPosition).toBeUndefined();
    });

    it('uses normal mode when zoomed but no crop', () => {
      const result = calculateCanvasPlacement(
        squareVideo,
        squareContainer,
        zeroOffset,
        true,
        null
      );

      expect(result.objectPosition).toBeUndefined();
    });

    it('uses zoomed mode when zoomed with crop', () => {
      const result = calculateCanvasPlacement(
        squareVideo,
        squareContainer,
        zeroOffset,
        true,
        crop
      );

      expect(result.objectPosition).toBeDefined();
    });
  });

  describe('calculateScaleFactors', () => {
    it('calculates correct scale for uniform scaling', () => {
      const placement = { width: 500, height: 500, left: 0, top: 0 };
      const result = calculateScaleFactors(squareVideo, placement);

      expect(result.scaleX).toBe(0.5);
      expect(result.scaleY).toBe(0.5);
    });

    it('handles non-uniform scaling', () => {
      const placement = { width: 540, height: 960, left: 0, top: 0 };
      const result = calculateScaleFactors(portraitVideo, placement);

      expect(result.scaleX).toBe(0.5);
      expect(result.scaleY).toBe(0.5);
    });

    it('handles scale > 1 (upscaling)', () => {
      const placement = { width: 2000, height: 2000, left: 0, top: 0 };
      const result = calculateScaleFactors(squareVideo, placement);

      expect(result.scaleX).toBe(2);
      expect(result.scaleY).toBe(2);
    });
  });

  describe('edge cases', () => {
    it('handles very small container', () => {
      const tinyContainer = { width: 10, height: 10 };
      const result = calculateNormalModePlacement(
        landscapeVideo,
        tinyContainer,
        zeroOffset
      );

      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
    });

    it('handles extreme aspect ratios', () => {
      const ultraWide = { videoWidth: 3840, videoHeight: 480 };
      const result = calculateNormalModePlacement(
        ultraWide,
        squareContainer,
        zeroOffset
      );

      // Aspect ratio 8:1 should letterbox significantly
      expect(result.width).toBe(500);
      expect(result.height).toBeCloseTo(62.5, 1);
      expect(result.top).toBeCloseTo((500 - 62.5) / 2, 1);
    });

    it('handles negative offset (uncommon but valid)', () => {
      const negativeOffset = { x: -10, y: -20 };
      const result = calculateNormalModePlacement(
        squareVideo,
        squareContainer,
        negativeOffset
      );

      expect(result.left).toBe(-10);
      expect(result.top).toBe(-20);
    });
  });
});
