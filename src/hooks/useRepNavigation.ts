/**
 * useRepNavigation - Rep and checkpoint navigation for exercise analyzer.
 *
 * Handles:
 * - Rep navigation (prev/next rep)
 * - Checkpoint navigation (prev/next position within reps)
 * - Position sync during playback
 *
 * Extracted from useExerciseAnalyzer for testability.
 */

import { useCallback, useRef } from 'react';
import type { PositionCandidate } from '../types/exercise';
import {
  buildCheckpointList,
  type Checkpoint,
  findNextCheckpoint,
  findPreviousCheckpoint,
} from '../utils/checkpointUtils';
import { formatPositionForDisplay } from './utils/videoLoadingUtils';

/**
 * Input parameters for the navigation hook.
 */
export interface UseRepNavigationParams {
  /** Video element ref */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Map of rep number to position map */
  repThumbnails: Map<number, Map<string, PositionCandidate>>;
  /** Total rep count */
  repCount: number;
  /** Current rep index (0-indexed) */
  currentRepIndex: number;
  /** Currently displayed position (e.g., "Top", "Bottom") */
  currentPosition: string | null;
  /** Phases for current exercise (e.g., ['top', 'connect', 'bottom', 'release']) */
  currentPhases: string[];
  /** Callback to update rep index */
  setCurrentRepIndex: (index: number) => void;
  /** Callback to update current position display */
  setCurrentPosition: (position: string | null) => void;
}

/**
 * Return value from the navigation hook.
 */
export interface UseRepNavigationReturn {
  /** Navigate to previous rep, preserving current phase if possible */
  navigateToPreviousRep: () => void;
  /** Navigate to next rep, preserving current phase if possible */
  navigateToNextRep: () => void;
  /** Navigate to previous checkpoint (any rep/phase) */
  navigateToPreviousCheckpoint: () => void;
  /** Navigate to next checkpoint (any rep/phase) */
  navigateToNextCheckpoint: () => void;
  /** Get all checkpoints sorted by time */
  getAllCheckpoints: () => Checkpoint[];
  /** Update rep and position based on video time (for playback sync) */
  updateRepAndPositionFromTime: (videoTime: number) => void;
  /** Ref for the sync handler (for use in video callbacks) */
  repSyncHandlerRef: React.MutableRefObject<
    ((videoTime: number) => void) | null
  >;
}

/**
 * Hook for rep and checkpoint navigation.
 *
 * Features:
 * - Preserves current phase when navigating between reps
 * - Syncs rep/position during video playback
 * - Works with any exercise type (different phase sets)
 */
export function useRepNavigation({
  videoRef,
  repThumbnails,
  repCount,
  currentRepIndex,
  currentPosition,
  currentPhases,
  setCurrentRepIndex,
  setCurrentPosition,
}: UseRepNavigationParams): UseRepNavigationReturn {
  // Ref for the sync handler to avoid stale closures in video callbacks
  const repSyncHandlerRef = useRef<((videoTime: number) => void) | null>(null);

  // Build flat list of all checkpoints sorted by time
  const getAllCheckpoints = useCallback(() => {
    return buildCheckpointList(repThumbnails, currentPhases);
  }, [repThumbnails, currentPhases]);

  // Navigate to previous rep, preserving current phase if possible
  const navigateToPreviousRep = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    const newRepIndex = Math.max(0, currentRepIndex - 1);
    if (newRepIndex === currentRepIndex) return; // Already at first rep

    // Find checkpoint in target rep - prefer same phase as current
    const targetRepNum = newRepIndex + 1; // repNum is 1-indexed
    const positions = repThumbnails.get(targetRepNum);

    // Try to preserve current phase (convert "Top" -> "top" for lookup)
    const currentPhaseKey = currentPosition?.toLowerCase() ?? null;
    const samePhaseCheckpoint = currentPhaseKey
      ? positions?.get(currentPhaseKey)
      : null;
    const targetCheckpoint =
      samePhaseCheckpoint || positions?.values().next().value;
    const actualPosition = samePhaseCheckpoint
      ? currentPhaseKey
      : (positions?.keys().next().value ?? null);

    video.pause(); // Pause when seeking to rep
    if (targetCheckpoint?.videoTime !== undefined) {
      video.currentTime = targetCheckpoint.videoTime;
      if (actualPosition) {
        setCurrentPosition(formatPositionForDisplay(actualPosition));
      }
    }
    setCurrentRepIndex(newRepIndex);
  }, [
    videoRef,
    currentRepIndex,
    repThumbnails,
    currentPosition,
    setCurrentRepIndex,
    setCurrentPosition,
  ]);

  // Navigate to next rep, preserving current phase if possible
  const navigateToNextRep = useCallback(() => {
    const video = videoRef.current;
    if (!video || repCount <= 0) return;

    const newRepIndex = Math.min(repCount - 1, currentRepIndex + 1);
    if (newRepIndex === currentRepIndex) return; // Already at last rep

    // Find checkpoint in target rep - prefer same phase as current
    const targetRepNum = newRepIndex + 1; // repNum is 1-indexed
    const positions = repThumbnails.get(targetRepNum);

    // Try to preserve current phase (convert "Top" -> "top" for lookup)
    const currentPhaseKey = currentPosition?.toLowerCase() ?? null;
    const samePhaseCheckpoint = currentPhaseKey
      ? positions?.get(currentPhaseKey)
      : null;
    const targetCheckpoint =
      samePhaseCheckpoint || positions?.values().next().value;
    const actualPosition = samePhaseCheckpoint
      ? currentPhaseKey
      : (positions?.keys().next().value ?? null);

    video.pause(); // Pause when seeking to rep
    if (targetCheckpoint?.videoTime !== undefined) {
      video.currentTime = targetCheckpoint.videoTime;
      if (actualPosition) {
        setCurrentPosition(formatPositionForDisplay(actualPosition));
      }
    }
    setCurrentRepIndex(newRepIndex);
  }, [
    videoRef,
    repCount,
    currentRepIndex,
    repThumbnails,
    currentPosition,
    setCurrentRepIndex,
    setCurrentPosition,
  ]);

  // Navigate to previous checkpoint (any rep/phase)
  const navigateToPreviousCheckpoint = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    const checkpoints = getAllCheckpoints();
    if (checkpoints.length === 0) return;

    const prevCheckpoint = findPreviousCheckpoint(
      checkpoints,
      video.currentTime
    );

    if (prevCheckpoint) {
      video.pause();
      video.currentTime = prevCheckpoint.videoTime;
      setCurrentPosition(formatPositionForDisplay(prevCheckpoint.position));
      // Update rep index (repNum is 1-indexed, currentRepIndex is 0-indexed)
      const newRepIndex = prevCheckpoint.repNum - 1;
      if (newRepIndex !== currentRepIndex) {
        setCurrentRepIndex(newRepIndex);
      }
    }
  }, [
    videoRef,
    getAllCheckpoints,
    currentRepIndex,
    setCurrentRepIndex,
    setCurrentPosition,
  ]);

  // Navigate to next checkpoint (any rep/phase)
  const navigateToNextCheckpoint = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    const checkpoints = getAllCheckpoints();
    if (checkpoints.length === 0) return;

    const nextCheckpoint = findNextCheckpoint(checkpoints, video.currentTime);

    if (nextCheckpoint) {
      video.pause();
      video.currentTime = nextCheckpoint.videoTime;
      setCurrentPosition(formatPositionForDisplay(nextCheckpoint.position));
      // Update rep index (repNum is 1-indexed, currentRepIndex is 0-indexed)
      const newRepIndex = nextCheckpoint.repNum - 1;
      if (newRepIndex !== currentRepIndex) {
        setCurrentRepIndex(newRepIndex);
      }
    }
  }, [
    videoRef,
    getAllCheckpoints,
    currentRepIndex,
    setCurrentRepIndex,
    setCurrentPosition,
  ]);

  // Update rep and position based on video time (for playback sync)
  const updateRepAndPositionFromTime = useCallback(
    (videoTime: number) => {
      const checkpoints = getAllCheckpoints();
      if (checkpoints.length === 0) return;

      // Find which rep/position we're in: last checkpoint where time >= checkpoint.videoTime
      // Default to rep 1 before first checkpoint
      let foundRepNum = 1;
      let foundPosition: string | null = null;

      for (const cp of checkpoints) {
        if (videoTime >= cp.videoTime - 0.05) {
          // Small tolerance for frame timing
          foundRepNum = cp.repNum;
          foundPosition = cp.position;
        } else {
          break; // Checkpoints are sorted
        }
      }

      // Update rep index if changed (repNum is 1-indexed)
      const newRepIndex = foundRepNum - 1;
      if (newRepIndex !== currentRepIndex) {
        setCurrentRepIndex(newRepIndex);
      }

      // Update position if found
      if (foundPosition) {
        setCurrentPosition(formatPositionForDisplay(foundPosition));
      }
    },
    [getAllCheckpoints, currentRepIndex, setCurrentRepIndex, setCurrentPosition]
  );

  // Keep ref up to date for use in event handlers
  repSyncHandlerRef.current = updateRepAndPositionFromTime;

  return {
    navigateToPreviousRep,
    navigateToNextRep,
    navigateToPreviousCheckpoint,
    navigateToNextCheckpoint,
    getAllCheckpoints,
    updateRepAndPositionFromTime,
    repSyncHandlerRef,
  };
}
