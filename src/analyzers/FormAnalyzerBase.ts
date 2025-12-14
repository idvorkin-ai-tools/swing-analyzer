/**
 * FormAnalyzerBase - Abstract base class for exercise-specific form analyzers.
 *
 * This base class extracts common functionality from KettlebellSwingFormAnalyzer
 * and PistolSquatFormAnalyzer to reduce code duplication.
 *
 * Shared functionality:
 * - Phase state tracking (phase, framesInPhase, minFramesInPhase)
 * - Rep counting and quality tracking
 * - Peak storage and conversion to RepPosition
 * - Basic lifecycle methods (getPhase, getRepCount, reset, etc.)
 *
 * Concrete implementations must provide:
 * - processFrame() - exercise-specific frame processing
 * - getExerciseName() - exercise name string
 * - getPhases() - list of valid phases
 * - calculateRepQuality() - exercise-specific quality scoring
 * - resetExerciseState() - reset exercise-specific state
 */

import type { Skeleton } from '../models/Skeleton';
import {
  asFrameCount,
  asRepCount,
  type FrameCount,
  type QualityScore,
  type RepCount,
  type TimestampMs,
  type VideoTimeSeconds,
} from '../utils/brandedTypes';
import type {
  FormAnalyzer,
  FormAnalyzerResult,
  RepPosition,
  RepQuality,
} from './FormAnalyzer';

/**
 * Generic peak tracking during a phase.
 * Concrete analyzers can extend this with exercise-specific fields.
 */
export interface BasePhasePeak<TPhase extends string, TAngles> {
  phase: TPhase;
  skeleton: Skeleton;
  timestamp: TimestampMs;
  videoTime?: VideoTimeSeconds;
  score: QualityScore;
  angles: TAngles;
  frameImage?: ImageData;
}

/**
 * Abstract base class for form analyzers.
 *
 * @template TPhase - Union type of valid phase names (e.g., 'top' | 'bottom' | 'connect' | 'release')
 * @template TAngles - Type of angle measurements for this exercise
 * @template TPeak - Type of phase peak (extends BasePhasePeak)
 */
export abstract class FormAnalyzerBase<
  TPhase extends string,
  TAngles,
  TPeak extends BasePhasePeak<TPhase, TAngles>,
> implements FormAnalyzer
{
  /** Current phase of the movement */
  protected phase: TPhase;

  /** Total completed rep count */
  protected repCount: RepCount = asRepCount(0);

  /** Quality metrics for the last completed rep */
  protected lastRepQuality: RepQuality | null = null;

  /** Number of frames spent in current phase (for debouncing) */
  protected framesInPhase: FrameCount = asFrameCount(0);

  /** Minimum frames required before allowing phase transition */
  protected readonly minFramesInPhase: FrameCount = asFrameCount(2);

  /** Peaks captured during current rep (keyed by phase name) */
  protected currentRepPeaks: Partial<Record<TPhase, TPeak>> = {};

  /**
   * @param initialPhase - The starting phase for this exercise
   */
  constructor(initialPhase: TPhase) {
    this.phase = initialPhase;
  }

  // ============================================
  // Abstract methods - must be implemented by concrete classes
  // ============================================

  /**
   * Process a skeleton frame through the exercise-specific state machine.
   */
  abstract processFrame(
    skeleton: Skeleton,
    timestamp?: TimestampMs,
    videoTime?: VideoTimeSeconds,
    frameImage?: ImageData
  ): FormAnalyzerResult;

  /** Get the display name of this exercise */
  abstract getExerciseName(): string;

  /** Get all valid phases for this exercise in display order */
  abstract getPhases(): string[];

  /** Get HUD configuration for this exercise */
  abstract getHudConfig(): import('./FormAnalyzer').HudConfig;

  /**
   * Calculate quality score for the completed rep.
   * Called when a rep completes, uses metrics tracked during the rep.
   */
  protected abstract calculateRepQuality(): RepQuality;

  /**
   * Reset exercise-specific state (metrics, history buffers, etc.)
   * Called by reset() after base state is cleared.
   */
  protected abstract resetExerciseState(): void;

  // ============================================
  // Shared lifecycle methods
  // ============================================

  getPhase(): string {
    return this.phase;
  }

  getRepCount(): RepCount {
    return this.repCount;
  }

  getLastRepQuality(): RepQuality | null {
    return this.lastRepQuality;
  }

  /**
   * Reset analyzer to initial state for a new session.
   * Clears base state and calls resetExerciseState() for exercise-specific cleanup.
   */
  reset(): void {
    this.repCount = asRepCount(0);
    this.framesInPhase = asFrameCount(0);
    this.lastRepQuality = null;
    this.currentRepPeaks = {};
    this.resetExerciseState();
  }

  // ============================================
  // Shared helper methods
  // ============================================

  /**
   * Check if enough frames have passed to allow a phase transition.
   * Prevents rapid oscillation between phases due to noisy data.
   */
  protected canTransition(): boolean {
    return this.framesInPhase >= this.minFramesInPhase;
  }

  /**
   * Transition to a new phase, resetting the frame counter.
   */
  protected transitionTo(newPhase: TPhase): void {
    this.phase = newPhase;
    this.framesInPhase = asFrameCount(0);
  }

  /**
   * Called when a rep completes. Handles common rep completion logic:
   * - Increments rep count
   * - Calculates and stores quality
   * - Converts peaks to positions
   * - Clears current rep peaks
   *
   * @returns Object with repPositions and repQuality for the FormAnalyzerResult
   */
  protected completeRep(): {
    repPositions: RepPosition[];
    repQuality: RepQuality;
  } {
    this.repCount = asRepCount(this.repCount + 1);
    this.lastRepQuality = this.calculateRepQuality();
    const repPositions = this.convertPeaksToPositions();
    this.currentRepPeaks = {};
    return {
      repPositions,
      repQuality: this.lastRepQuality,
    };
  }

  /**
   * Convert internal peak tracking to RepPosition array.
   * Handles the common pattern of iterating over currentRepPeaks.
   */
  protected convertPeaksToPositions(): RepPosition[] {
    const positions: RepPosition[] = [];

    for (const [phaseName, peak] of Object.entries(this.currentRepPeaks)) {
      if (!peak) continue;

      const typedPeak = peak as TPeak;
      positions.push({
        name: phaseName,
        skeleton: typedPeak.skeleton,
        timestamp: typedPeak.timestamp,
        videoTime: typedPeak.videoTime,
        angles: { ...typedPeak.angles } as Record<string, number>,
        score: typedPeak.score,
        frameImage: typedPeak.frameImage,
      });
    }

    return positions;
  }

  /**
   * Store a peak for a specific phase.
   * Replaces any existing peak for that phase.
   */
  protected storePeak(phase: TPhase, peak: TPeak): void {
    this.currentRepPeaks[phase] = peak;
  }

  /**
   * Get the stored peak for a specific phase, if any.
   */
  protected getPeak(phase: TPhase): TPeak | undefined {
    return this.currentRepPeaks[phase];
  }
}
