/**
 * Video Crop Utilities
 *
 * Calculates stable crop regions for centering on a person in landscape videos.
 * Uses keypoint bounding boxes from pose detection to find the person's location.
 */

import type { PoseKeypoint } from '../types';
import type { CropRegion, PoseTrackFrame } from '../types/posetrack';
import {
  asPixelX,
  asPixelY,
  type PixelX,
  type PixelY,
  type VideoHeight,
  type VideoWidth,
} from './brandedTypes';

/**
 * Bounding box in video pixel coordinates
 */
interface BoundingBox {
  minX: PixelX;
  minY: PixelY;
  maxX: PixelX;
  maxY: PixelY;
}

/**
 * Calculate bounding box from keypoints
 * Returns null if no confident keypoints found
 */
export function calculateBoundingBox(
  keypoints: PoseKeypoint[],
  minConfidence = 0.3
): BoundingBox | null {
  const confidentKeypoints = keypoints.filter(
    (kp) => (kp.score ?? 0) > minConfidence
  );

  if (confidentKeypoints.length === 0) {
    return null;
  }

  let minXVal = Infinity;
  let minYVal = Infinity;
  let maxXVal = -Infinity;
  let maxYVal = -Infinity;

  for (const kp of confidentKeypoints) {
    minXVal = Math.min(minXVal, kp.x);
    minYVal = Math.min(minYVal, kp.y);
    maxXVal = Math.max(maxXVal, kp.x);
    maxYVal = Math.max(maxYVal, kp.y);
  }

  return {
    minX: asPixelX(minXVal),
    minY: asPixelY(minYVal),
    maxX: asPixelX(maxXVal),
    maxY: asPixelY(maxYVal),
  };
}

/**
 * Merge multiple bounding boxes into their union
 */
export function mergeBoundingBoxes(boxes: BoundingBox[]): BoundingBox | null {
  if (boxes.length === 0) {
    return null;
  }

  let minXVal = Infinity;
  let minYVal = Infinity;
  let maxXVal = -Infinity;
  let maxYVal = -Infinity;

  for (const box of boxes) {
    minXVal = Math.min(minXVal, box.minX);
    minYVal = Math.min(minYVal, box.minY);
    maxXVal = Math.max(maxXVal, box.maxX);
    maxYVal = Math.max(maxYVal, box.maxY);
  }

  return {
    minX: asPixelX(minXVal),
    minY: asPixelY(minYVal),
    maxX: asPixelX(maxXVal),
    maxY: asPixelY(maxYVal),
  };
}

/**
 * Calculate a stable portrait crop region from pose frames
 *
 * Takes frames from the first few seconds of video and calculates
 * a crop region that encompasses all detected person positions.
 * Uses portrait aspect ratio (3:4) like thumbnails for better framing.
 *
 * @param frames - Frames from detection phase (first 5 seconds)
 * @param videoWidth - Full video width in pixels
 * @param videoHeight - Full video height in pixels
 * @param widthPadding - Width padding multiplier (default 1.4 = 40% like thumbnails)
 * @param heightPadding - Height padding multiplier (default 1.3 = 30% like thumbnails)
 * @returns CropRegion or null if no person detected
 */
export function calculateStableCropRegion(
  frames: PoseTrackFrame[],
  videoWidth: VideoWidth,
  videoHeight: VideoHeight,
  widthPadding = 1.4,
  heightPadding = 1.3
): CropRegion | null {
  // Portrait aspect ratio (3:4) like thumbnails - matches human body shape
  const targetAspect = 3 / 4;

  // Collect bounding boxes from all frames with detected poses
  const boxes: BoundingBox[] = [];

  for (const frame of frames) {
    if (frame.keypoints.length > 0) {
      const box = calculateBoundingBox(frame.keypoints);
      if (box) {
        boxes.push(box);
      }
    }
  }

  if (boxes.length === 0) {
    console.log('[VideoCrop] No person detected in frames');
    return null;
  }

  // Merge all boxes into union
  const unionBox = mergeBoundingBoxes(boxes);
  if (!unionBox) {
    return null;
  }

  // Calculate person center and size
  const personCenterX = (unionBox.minX + unionBox.maxX) / 2;
  const personCenterY = (unionBox.minY + unionBox.maxY) / 2;
  const personWidth = unionBox.maxX - unionBox.minX;
  const personHeight = unionBox.maxY - unionBox.minY;

  // Add padding (like thumbnails: 40% width, 30% height)
  const paddedWidth = personWidth * widthPadding;
  const paddedHeight = personHeight * heightPadding;

  // Determine crop size to fit person while maintaining portrait aspect ratio
  let cropWidth: number;
  let cropHeight: number;

  if (paddedWidth / paddedHeight > targetAspect) {
    // Person is wider than target aspect - fit width
    cropWidth = paddedWidth;
    cropHeight = cropWidth / targetAspect;
  } else {
    // Person is taller than target aspect - fit height
    cropHeight = paddedHeight;
    cropWidth = cropHeight * targetAspect;
  }

  // Cap crop at 85% of video height to ensure minimum ~1.18x zoom effect
  const maxCropHeight = videoHeight * 0.85;
  if (cropHeight > maxCropHeight) {
    cropHeight = maxCropHeight;
    cropWidth = cropHeight * targetAspect;
  }

  // Ensure crop doesn't exceed video bounds while maintaining aspect ratio
  if (cropWidth > videoWidth) {
    cropWidth = videoWidth;
    cropHeight = cropWidth / targetAspect;
  }
  if (cropHeight > videoHeight) {
    cropHeight = videoHeight;
    cropWidth = cropHeight * targetAspect;
  }

  // Center crop on person, but clamp to video bounds
  const cropX = Math.max(
    0,
    Math.min(personCenterX - cropWidth / 2, videoWidth - cropWidth)
  );
  const cropY = Math.max(
    0,
    Math.min(personCenterY - cropHeight / 2, videoHeight - cropHeight)
  );

  console.log(
    `[VideoCrop] Calculated crop: ${Math.round(cropX)},${Math.round(cropY)} ${Math.round(cropWidth)}x${Math.round(cropHeight)} (${targetAspect.toFixed(2)} aspect) from ${boxes.length} frames`
  );

  return {
    x: Math.round(cropX),
    y: Math.round(cropY),
    width: Math.round(cropWidth),
    height: Math.round(cropHeight),
  };
}

/**
 * Check if a video is landscape orientation
 */
export function isLandscapeVideo(
  videoWidth: VideoWidth,
  videoHeight: VideoHeight
): boolean {
  return videoWidth > videoHeight;
}
