/**
 * Hook utilities - pure functions extracted for testability.
 *
 * These utilities contain business logic that was previously embedded
 * in useExerciseAnalyzer.tsx. By extracting them:
 * 1. Logic is unit testable with 100% coverage
 * 2. Edge cases are documented via tests
 * 3. Main hook is smaller and more maintainable
 * 4. Bugs are caught at test time, not runtime
 */

export {
  type CanvasPlacement,
  calculateCanvasPlacement,
  calculateNormalModePlacement,
  calculateScaleFactors,
  calculateZoomedModePlacement,
  type VideoDimensions,
  type VideoRect,
} from './canvasSyncUtils';

export {
  DEFAULT_SPINE_THRESHOLDS,
  estimateSwingPosition,
  extractHudAngles,
  type HudAngles,
  isHingedPosition,
  isUprightPosition,
  type SpineAngleThresholds,
  type SwingPosition,
} from './hudUtils';

export {
  classifyVideoLoadError,
  fetchWithProgress,
  formatPositionForDisplay,
  getFileNameFromUrl,
  getVideoLoadErrorMessage,
  isLandscapeVideo,
  type ProgressCallback,
  type VideoLoadErrorType,
} from './videoLoadingUtils';
