import type { CropRegion } from '../types/posetrack';
import type { FrameAcquisition } from './PipelineInterfaces';

/**
 * Video frame acquisition - owns the video element and its crop/zoom state.
 *
 * Frames reach the pipeline through extraction (VideoFileSkeletonSource) and
 * the video-event listeners in useExerciseAnalyzer, not from here.
 */
export class VideoFrameAcquisition implements FrameAcquisition {
  private cropRegion: CropRegion | null = null;
  private cropEnabled = false;

  constructor(private videoElement: HTMLVideoElement) {}

  /**
   * Set the crop region for auto-centering on person
   * @param crop The crop region, or null to disable cropping
   */
  setCropRegion(crop: CropRegion | null): void {
    this.cropRegion = crop;
    if (crop) {
      console.log(
        `[VideoFrameAcquisition] Crop region set: ${crop.width}x${crop.height} at (${crop.x}, ${crop.y})`
      );
    }
    this.applyCropTransform();
  }

  /**
   * Get the current crop region
   */
  getCropRegion(): CropRegion | null {
    return this.cropRegion;
  }

  /**
   * Enable or disable crop mode
   */
  setCropEnabled(enabled: boolean): void {
    this.cropEnabled = enabled;
    this.applyCropTransform();
  }

  /**
   * Check if crop is currently enabled
   */
  isCropEnabled(): boolean {
    return this.cropEnabled && this.cropRegion !== null;
  }

  /**
   * Apply CSS positioning for cropping.
   * Note: Transform is now handled by syncCanvasToVideo in useExerciseAnalyzer
   * to ensure video and canvas stay aligned.
   */
  private applyCropTransform(): void {
    // Transform is now handled by syncCanvasToVideo to keep video/canvas aligned
    // This method just logs the crop region for debugging
    const crop = this.cropRegion;
    if (crop && this.cropEnabled) {
      console.log(
        `[VideoFrameAcquisition] Crop enabled: ${crop.width}x${crop.height} at (${crop.x}, ${crop.y})`
      );
    }
  }

  /**
   * Get the current frame
   */
  getCurrentFrame(): HTMLVideoElement {
    return this.videoElement;
  }
}
