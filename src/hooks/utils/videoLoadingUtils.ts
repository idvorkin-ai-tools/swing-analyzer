/**
 * Pure utility functions for video loading operations.
 * These are extracted from useExerciseAnalyzer for testability.
 *
 * All functions in this file are:
 * - Pure (no side effects except where explicitly noted)
 * - Deterministic (same inputs produce same outputs)
 * - Fully unit testable
 */

/**
 * Extracts filename from a URL path.
 *
 * @param url - The URL to extract the filename from
 * @returns The filename, or 'sample-video.webm' as fallback
 *
 * @example
 * getFileNameFromUrl('https://example.com/videos/swing.webm') // 'swing.webm'
 * getFileNameFromUrl('https://example.com/') // 'sample-video.webm'
 * getFileNameFromUrl('') // 'sample-video.webm'
 */
export function getFileNameFromUrl(url: string): string {
  if (!url) return 'sample-video.webm';
  const pathParts = url.split('/');
  const fileName = pathParts[pathParts.length - 1];
  // Handle empty filename (URL ending in /) and query strings
  const cleanFileName = fileName.split('?')[0].split('#')[0];
  return cleanFileName || 'sample-video.webm';
}

/**
 * Error types that can occur during video loading.
 * Using a discriminated union makes error handling exhaustive.
 */
export type VideoLoadErrorType =
  | 'quota_exceeded'
  | 'timeout'
  | 'network'
  | 'model_load'
  | 'format_unsupported'
  | 'unknown';

/**
 * Classifies an error into a known error type for consistent handling.
 *
 * @param error - The error to classify
 * @returns The error type
 */
export function classifyVideoLoadError(error: unknown): VideoLoadErrorType {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return 'quota_exceeded';
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes('timeout')) return 'timeout';
    if (message.includes('fetch') || message.includes('network'))
      return 'network';
    if (message.includes('model')) return 'model_load';
    if (message.includes('format') || message.includes('supported'))
      return 'format_unsupported';
  }
  return 'unknown';
}

/**
 * User-friendly error messages for each error type.
 */
const ERROR_MESSAGES: Record<VideoLoadErrorType, string> = {
  quota_exceeded: 'Storage full. Clear browser data and try again.',
  timeout: 'Video load timed out. Check your network and try again.',
  network: 'Network error loading video. Check your connection.',
  model_load: 'Failed to load pose detection. Check network and refresh.',
  format_unsupported: 'Video format not supported by your browser.',
  unknown: 'Could not load video',
};

/**
 * Converts an error to a user-friendly message for video loading failures.
 *
 * @param error - The error that occurred
 * @param context - Context for the error (e.g., "video", "sample video")
 * @returns A user-friendly error message
 *
 * @example
 * getVideoLoadErrorMessage(new DOMException('', 'QuotaExceededError'), 'video')
 * // 'Storage full. Clear browser data and try again.'
 */
export function getVideoLoadErrorMessage(
  error: unknown,
  context: string
): string {
  const errorType = classifyVideoLoadError(error);
  const message = ERROR_MESSAGES[errorType];

  // For unknown errors, include the context
  if (errorType === 'unknown') {
    return `Could not load ${context}`;
  }

  return message;
}

/**
 * Formats a position name for display (capitalizes first letter).
 *
 * @param position - The position name to format (e.g., "top", "BOTTOM")
 * @returns Formatted position (e.g., "Top", "Bottom")
 *
 * @example
 * formatPositionForDisplay('top') // 'Top'
 * formatPositionForDisplay('BOTTOM') // 'Bottom'
 * formatPositionForDisplay('Connect') // 'Connect'
 */
export function formatPositionForDisplay(position: string): string {
  if (!position) return '';
  return position.charAt(0).toUpperCase() + position.slice(1).toLowerCase();
}

/**
 * Progress callback for download operations.
 */
export type ProgressCallback = (percent: number) => void;

/**
 * Fetches a resource with progress reporting.
 * Note: This function has side effects (network request) but is still testable
 * by mocking fetch.
 *
 * @param url - The URL to fetch
 * @param onProgress - Callback for progress updates (0-100)
 * @param signal - Optional AbortSignal for cancellation
 * @returns The fetched blob
 * @throws Error if fetch fails or is aborted
 */
export async function fetchWithProgress(
  url: string,
  onProgress: ProgressCallback,
  signal?: AbortSignal
): Promise<Blob> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.status}`);
  }

  const contentLength = response.headers.get('content-length');
  if (!contentLength || !response.body) {
    // No content-length header or no body - fall back to regular blob()
    // Report 100% immediately since we can't track progress
    onProgress(100);
    return response.blob();
  }

  const total = parseInt(contentLength, 10);
  let loaded = 0;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    chunks.push(value);
    loaded += value.length;
    onProgress(Math.round((loaded / total) * 100));
  }

  return new Blob(chunks as BlobPart[], {
    type: response.headers.get('content-type') || 'video/webm',
  });
}

/**
 * Determines if a video aspect ratio indicates landscape orientation.
 *
 * @param width - Video width in pixels
 * @param height - Video height in pixels
 * @param threshold - Aspect ratio threshold (default 1.2)
 * @returns true if the video is landscape
 */
export function isLandscapeVideo(
  width: number,
  height: number,
  threshold: number = 1.2
): boolean {
  if (height === 0) return false;
  return width / height > threshold;
}
