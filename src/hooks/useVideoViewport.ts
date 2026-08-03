import { type RefObject, useCallback, useEffect, useState } from 'react';
import type { CropRegion } from '../types/posetrack';

/**
 * Owns the video viewport: aspect-ratio classification, the crop/zoom region,
 * and keeping the skeleton canvas aligned with the video's rendered area.
 *
 * Crop lives HERE and nowhere else. It used to be pushed into the Pipeline as
 * well, which forwarded it to a no-op — the geometry has always been applied
 * by syncCanvasToVideo. Analysis has no use for it.
 */
export function useVideoViewport(
  videoRef: RefObject<HTMLVideoElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>
) {
  const [cropRegion, setCropRegion] = useState<CropRegion | null>(null);
  const [isCropEnabled, setIsCropEnabled] = useState<boolean>(false); // off until the user zooms
  const [isLandscape, setIsLandscape] = useState<boolean>(false); // aspect ratio > 1.2

  const syncCanvasToVideo = useCallback(
    (isZoomed: boolean, crop: CropRegion | null) => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.videoWidth === 0) return;

      // Update landscape state based on video aspect ratio (threshold > 1.2)
      const aspectRatio = video.videoWidth / video.videoHeight;
      setIsLandscape(aspectRatio > 1.2);

      // Set canvas internal dimensions to match video
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      // Get video element's bounding box
      const videoRect = video.getBoundingClientRect();
      const container = canvas.parentElement;
      const containerRect = container?.getBoundingClientRect();

      // Calculate video element's position relative to container
      const videoOffsetX = containerRect
        ? videoRect.left - containerRect.left
        : 0;
      const videoOffsetY = containerRect
        ? videoRect.top - containerRect.top
        : 0;

      const videoAspect = video.videoWidth / video.videoHeight;
      const containerAspect = videoRect.width / videoRect.height;

      // Clear any transforms first
      canvas.style.transform = '';
      canvas.style.transformOrigin = '';

      if (isZoomed && crop) {
        // ===== ZOOMED MODE: object-fit: cover simulation =====
        // Calculate scale factor for cover behavior
        const scaleX = videoRect.width / video.videoWidth;
        const scaleY = videoRect.height / video.videoHeight;
        const coverScale = Math.max(scaleX, scaleY);

        // Scaled video dimensions (may be larger than container)
        const scaledWidth = video.videoWidth * coverScale;
        const scaledHeight = video.videoHeight * coverScale;

        // Calculate crop center as fraction
        const cropCenterX = (crop.x + crop.width / 2) / video.videoWidth;
        const cropCenterY = (crop.y + crop.height / 2) / video.videoHeight;

        // Calculate offset to center on crop region
        // object-position percentage works on the overflow area
        const overflowX = scaledWidth - videoRect.width;
        const overflowY = scaledHeight - videoRect.height;
        const offsetX = -overflowX * cropCenterX;
        const offsetY = -overflowY * cropCenterY;

        // Set canvas size to match scaled video content
        canvas.style.width = `${scaledWidth}px`;
        canvas.style.height = `${scaledHeight}px`;
        canvas.style.left = `${videoOffsetX + offsetX}px`;
        canvas.style.top = `${videoOffsetY + offsetY}px`;

        // Set video's object-position to show same region
        video.style.objectPosition = `${cropCenterX * 100}% ${cropCenterY * 100}%`;

        console.log(
          `[Canvas] Zoomed: scale=${coverScale.toFixed(3)}, size=${scaledWidth.toFixed(0)}x${scaledHeight.toFixed(0)}, offset=(${offsetX.toFixed(0)}, ${offsetY.toFixed(0)})`
        );
      } else {
        // ===== NORMAL MODE: object-fit: contain (letterboxing) =====
        let renderedWidth: number;
        let renderedHeight: number;
        let offsetX: number;
        let offsetY: number;

        if (videoAspect > containerAspect) {
          // Video is wider - letterbox top/bottom
          renderedWidth = videoRect.width;
          renderedHeight = videoRect.width / videoAspect;
          offsetX = 0;
          offsetY = (videoRect.height - renderedHeight) / 2;
        } else {
          // Video is taller - letterbox left/right
          renderedHeight = videoRect.height;
          renderedWidth = videoRect.height * videoAspect;
          offsetX = (videoRect.width - renderedWidth) / 2;
          offsetY = 0;
        }

        // Position canvas to match video's letterboxed area
        const finalX = videoOffsetX + offsetX;
        const finalY = videoOffsetY + offsetY;

        canvas.style.width = `${renderedWidth}px`;
        canvas.style.height = `${renderedHeight}px`;
        canvas.style.left = `${finalX}px`;
        canvas.style.top = `${finalY}px`;

        // Clear video object-position
        video.style.objectPosition = '';

        console.log(
          `[Canvas] Normal: ${renderedWidth.toFixed(0)}x${renderedHeight.toFixed(0)} at (${finalX.toFixed(0)},${finalY.toFixed(0)})`
        );
      }
    },
    [videoRef, canvasRef]
  );
  // Re-sync canvas on window resize
  useEffect(() => {
    const handleResize = () => {
      requestAnimationFrame(() => syncCanvasToVideo(isCropEnabled, cropRegion));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [syncCanvasToVideo, isCropEnabled, cropRegion]);

  const toggleCrop = useCallback(() => {
    if (!cropRegion) return;

    const newEnabled = !isCropEnabled;
    setIsCropEnabled(newEnabled);

    // Re-sync canvas to match the new zoom state.
    // rAF so the CSS class change has been applied first.
    requestAnimationFrame(() => {
      syncCanvasToVideo(newEnabled, cropRegion);
    });
  }, [cropRegion, isCropEnabled, syncCanvasToVideo]);

  const getVideoContainerClass = useCallback(() => {
    if (!videoRef.current) return '';
    const { videoWidth, videoHeight } = videoRef.current;
    return videoWidth > videoHeight ? 'video-landscape' : 'video-portrait';
  }, [videoRef]);

  return {
    cropRegion,
    setCropRegion,
    isCropEnabled,
    toggleCrop,
    hasCropRegion: cropRegion !== null,
    isLandscape,
    syncCanvasToVideo,
    getVideoContainerClass,
  };
}
