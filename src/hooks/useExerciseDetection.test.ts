import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  type ExerciseDetectionEvent,
  useExerciseDetection,
} from './useExerciseDetection';

describe('useExerciseDetection', () => {
  describe('initial state', () => {
    it('starts with unknown exercise', () => {
      const { result } = renderHook(() => useExerciseDetection());

      expect(result.current.detectedExercise).toBe('unknown');
    });

    it('starts with zero confidence', () => {
      const { result } = renderHook(() => useExerciseDetection());

      expect(result.current.detectionConfidence).toBe(0);
    });

    it('starts unlocked', () => {
      const { result } = renderHook(() => useExerciseDetection());

      expect(result.current.isDetectionLocked).toBe(false);
    });

    it('starts with default phases', () => {
      const { result } = renderHook(() => useExerciseDetection());

      expect(result.current.currentPhases).toEqual([
        'top',
        'connect',
        'bottom',
        'release',
      ]);
    });

    it('starts with no working leg', () => {
      const { result } = renderHook(() => useExerciseDetection());

      expect(result.current.workingLeg).toBeNull();
    });
  });

  describe('handleDetectionEvent', () => {
    it('updates exercise type from detection', () => {
      const { result } = renderHook(() => useExerciseDetection());
      const event: ExerciseDetectionEvent = {
        exercise: 'kettlebell-swing',
        confidence: 80,
      };

      act(() => {
        result.current.handleDetectionEvent(event, false);
      });

      expect(result.current.detectedExercise).toBe('kettlebell-swing');
      expect(result.current.detectionConfidence).toBe(80);
    });

    it('locks detection at 90+ confidence', () => {
      const { result } = renderHook(() => useExerciseDetection());
      const event: ExerciseDetectionEvent = {
        exercise: 'kettlebell-swing',
        confidence: 90,
      };

      act(() => {
        result.current.handleDetectionEvent(event, false);
      });

      expect(result.current.isDetectionLocked).toBe(true);
    });

    it('does not lock detection below 90 confidence', () => {
      const { result } = renderHook(() => useExerciseDetection());
      const event: ExerciseDetectionEvent = {
        exercise: 'kettlebell-swing',
        confidence: 89,
      };

      act(() => {
        result.current.handleDetectionEvent(event, false);
      });

      expect(result.current.isDetectionLocked).toBe(false);
    });

    it('ignores event when already locked', () => {
      const { result } = renderHook(() => useExerciseDetection());

      // First event - high confidence locks
      act(() => {
        result.current.handleDetectionEvent(
          { exercise: 'kettlebell-swing', confidence: 95 },
          false
        );
      });
      expect(result.current.detectedExercise).toBe('kettlebell-swing');

      // Second event - should be ignored because wasAlreadyLocked=true
      act(() => {
        result.current.handleDetectionEvent(
          { exercise: 'pistol-squat', confidence: 100 },
          true
        );
      });

      expect(result.current.detectedExercise).toBe('kettlebell-swing');
    });

    it('updates working leg from event', () => {
      const { result } = renderHook(() => useExerciseDetection());
      const event: ExerciseDetectionEvent = {
        exercise: 'pistol-squat',
        confidence: 85,
        workingLeg: 'left',
      };

      act(() => {
        result.current.handleDetectionEvent(event, false);
      });

      expect(result.current.workingLeg).toBe('left');
    });

    it('uses phases from pipeline callback', () => {
      const getPhasesFromPipeline = vi
        .fn()
        .mockReturnValue(['standing', 'descending', 'bottom', 'ascending']);
      const { result } = renderHook(() =>
        useExerciseDetection({ getPhasesFromPipeline })
      );

      act(() => {
        result.current.handleDetectionEvent(
          { exercise: 'pistol-squat', confidence: 90 },
          false
        );
      });

      expect(result.current.currentPhases).toEqual([
        'standing',
        'descending',
        'bottom',
        'ascending',
      ]);
    });

    it('uses default phases when pipeline callback returns null', () => {
      const getPhasesFromPipeline = vi.fn().mockReturnValue(null);
      const { result } = renderHook(() =>
        useExerciseDetection({ getPhasesFromPipeline })
      );

      act(() => {
        result.current.handleDetectionEvent(
          { exercise: 'kettlebell-swing', confidence: 80 },
          false
        );
      });

      expect(result.current.currentPhases).toEqual([
        'top',
        'connect',
        'bottom',
        'release',
      ]);
    });
  });

  describe('setExerciseType', () => {
    it('manually sets exercise type', () => {
      const { result } = renderHook(() => useExerciseDetection());

      act(() => {
        result.current.setExerciseType('pistol-squat');
      });

      expect(result.current.detectedExercise).toBe('pistol-squat');
    });

    it('locks detection on manual set', () => {
      const { result } = renderHook(() => useExerciseDetection());

      act(() => {
        result.current.setExerciseType('kettlebell-swing');
      });

      expect(result.current.isDetectionLocked).toBe(true);
    });

    it('calls pipeline callback', () => {
      const setPipelineExerciseType = vi.fn();
      const { result } = renderHook(() =>
        useExerciseDetection({ setPipelineExerciseType })
      );

      act(() => {
        result.current.setExerciseType('pistol-squat');
      });

      expect(setPipelineExerciseType).toHaveBeenCalledWith('pistol-squat');
    });

    it('updates phases from pipeline after set', () => {
      const getPhasesFromPipeline = vi
        .fn()
        .mockReturnValue(['custom', 'phases']);
      const { result } = renderHook(() =>
        useExerciseDetection({ getPhasesFromPipeline })
      );

      act(() => {
        result.current.setExerciseType('kettlebell-swing');
      });

      expect(result.current.currentPhases).toEqual(['custom', 'phases']);
    });
  });

  describe('handleLegacyDetectionLock', () => {
    it('sets exercise and phases with lock', () => {
      const { result } = renderHook(() => useExerciseDetection());

      act(() => {
        result.current.handleLegacyDetectionLock('kettlebell-swing', [
          'top',
          'connect',
          'bottom',
          'release',
        ]);
      });

      expect(result.current.detectedExercise).toBe('kettlebell-swing');
      expect(result.current.isDetectionLocked).toBe(true);
      expect(result.current.currentPhases).toEqual([
        'top',
        'connect',
        'bottom',
        'release',
      ]);
    });
  });

  describe('resetDetectionState', () => {
    it('resets all state to initial values', () => {
      const { result } = renderHook(() => useExerciseDetection());

      // Set some state
      act(() => {
        result.current.handleDetectionEvent(
          { exercise: 'pistol-squat', confidence: 95, workingLeg: 'left' },
          false
        );
      });
      expect(result.current.detectedExercise).toBe('pistol-squat');
      expect(result.current.isDetectionLocked).toBe(true);

      // Reset
      act(() => {
        result.current.resetDetectionState();
      });

      expect(result.current.detectedExercise).toBe('unknown');
      expect(result.current.detectionConfidence).toBe(0);
      expect(result.current.isDetectionLocked).toBe(false);
      expect(result.current.currentPhases).toEqual([
        'top',
        'connect',
        'bottom',
        'release',
      ]);
      expect(result.current.workingLeg).toBeNull();
    });
  });

  describe('function stability', () => {
    it('returns stable function references', () => {
      const { result, rerender } = renderHook(() => useExerciseDetection());

      const firstRender = {
        handleDetectionEvent: result.current.handleDetectionEvent,
        setExerciseType: result.current.setExerciseType,
        resetDetectionState: result.current.resetDetectionState,
        handleLegacyDetectionLock: result.current.handleLegacyDetectionLock,
      };

      rerender();

      // Functions should be stable across rerenders (due to useCallback with empty deps)
      expect(result.current.handleLegacyDetectionLock).toBe(
        firstRender.handleLegacyDetectionLock
      );
      expect(result.current.resetDetectionState).toBe(
        firstRender.resetDetectionState
      );
    });
  });
});
