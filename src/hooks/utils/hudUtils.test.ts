import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPINE_THRESHOLDS,
  estimateSwingPosition,
  isHingedPosition,
  isUprightPosition,
  type SpineAngleThresholds,
} from './hudUtils';

describe('hudUtils', () => {
  describe('estimateSwingPosition', () => {
    describe('with default thresholds', () => {
      it('returns Top for spine angle < 25', () => {
        expect(estimateSwingPosition(0)).toBe('Top');
        expect(estimateSwingPosition(10)).toBe('Top');
        expect(estimateSwingPosition(24)).toBe('Top');
        expect(estimateSwingPosition(24.9)).toBe('Top');
      });

      it('returns Release for spine angle 25-40', () => {
        expect(estimateSwingPosition(25)).toBe('Release');
        expect(estimateSwingPosition(30)).toBe('Release');
        expect(estimateSwingPosition(37)).toBe('Release'); // Ideal release angle
        expect(estimateSwingPosition(40)).toBe('Release');
        expect(estimateSwingPosition(40.9)).toBe('Release');
      });

      it('returns Connect for spine angle 41-59', () => {
        expect(estimateSwingPosition(41)).toBe('Connect');
        expect(estimateSwingPosition(45)).toBe('Connect'); // Ideal connect angle
        expect(estimateSwingPosition(50)).toBe('Connect');
        expect(estimateSwingPosition(59)).toBe('Connect');
        expect(estimateSwingPosition(59.9)).toBe('Connect');
      });

      it('returns Bottom for spine angle >= 60', () => {
        expect(estimateSwingPosition(60)).toBe('Bottom');
        expect(estimateSwingPosition(75)).toBe('Bottom'); // Ideal bottom angle
        expect(estimateSwingPosition(90)).toBe('Bottom');
        expect(estimateSwingPosition(120)).toBe('Bottom');
      });
    });

    describe('with custom thresholds', () => {
      const customThresholds: SpineAngleThresholds = {
        topMax: 20,
        releaseMax: 35,
        connectMax: 50,
      };

      it('respects custom topMax', () => {
        expect(estimateSwingPosition(19, customThresholds)).toBe('Top');
        expect(estimateSwingPosition(20, customThresholds)).toBe('Release');
      });

      it('respects custom releaseMax', () => {
        expect(estimateSwingPosition(34, customThresholds)).toBe('Release');
        expect(estimateSwingPosition(35, customThresholds)).toBe('Connect');
      });

      it('respects custom connectMax', () => {
        expect(estimateSwingPosition(49, customThresholds)).toBe('Connect');
        expect(estimateSwingPosition(50, customThresholds)).toBe('Bottom');
      });
    });

    describe('edge cases', () => {
      it('returns null for negative angles', () => {
        expect(estimateSwingPosition(-1)).toBe(null);
        expect(estimateSwingPosition(-45)).toBe(null);
      });

      it('returns null for NaN', () => {
        expect(estimateSwingPosition(Number.NaN)).toBe(null);
      });

      it('returns null for Infinity', () => {
        expect(estimateSwingPosition(Number.POSITIVE_INFINITY)).toBe(null);
        expect(estimateSwingPosition(Number.NEGATIVE_INFINITY)).toBe(null);
      });

      it('handles boundary values precisely', () => {
        // Test exact threshold boundaries
        expect(estimateSwingPosition(24.999)).toBe('Top');
        expect(estimateSwingPosition(25.0)).toBe('Release');
        expect(estimateSwingPosition(40.999)).toBe('Release');
        expect(estimateSwingPosition(41.0)).toBe('Connect');
        expect(estimateSwingPosition(59.999)).toBe('Connect');
        expect(estimateSwingPosition(60.0)).toBe('Bottom');
      });

      it('handles zero angle', () => {
        expect(estimateSwingPosition(0)).toBe('Top');
      });
    });
  });

  describe('isHingedPosition', () => {
    it('returns true for angles >= 60 (default threshold)', () => {
      expect(isHingedPosition(60)).toBe(true);
      expect(isHingedPosition(75)).toBe(true);
      expect(isHingedPosition(90)).toBe(true);
    });

    it('returns false for angles < 60 (default threshold)', () => {
      expect(isHingedPosition(0)).toBe(false);
      expect(isHingedPosition(30)).toBe(false);
      expect(isHingedPosition(59)).toBe(false);
      expect(isHingedPosition(59.9)).toBe(false);
    });

    it('respects custom threshold', () => {
      expect(isHingedPosition(50, 45)).toBe(true);
      expect(isHingedPosition(50, 55)).toBe(false);
      expect(isHingedPosition(70, 70)).toBe(true);
      expect(isHingedPosition(69, 70)).toBe(false);
    });

    it('returns false for NaN', () => {
      expect(isHingedPosition(Number.NaN)).toBe(false);
    });

    it('returns false for Infinity', () => {
      expect(isHingedPosition(Number.POSITIVE_INFINITY)).toBe(false);
    });
  });

  describe('isUprightPosition', () => {
    it('returns true for angles < 25 (default threshold)', () => {
      expect(isUprightPosition(0)).toBe(true);
      expect(isUprightPosition(10)).toBe(true);
      expect(isUprightPosition(24)).toBe(true);
      expect(isUprightPosition(24.9)).toBe(true);
    });

    it('returns false for angles >= 25 (default threshold)', () => {
      expect(isUprightPosition(25)).toBe(false);
      expect(isUprightPosition(30)).toBe(false);
      expect(isUprightPosition(60)).toBe(false);
    });

    it('respects custom threshold', () => {
      expect(isUprightPosition(15, 20)).toBe(true);
      expect(isUprightPosition(25, 30)).toBe(true);
      expect(isUprightPosition(25, 20)).toBe(false);
    });

    it('returns false for NaN', () => {
      expect(isUprightPosition(Number.NaN)).toBe(false);
    });

    it('returns false for negative Infinity', () => {
      expect(isUprightPosition(Number.NEGATIVE_INFINITY)).toBe(false);
    });
  });

  describe('DEFAULT_SPINE_THRESHOLDS', () => {
    it('has expected values for kettlebell swing', () => {
      expect(DEFAULT_SPINE_THRESHOLDS.topMax).toBe(25);
      expect(DEFAULT_SPINE_THRESHOLDS.releaseMax).toBe(41);
      expect(DEFAULT_SPINE_THRESHOLDS.connectMax).toBe(60);
    });

    it('thresholds are in increasing order', () => {
      expect(DEFAULT_SPINE_THRESHOLDS.topMax).toBeLessThan(
        DEFAULT_SPINE_THRESHOLDS.releaseMax
      );
      expect(DEFAULT_SPINE_THRESHOLDS.releaseMax).toBeLessThan(
        DEFAULT_SPINE_THRESHOLDS.connectMax
      );
    });
  });
});
