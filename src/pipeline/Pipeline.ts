import { type Observable, Subject } from 'rxjs';
import {
  createAnalyzerForExercise,
  type DetectedExercise,
  type DetectionResult,
  ExerciseDetector,
  type FormAnalyzer,
  getExerciseDisplayName,
  KettlebellSwingFormAnalyzer,
  type RepPosition,
} from '../analyzers';
import type { Skeleton } from '../models/Skeleton';
import type { CropRegion } from '../types/posetrack';
import type {
  FrameAcquisition,
  SkeletonEvent,
  SkeletonTransformer,
} from './PipelineInterfaces';
import { VideoFrameAcquisition } from './VideoFrameAcquisition';

/**
 * Event emitted when a rep completes with position thumbnails
 */
export interface ThumbnailEvent {
  /** Rep number (1-indexed) */
  repNumber: number;
  /** Position captures from the completed rep (skeleton at each phase peak) */
  positions: RepPosition[];
}

/**
 * Orchestrates the processing pipeline from frame to rep analysis.
 *
 * Processing is batch/extraction driven: call processSkeletonEvent() per
 * skeleton coming from extraction or cache replay. Results are published on
 * the Observable getters below for the UI to consume.
 *
 * Pipeline flow: Skeleton → FormAnalyzer.processFrame() → Results
 *
 * The FormAnalyzer is a plugin interface - different exercises get different analyzers:
 * - KettlebellSwingFormAnalyzer: peak-based state machine for swings
 * - PullUpFormAnalyzer: (future) for pull-ups
 * - MockFormAnalyzer: (testing) deterministic behavior
 */
export class Pipeline {
  // Latest data from the pipeline
  private latestSkeleton: Skeleton | null = null;
  private repCount = 0;

  // Output subjects
  private resultSubject = new Subject<PipelineResult>();
  private skeletonSubject = new Subject<SkeletonEvent>();
  private thumbnailSubject = new Subject<ThumbnailEvent>();
  private exerciseDetectionSubject = new Subject<DetectionResult>();
  private errorSubject = new Subject<PipelineError>();

  // Form analyzer - plugin for exercise-specific analysis
  private formAnalyzer: FormAnalyzer;

  // Exercise detection
  private exerciseDetector = new ExerciseDetector();
  private detectedExercise: DetectedExercise = 'unknown';
  private autoSwitchAnalyzer = true; // Auto-switch analyzer when exercise detected

  constructor(
    private frameAcquisition: FrameAcquisition,
    private skeletonTransformer: SkeletonTransformer,
    formAnalyzer?: FormAnalyzer
  ) {
    // Default to kettlebell swing analyzer if none provided
    this.formAnalyzer = formAnalyzer ?? new KettlebellSwingFormAnalyzer();
  }

  /**
   * Initialize the pipeline
   */
  async initialize(): Promise<void> {
    // Initialize skeleton transformer
    await this.skeletonTransformer.initialize();
  }

  /**
   * Get an observable for pipeline results.
   * Use this to listen for rep count updates from batch processing (processSkeletonEvent).
   */
  getResults(): Observable<PipelineResult> {
    return this.resultSubject.asObservable();
  }

  /**
   * Get an observable for all skeleton events
   */
  getSkeletonEvents(): Observable<SkeletonEvent> {
    return this.skeletonSubject.asObservable();
  }

  /**
   * Get an observable for thumbnail events (emitted when a rep completes)
   */
  getThumbnailEvents(): Observable<ThumbnailEvent> {
    return this.thumbnailSubject.asObservable();
  }

  /**
   * Get an observable for pipeline errors
   * Subscribe to be notified when form analysis or detection fails
   */
  getErrorEvents(): Observable<PipelineError> {
    return this.errorSubject.asObservable();
  }

  /**
   * Dispose of all pipeline resources and complete all subjects.
   * Call this when the pipeline is no longer needed to prevent memory leaks.
   */
  dispose(): void {
    // Complete all subjects to release subscribers
    this.resultSubject.complete();
    this.skeletonSubject.complete();
    this.thumbnailSubject.complete();
    this.exerciseDetectionSubject.complete();
    this.errorSubject.complete();
  }

  /**
   * Reset the pipeline state
   */
  reset(): void {
    this.formAnalyzer.reset();
    this.exerciseDetector.reset();
    this.detectedExercise = 'unknown';
    this.autoSwitchAnalyzer = true;
    this.latestSkeleton = null;
    this.repCount = 0;
  }

  /**
   * Get the current rep count
   */
  getRepCount(): number {
    return this.repCount;
  }

  /**
   * Get the latest skeleton
   */
  getLatestSkeleton(): Skeleton | null {
    return this.latestSkeleton;
  }

  /**
   * Get the form analyzer (for external access if needed)
   */
  getFormAnalyzer(): FormAnalyzer {
    return this.formAnalyzer;
  }

  /**
   * Process a skeleton event directly, bypassing frame acquisition.
   * Used for batch/extraction mode where frames come from extraction
   * rather than video playback.
   *
   * @param skeletonEvent - The skeleton event to process
   * @returns The rep count after processing
   */
  processSkeletonEvent(skeletonEvent: SkeletonEvent): number {
    // Store latest skeleton
    if (skeletonEvent.skeleton) {
      this.latestSkeleton = skeletonEvent.skeleton;

      // Emit skeleton event for real-time rendering during extraction
      this.skeletonSubject.next(skeletonEvent);

      // Run exercise detection (only until locked)
      if (!this.exerciseDetector.isLocked()) {
        try {
          const detection = this.exerciseDetector.processFrame(
            skeletonEvent.skeleton
          );
          this.exerciseDetectionSubject.next(detection);

          // Auto-switch analyzer when detection is confident
          if (this.autoSwitchAnalyzer && detection.confidence >= 70) {
            this.switchToExercise(detection.exercise);
            // Emit detection event again after switch so UI can update phases
            // from the new analyzer
            this.exerciseDetectionSubject.next(detection);
          }
        } catch (error) {
          console.error(
            '[Pipeline] Exercise detection error, continuing with current analyzer:',
            error
          );
          this.errorSubject.next({
            source: 'exercise-detection',
            error: error instanceof Error ? error : new Error(String(error)),
            timestamp: skeletonEvent.poseEvent.frameEvent.timestamp,
            videoTime: skeletonEvent.poseEvent.frameEvent.videoTime,
          });
          // Don't block form analysis if detection fails
        }
      }

      // Process through form analyzer
      try {
        const result = this.formAnalyzer.processFrame(
          skeletonEvent.skeleton,
          skeletonEvent.poseEvent.frameEvent.timestamp,
          skeletonEvent.poseEvent.frameEvent.videoTime,
          skeletonEvent.poseEvent.frameEvent.frameImage
        );

        // Update rep count
        this.repCount = result.repCount;

        // Emit thumbnail event when rep completes (with positions at each phase peak)
        if (result.repCompleted && result.repPositions) {
          this.thumbnailSubject.next({
            repNumber: result.repCount,
            positions: result.repPositions,
          });
        }

        // Emit result when rep completes
        if (result.repCompleted) {
          this.resultSubject.next({
            skeleton: skeletonEvent.skeleton,
            repCount: result.repCount,
          });
        }
      } catch (error) {
        console.error('Error in form analyzer processFrame:', error);
        this.errorSubject.next({
          source: 'form-analyzer',
          error: error instanceof Error ? error : new Error(String(error)),
          timestamp: skeletonEvent.poseEvent.frameEvent.timestamp,
          videoTime: skeletonEvent.poseEvent.frameEvent.videoTime,
        });
      }
    }

    return this.repCount;
  }

  /**
   * Switch to the appropriate FormAnalyzer for the detected exercise
   */
  private switchToExercise(exercise: DetectedExercise): void {
    // Don't switch if already using the right analyzer
    if (exercise === this.detectedExercise) return;
    if (exercise === 'unknown') return;

    // Check if we're already using the correct analyzer type
    // (e.g., KettlebellSwingFormAnalyzer for kettlebell-swing)
    // This prevents resetting rep count when detection locks in
    const currentAnalyzerName = this.formAnalyzer.getExerciseName();
    const targetAnalyzerName = getExerciseDisplayName(exercise);

    if (currentAnalyzerName === targetAnalyzerName) {
      // Already using the right analyzer type, just update detected exercise
      this.detectedExercise = exercise;
      console.log(
        `[Pipeline] Detection locked: ${exercise} (keeping existing analyzer)`
      );
      return;
    }

    this.detectedExercise = exercise;

    // Create the appropriate analyzer from the registry
    const newAnalyzer = createAnalyzerForExercise(exercise);

    // Swap in the new analyzer
    this.formAnalyzer = newAnalyzer;

    console.log(`[Pipeline] Switched to ${exercise} analyzer`);
  }

  // ========================================
  // Exercise Detection API
  // ========================================

  /**
   * Get an observable for exercise detection events
   */
  getExerciseDetectionEvents(): Observable<DetectionResult> {
    return this.exerciseDetectionSubject.asObservable();
  }

  /**
   * Get the currently detected exercise type
   */
  getDetectedExercise(): DetectedExercise {
    return this.detectedExercise;
  }

  /**
   * Get the current detection result (without processing a new frame)
   */
  getDetectionResult(): DetectionResult {
    return this.exerciseDetector.getResult();
  }

  /**
   * Manually set the exercise type (user override)
   * This locks the detector and switches the analyzer immediately.
   */
  setExerciseType(exercise: DetectedExercise): void {
    this.autoSwitchAnalyzer = false; // Disable auto-switch since user chose
    this.exerciseDetector.lock(exercise); // Lock detector to prevent further detection
    this.switchToExercise(exercise);
  }

  /**
   * Check if exercise detection is locked (confident or user-set)
   */
  isExerciseDetectionLocked(): boolean {
    return this.exerciseDetector.isLocked();
  }

  // ========================================
  // Crop Region Support
  // ========================================

  /**
   * Set the crop region for auto-centering on person
   * Only works if frameAcquisition is a VideoFrameAcquisition
   */
  setCropRegion(crop: CropRegion | null): void {
    if (this.frameAcquisition instanceof VideoFrameAcquisition) {
      this.frameAcquisition.setCropRegion(crop);
    }
  }

  /**
   * Get the current crop region
   */
  getCropRegion(): CropRegion | null {
    if (this.frameAcquisition instanceof VideoFrameAcquisition) {
      return this.frameAcquisition.getCropRegion();
    }
    return null;
  }

  /**
   * Enable or disable crop mode
   */
  setCropEnabled(enabled: boolean): void {
    if (this.frameAcquisition instanceof VideoFrameAcquisition) {
      this.frameAcquisition.setCropEnabled(enabled);
    }
  }

  /**
   * Check if crop is currently enabled
   */
  isCropEnabled(): boolean {
    if (this.frameAcquisition instanceof VideoFrameAcquisition) {
      return this.frameAcquisition.isCropEnabled();
    }
    return false;
  }
}

/**
 * Result from pipeline processing (legacy Observable mode)
 */
export interface PipelineResult {
  skeleton: Skeleton;
  repCount: number;
}

/**
 * Error event from pipeline processing
 * Emitted when form analysis or other processing fails
 */
export interface PipelineError {
  /** Where in the pipeline the error occurred */
  source: 'form-analyzer' | 'exercise-detection';
  /** The original error */
  error: Error;
  /** Timestamp when error occurred */
  timestamp: number;
  /** Video time if available */
  videoTime?: number;
}
