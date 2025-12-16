/**
 * Pure utility functions for canvas/video synchronization.
 * These handle the geometry calculations for aligning skeleton overlay with video.
 *
 * All functions are pure - no DOM manipulation, just calculations.
 * The calling code applies results to DOM elements.
 */

import type { CropRegion } from '../../types/posetrack';

/**
 * Dimensions of the video element in the DOM.
 */
export interface VideoRect {
  width: number;
  height: number;
}

/**
 * Video's native dimensions (before CSS scaling).
 */
export interface VideoDimensions {
  videoWidth: number;
  videoHeight: number;
}

/**
 * Position and offset information for canvas placement.
 */
export interface CanvasPlacement {
  width: number;
  height: number;
  left: number;
  top: number;
  objectPosition?: string; // For video element's object-position CSS
}

/**
 * Calculates canvas placement for normal mode (object-fit: contain).
 * In this mode, video is letterboxed to fit the container.
 *
 * @param video - Native video dimensions
 * @param container - Container dimensions (video element's rendered size)
 * @param videoOffset - Video element's offset relative to its container
 * @returns Canvas placement to match video's letterboxed area
 */
export function calculateNormalModePlacement(
  video: VideoDimensions,
  container: VideoRect,
  videoOffset: { x: number; y: number }
): CanvasPlacement {
  const videoAspect = video.videoWidth / video.videoHeight;
  const containerAspect = container.width / container.height;

  let renderedWidth: number;
  let renderedHeight: number;
  let offsetX: number;
  let offsetY: number;

  if (videoAspect > containerAspect) {
    // Video is wider than container - letterbox top/bottom
    renderedWidth = container.width;
    renderedHeight = container.width / videoAspect;
    offsetX = 0;
    offsetY = (container.height - renderedHeight) / 2;
  } else {
    // Video is taller than container - letterbox left/right
    renderedHeight = container.height;
    renderedWidth = container.height * videoAspect;
    offsetX = (container.width - renderedWidth) / 2;
    offsetY = 0;
  }

  return {
    width: renderedWidth,
    height: renderedHeight,
    left: videoOffset.x + offsetX,
    top: videoOffset.y + offsetY,
  };
}

/**
 * Calculates canvas placement for zoomed mode (object-fit: cover).
 * In this mode, video fills the container and crops to the region of interest.
 *
 * @param video - Native video dimensions
 * @param container - Container dimensions (video element's rendered size)
 * @param videoOffset - Video element's offset relative to its container
 * @param crop - Crop region to center on
 * @returns Canvas placement to match video's zoomed/cropped area
 */
export function calculateZoomedModePlacement(
  video: VideoDimensions,
  container: VideoRect,
  videoOffset: { x: number; y: number },
  crop: CropRegion
): CanvasPlacement {
  // Calculate scale factor for cover behavior
  const scaleX = container.width / video.videoWidth;
  const scaleY = container.height / video.videoHeight;
  const coverScale = Math.max(scaleX, scaleY);

  // Scaled video dimensions (may be larger than container)
  const scaledWidth = video.videoWidth * coverScale;
  const scaledHeight = video.videoHeight * coverScale;

  // Calculate crop center as fraction (0-1)
  const cropCenterX = (crop.x + crop.width / 2) / video.videoWidth;
  const cropCenterY = (crop.y + crop.height / 2) / video.videoHeight;

  // Calculate offset to center on crop region
  const overflowX = scaledWidth - container.width;
  const overflowY = scaledHeight - container.height;
  const offsetX = -overflowX * cropCenterX;
  const offsetY = -overflowY * cropCenterY;

  return {
    width: scaledWidth,
    height: scaledHeight,
    left: videoOffset.x + offsetX,
    top: videoOffset.y + offsetY,
    objectPosition: `${cropCenterX * 100}% ${cropCenterY * 100}%`,
  };
}

/**
 * Determines which placement mode to use and calculates the result.
 *
 * @param video - Native video dimensions
 * @param container - Container dimensions
 * @param videoOffset - Video element's offset
 * @param isZoomed - Whether zoom mode is enabled
 * @param crop - Crop region (required when isZoomed is true)
 * @returns Canvas placement for the appropriate mode
 */
export function calculateCanvasPlacement(
  video: VideoDimensions,
  container: VideoRect,
  videoOffset: { x: number; y: number },
  isZoomed: boolean,
  crop: CropRegion | null
): CanvasPlacement {
  if (isZoomed && crop) {
    return calculateZoomedModePlacement(video, container, videoOffset, crop);
  }
  return calculateNormalModePlacement(video, container, videoOffset);
}

/**
 * Calculates scale factors between video and container.
 * Useful for converting between video coordinates and screen coordinates.
 *
 * @param video - Native video dimensions
 * @param placement - Calculated canvas placement
 * @returns Scale factors for x and y axes
 */
export function calculateScaleFactors(
  video: VideoDimensions,
  placement: CanvasPlacement
): { scaleX: number; scaleY: number } {
  return {
    scaleX: placement.width / video.videoWidth,
    scaleY: placement.height / video.videoHeight,
  };
}
