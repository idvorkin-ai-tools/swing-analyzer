/**
 * useExerciseDetection - Exercise type detection state management.
 *
 * Handles:
 * - Detected exercise type (kettlebell-swing, pistol-squat, unknown)
 * - Detection confidence score
 * - Detection lock state (prevents auto-switching after user override)
 * - Current phases for the exercise
 * - Working leg for asymmetric exercises (pistol squat)
 *
 * Extracted from useExerciseAnalyzer for testability.
 */

import { useCallback, useState } from 'react';
import type { DetectedExercise } from '../analyzers';

/** Default phases for unknown/kettlebell exercises */
const DEFAULT_PHASES = ['top', 'connect', 'bottom', 'release'];

/** Detection event from the pipeline */
export interface ExerciseDetectionEvent {
  exercise: DetectedExercise;
  confidence: number;
  reason?: string;
  workingLeg?: 'left' | 'right' | null;
}

/**
 * Input parameters for the detection hook.
 */
export interface UseExerciseDetectionParams {
  /** Callback to get phases from form analyzer after detection change */
  getPhasesFromPipeline?: () => string[] | null;
  /** Callback to set exercise type in the pipeline */
  setPipelineExerciseType?: (exercise: DetectedExercise) => void;
}

/**
 * Return value from the detection hook.
 */
export interface UseExerciseDetectionReturn {
  /** Currently detected exercise type */
  detectedExercise: DetectedExercise;
  /** Confidence score (0-100) */
  detectionConfidence: number;
  /** Whether detection is locked (user manually selected) */
  isDetectionLocked: boolean;
  /** Current phases for the exercise (e.g., ['top', 'bottom']) */
  currentPhases: string[];
  /** Working leg for asymmetric exercises */
  workingLeg: 'left' | 'right' | null;
  /** Handle a detection event from the pipeline */
  handleDetectionEvent: (
    detection: ExerciseDetectionEvent,
    wasAlreadyLocked: boolean
  ) => void;
  /** Manually set the exercise type (locks detection) */
  setExerciseType: (exercise: DetectedExercise) => void;
  /** Reset detection state to initial values */
  resetDetectionState: () => void;
  /** Handle legacy detection event (pre-pipeline) */
  handleLegacyDetectionLock: (
    exercise: DetectedExercise,
    phases: string[]
  ) => void;
}

/**
 * Hook for exercise type detection state management.
 *
 * Features:
 * - Tracks detected exercise type with confidence
 * - Supports manual override with auto-lock
 * - Manages phases per exercise type
 * - Handles working leg for asymmetric exercises
 */
export function useExerciseDetection({
  getPhasesFromPipeline,
  setPipelineExerciseType,
}: UseExerciseDetectionParams = {}): UseExerciseDetectionReturn {
  // Detection state
  const [detectedExercise, setDetectedExercise] =
    useState<DetectedExercise>('unknown');
  const [detectionConfidence, setDetectionConfidence] = useState<number>(0);
  const [isDetectionLocked, setIsDetectionLocked] = useState<boolean>(false);
  const [currentPhases, setCurrentPhases] = useState<string[]>(DEFAULT_PHASES);
  const [workingLeg, setWorkingLeg] = useState<'left' | 'right' | null>(null);

  // Handle detection event from pipeline
  const handleDetectionEvent = useCallback(
    (detection: ExerciseDetectionEvent, wasAlreadyLocked: boolean) => {
      // Don't update if already locked
      if (wasAlreadyLocked) return;

      // Determine if we should lock
      const shouldLock = detection.confidence >= 90;
      const newIsLocked = shouldLock;

      // Get phases from pipeline if available
      const newPhases = getPhasesFromPipeline?.() ?? DEFAULT_PHASES;
      const newWorkingLeg = detection.workingLeg ?? null;

      // Update state
      setDetectedExercise(detection.exercise);
      setDetectionConfidence(detection.confidence);
      setIsDetectionLocked(newIsLocked);
      setCurrentPhases(newPhases);
      setWorkingLeg(newWorkingLeg);
    },
    [getPhasesFromPipeline]
  );

  // Handle legacy detection lock (for pre-pipeline code paths)
  const handleLegacyDetectionLock = useCallback(
    (exercise: DetectedExercise, phases: string[]) => {
      setDetectedExercise(exercise);
      setIsDetectionLocked(true);
      setCurrentPhases(phases);
    },
    []
  );

  // Manually set exercise type
  const setExerciseType = useCallback(
    (exercise: DetectedExercise) => {
      // Update pipeline first
      setPipelineExerciseType?.(exercise);

      // Update local state
      setDetectedExercise(exercise);
      setIsDetectionLocked(true);

      // Get new phases from pipeline
      const newPhases = getPhasesFromPipeline?.() ?? DEFAULT_PHASES;
      setCurrentPhases(newPhases);
    },
    [setPipelineExerciseType, getPhasesFromPipeline]
  );

  // Reset to initial state
  const resetDetectionState = useCallback(() => {
    setDetectedExercise('unknown');
    setDetectionConfidence(0);
    setIsDetectionLocked(false);
    setCurrentPhases(DEFAULT_PHASES);
    setWorkingLeg(null);
  }, []);

  return {
    detectedExercise,
    detectionConfidence,
    isDetectionLocked,
    currentPhases,
    workingLeg,
    handleDetectionEvent,
    setExerciseType,
    resetDetectionState,
    handleLegacyDetectionLock,
  };
}
