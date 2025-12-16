import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PositionCandidate } from '../types/exercise';
import { useRepNavigation } from './useRepNavigation';

describe('useRepNavigation', () => {
  // Mock video element
  let mockVideo: {
    currentTime: number;
    pause: ReturnType<typeof vi.fn>;
  };

  // Test data helpers
  const createPositionCandidate = (
    videoTime: number,
    position: string = 'top'
  ): PositionCandidate => ({
    position,
    videoTime,
    timestamp: videoTime * 1000,
    angles: { spine: 45, arm: 30 },
    score: 0,
  });

  const createRepThumbnails = (
    reps: Array<{ repNum: number; positions: Record<string, number> }>
  ): Map<number, Map<string, PositionCandidate>> => {
    const map = new Map<number, Map<string, PositionCandidate>>();
    for (const rep of reps) {
      const posMap = new Map<string, PositionCandidate>();
      for (const [pos, time] of Object.entries(rep.positions)) {
        posMap.set(pos, createPositionCandidate(time, pos));
      }
      map.set(rep.repNum, posMap);
    }
    return map;
  };

  beforeEach(() => {
    mockVideo = {
      currentTime: 0,
      pause: vi.fn(),
    };
  });

  describe('navigateToPreviousRep', () => {
    it('navigates to previous rep and pauses video', () => {
      const setCurrentRepIndex = vi.fn();
      const setCurrentPosition = vi.fn();
      const repThumbnails = createRepThumbnails([
        { repNum: 1, positions: { top: 1.0, bottom: 2.0 } },
        { repNum: 2, positions: { top: 3.0, bottom: 4.0 } },
      ]);

      const { result } = renderHook(() =>
        useRepNavigation({
          videoRef: { current: mockVideo as unknown as HTMLVideoElement },
          repThumbnails,
          repCount: 2,
          currentRepIndex: 1,
          currentPosition: 'Top',
          currentPhases: ['top', 'bottom'],
          setCurrentRepIndex,
          setCurrentPosition,
        })
      );

      act(() => {
        result.current.navigateToPreviousRep();
      });

      expect(mockVideo.pause).toHaveBeenCalled();
      expect(mockVideo.currentTime).toBe(1.0); // Rep 1's top position
      expect(setCurrentRepIndex).toHaveBeenCalledWith(0);
      expect(setCurrentPosition).toHaveBeenCalledWith('Top');
    });

    it('preserves current phase when navigating to previous rep', () => {
      const setCurrentRepIndex = vi.fn();
      const setCurrentPosition = vi.fn();
      const repThumbnails = createRepThumbnails([
        { repNum: 1, positions: { top: 1.0, bottom: 2.0 } },
        { repNum: 2, positions: { top: 3.0, bottom: 4.0 } },
      ]);

      const { result } = renderHook(() =>
        useRepNavigation({
          videoRef: { current: mockVideo as unknown as HTMLVideoElement },
          repThumbnails,
          repCount: 2,
          currentRepIndex: 1,
          currentPosition: 'Bottom', // Current phase is bottom
          currentPhases: ['top', 'bottom'],
          setCurrentRepIndex,
          setCurrentPosition,
        })
      );

      act(() => {
        result.current.navigateToPreviousRep();
      });

      expect(mockVideo.currentTime).toBe(2.0); // Rep 1's bottom position (preserves phase)
      expect(setCurrentPosition).toHaveBeenCalledWith('Bottom');
    });

    it('does nothing when already at first rep', () => {
      const setCurrentRepIndex = vi.fn();
      const setCurrentPosition = vi.fn();
      const repThumbnails = createRepThumbnails([
        { repNum: 1, positions: { top: 1.0 } },
      ]);

      const { result } = renderHook(() =>
        useRepNavigation({
          videoRef: { current: mockVideo as unknown as HTMLVideoElement },
          repThumbnails,
          repCount: 1,
          currentRepIndex: 0,
          currentPosition: 'Top',
          currentPhases: ['top'],
          setCurrentRepIndex,
          setCurrentPosition,
        })
      );

      act(() => {
        result.current.navigateToPreviousRep();
      });

      expect(mockVideo.pause).not.toHaveBeenCalled();
      expect(setCurrentRepIndex).not.toHaveBeenCalled();
    });

    it('does nothing when video ref is null', () => {
      const setCurrentRepIndex = vi.fn();
      const setCurrentPosition = vi.fn();

      const { result } = renderHook(() =>
        useRepNavigation({
          videoRef: { current: null },
          repThumbnails: new Map(),
          repCount: 2,
          currentRepIndex: 1,
          currentPosition: 'Top',
          currentPhases: ['top'],
          setCurrentRepIndex,
          setCurrentPosition,
        })
      );

      act(() => {
        result.current.navigateToPreviousRep();
      });

      expect(setCurrentRepIndex).not.toHaveBeenCalled();
    });
  });

  describe('navigateToNextRep', () => {
    it('navigates to next rep and pauses video', () => {
      const setCurrentRepIndex = vi.fn();
      const setCurrentPosition = vi.fn();
      const repThumbnails = createRepThumbnails([
        { repNum: 1, positions: { top: 1.0, bottom: 2.0 } },
        { repNum: 2, positions: { top: 3.0, bottom: 4.0 } },
      ]);

      const { result } = renderHook(() =>
        useRepNavigation({
          videoRef: { current: mockVideo as unknown as HTMLVideoElement },
          repThumbnails,
          repCount: 2,
          currentRepIndex: 0,
          currentPosition: 'Top',
          currentPhases: ['top', 'bottom'],
          setCurrentRepIndex,
          setCurrentPosition,
        })
      );

      act(() => {
        result.current.navigateToNextRep();
      });

      expect(mockVideo.pause).toHaveBeenCalled();
      expect(mockVideo.currentTime).toBe(3.0); // Rep 2's top position
      expect(setCurrentRepIndex).toHaveBeenCalledWith(1);
      expect(setCurrentPosition).toHaveBeenCalledWith('Top');
    });

    it('does nothing when already at last rep', () => {
      const setCurrentRepIndex = vi.fn();
      const setCurrentPosition = vi.fn();
      const repThumbnails = createRepThumbnails([
        { repNum: 1, positions: { top: 1.0 } },
        { repNum: 2, positions: { top: 3.0 } },
      ]);

      const { result } = renderHook(() =>
        useRepNavigation({
          videoRef: { current: mockVideo as unknown as HTMLVideoElement },
          repThumbnails,
          repCount: 2,
          currentRepIndex: 1,
          currentPosition: 'Top',
          currentPhases: ['top'],
          setCurrentRepIndex,
          setCurrentPosition,
        })
      );

      act(() => {
        result.current.navigateToNextRep();
      });

      expect(mockVideo.pause).not.toHaveBeenCalled();
      expect(setCurrentRepIndex).not.toHaveBeenCalled();
    });

    it('does nothing when repCount is 0', () => {
      const setCurrentRepIndex = vi.fn();
      const setCurrentPosition = vi.fn();

      const { result } = renderHook(() =>
        useRepNavigation({
          videoRef: { current: mockVideo as unknown as HTMLVideoElement },
          repThumbnails: new Map(),
          repCount: 0,
          currentRepIndex: 0,
          currentPosition: null,
          currentPhases: ['top'],
          setCurrentRepIndex,
          setCurrentPosition,
        })
      );

      act(() => {
        result.current.navigateToNextRep();
      });

      expect(setCurrentRepIndex).not.toHaveBeenCalled();
    });
  });

  describe('navigateToPreviousCheckpoint', () => {
    it('navigates to previous checkpoint across reps', () => {
      const setCurrentRepIndex = vi.fn();
      const setCurrentPosition = vi.fn();
      const repThumbnails = createRepThumbnails([
        { repNum: 1, positions: { top: 1.0, bottom: 2.0 } },
        { repNum: 2, positions: { top: 3.0, bottom: 4.0 } },
      ]);
      mockVideo.currentTime = 3.5; // Between rep 2's top and bottom

      const { result } = renderHook(() =>
        useRepNavigation({
          videoRef: { current: mockVideo as unknown as HTMLVideoElement },
          repThumbnails,
          repCount: 2,
          currentRepIndex: 1,
          currentPosition: 'Top',
          currentPhases: ['top', 'bottom'],
          setCurrentRepIndex,
          setCurrentPosition,
        })
      );

      act(() => {
        result.current.navigateToPreviousCheckpoint();
      });

      expect(mockVideo.pause).toHaveBeenCalled();
      expect(mockVideo.currentTime).toBe(3.0); // Rep 2's top position
      expect(setCurrentPosition).toHaveBeenCalledWith('Top');
    });

    it('updates rep index when crossing rep boundary', () => {
      const setCurrentRepIndex = vi.fn();
      const setCurrentPosition = vi.fn();
      const repThumbnails = createRepThumbnails([
        { repNum: 1, positions: { top: 1.0, bottom: 2.0 } },
        { repNum: 2, positions: { top: 3.0, bottom: 4.0 } },
      ]);
      mockVideo.currentTime = 3.0; // At rep 2's top

      const { result } = renderHook(() =>
        useRepNavigation({
          videoRef: { current: mockVideo as unknown as HTMLVideoElement },
          repThumbnails,
          repCount: 2,
          currentRepIndex: 1,
          currentPosition: 'Top',
          currentPhases: ['top', 'bottom'],
          setCurrentRepIndex,
          setCurrentPosition,
        })
      );

      act(() => {
        result.current.navigateToPreviousCheckpoint();
      });

      expect(mockVideo.currentTime).toBe(2.0); // Rep 1's bottom position
      expect(setCurrentRepIndex).toHaveBeenCalledWith(0); // Back to rep 1
    });

    it('does nothing when no checkpoints exist', () => {
      const setCurrentRepIndex = vi.fn();
      const setCurrentPosition = vi.fn();

      const { result } = renderHook(() =>
        useRepNavigation({
          videoRef: { current: mockVideo as unknown as HTMLVideoElement },
          repThumbnails: new Map(),
          repCount: 0,
          currentRepIndex: 0,
          currentPosition: null,
          currentPhases: ['top'],
          setCurrentRepIndex,
          setCurrentPosition,
        })
      );

      act(() => {
        result.current.navigateToPreviousCheckpoint();
      });

      expect(mockVideo.pause).not.toHaveBeenCalled();
    });
  });

  describe('navigateToNextCheckpoint', () => {
    it('navigates to next checkpoint', () => {
      const setCurrentRepIndex = vi.fn();
      const setCurrentPosition = vi.fn();
      const repThumbnails = createRepThumbnails([
        { repNum: 1, positions: { top: 1.0, bottom: 2.0 } },
      ]);
      mockVideo.currentTime = 1.5; // Between top and bottom

      const { result } = renderHook(() =>
        useRepNavigation({
          videoRef: { current: mockVideo as unknown as HTMLVideoElement },
          repThumbnails,
          repCount: 1,
          currentRepIndex: 0,
          currentPosition: 'Top',
          currentPhases: ['top', 'bottom'],
          setCurrentRepIndex,
          setCurrentPosition,
        })
      );

      act(() => {
        result.current.navigateToNextCheckpoint();
      });

      expect(mockVideo.pause).toHaveBeenCalled();
      expect(mockVideo.currentTime).toBe(2.0); // bottom position
      expect(setCurrentPosition).toHaveBeenCalledWith('Bottom');
    });
  });

  describe('getAllCheckpoints', () => {
    it('returns checkpoints sorted by time', () => {
      const repThumbnails = createRepThumbnails([
        { repNum: 1, positions: { top: 1.0, bottom: 2.0 } },
        { repNum: 2, positions: { top: 3.0, bottom: 4.0 } },
      ]);

      const { result } = renderHook(() =>
        useRepNavigation({
          videoRef: { current: mockVideo as unknown as HTMLVideoElement },
          repThumbnails,
          repCount: 2,
          currentRepIndex: 0,
          currentPosition: null,
          currentPhases: ['top', 'bottom'],
          setCurrentRepIndex: vi.fn(),
          setCurrentPosition: vi.fn(),
        })
      );

      const checkpoints = result.current.getAllCheckpoints();

      expect(checkpoints).toHaveLength(4);
      expect(checkpoints.map((c) => c.videoTime)).toEqual([1.0, 2.0, 3.0, 4.0]);
      expect(checkpoints[0]).toEqual({
        repNum: 1,
        position: 'top',
        videoTime: 1.0,
      });
    });

    it('returns empty array when no thumbnails', () => {
      const { result } = renderHook(() =>
        useRepNavigation({
          videoRef: { current: mockVideo as unknown as HTMLVideoElement },
          repThumbnails: new Map(),
          repCount: 0,
          currentRepIndex: 0,
          currentPosition: null,
          currentPhases: ['top'],
          setCurrentRepIndex: vi.fn(),
          setCurrentPosition: vi.fn(),
        })
      );

      expect(result.current.getAllCheckpoints()).toEqual([]);
    });
  });

  describe('updateRepAndPositionFromTime', () => {
    it('updates rep and position based on video time', () => {
      const setCurrentRepIndex = vi.fn();
      const setCurrentPosition = vi.fn();
      const repThumbnails = createRepThumbnails([
        { repNum: 1, positions: { top: 1.0, bottom: 2.0 } },
        { repNum: 2, positions: { top: 3.0, bottom: 4.0 } },
      ]);

      const { result } = renderHook(() =>
        useRepNavigation({
          videoRef: { current: mockVideo as unknown as HTMLVideoElement },
          repThumbnails,
          repCount: 2,
          currentRepIndex: 0,
          currentPosition: null,
          currentPhases: ['top', 'bottom'],
          setCurrentRepIndex,
          setCurrentPosition,
        })
      );

      act(() => {
        result.current.updateRepAndPositionFromTime(3.5);
      });

      expect(setCurrentRepIndex).toHaveBeenCalledWith(1); // Rep 2
      expect(setCurrentPosition).toHaveBeenCalledWith('Top');
    });

    it('defaults to rep 1 before any checkpoints', () => {
      const setCurrentRepIndex = vi.fn();
      const setCurrentPosition = vi.fn();
      const repThumbnails = createRepThumbnails([
        { repNum: 1, positions: { top: 1.0 } },
      ]);

      const { result } = renderHook(() =>
        useRepNavigation({
          videoRef: { current: mockVideo as unknown as HTMLVideoElement },
          repThumbnails,
          repCount: 1,
          currentRepIndex: 0,
          currentPosition: null,
          currentPhases: ['top'],
          setCurrentRepIndex,
          setCurrentPosition,
        })
      );

      act(() => {
        result.current.updateRepAndPositionFromTime(0.5); // Before first checkpoint
      });

      // Rep index should stay at 0 (not updated since it's already 0)
      expect(setCurrentRepIndex).not.toHaveBeenCalled();
    });

    it('handles frame timing tolerance', () => {
      const setCurrentRepIndex = vi.fn();
      const setCurrentPosition = vi.fn();
      const repThumbnails = createRepThumbnails([
        { repNum: 1, positions: { top: 1.0, bottom: 2.0 } },
      ]);

      const { result } = renderHook(() =>
        useRepNavigation({
          videoRef: { current: mockVideo as unknown as HTMLVideoElement },
          repThumbnails,
          repCount: 1,
          currentRepIndex: 0,
          currentPosition: null,
          currentPhases: ['top', 'bottom'],
          setCurrentRepIndex,
          setCurrentPosition,
        })
      );

      // Time slightly before checkpoint (within tolerance)
      act(() => {
        result.current.updateRepAndPositionFromTime(0.96);
      });

      // Should match the 1.0 checkpoint due to 0.05 tolerance
      expect(setCurrentPosition).toHaveBeenCalledWith('Top');
    });
  });

  describe('repSyncHandlerRef', () => {
    it('provides stable ref for video callbacks', () => {
      const { result, rerender } = renderHook(
        ({ currentRepIndex }) =>
          useRepNavigation({
            videoRef: { current: mockVideo as unknown as HTMLVideoElement },
            repThumbnails: new Map(),
            repCount: 2,
            currentRepIndex,
            currentPosition: null,
            currentPhases: ['top'],
            setCurrentRepIndex: vi.fn(),
            setCurrentPosition: vi.fn(),
          }),
        { initialProps: { currentRepIndex: 0 } }
      );

      const firstRef = result.current.repSyncHandlerRef;

      rerender({ currentRepIndex: 1 });

      // Ref object should be stable across rerenders
      expect(result.current.repSyncHandlerRef).toBe(firstRef);
      // But the function inside should be updated
      expect(result.current.repSyncHandlerRef.current).toBe(
        result.current.updateRepAndPositionFromTime
      );
    });
  });
});
