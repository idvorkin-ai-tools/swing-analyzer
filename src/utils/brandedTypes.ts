/**
 * Branded Types for Type Safety
 *
 * These types use TypeScript's structural typing with brand tags to prevent
 * accidental mixing of values with different semantic meanings (e.g., pixels vs meters).
 *
 * USAGE:
 * - Use the `asXxx()` constructors when you have a known value
 * - Functions that return branded types document their output units
 * - The compiler catches mismatches at compile time
 *
 * EXAMPLE:
 *   const height: HeightCm = asHeightCm(173);
 *   const speed: MetersPerSecond = asMetersPerSecond(2.5);
 *   // compiler error: Type 'HeightCm' is not assignable to type 'MetersPerSecond'
 */

// ============================================
// Coordinate Types
// ============================================

/** X coordinate in pixels (0 = left edge of frame) */
export type PixelX = number & { readonly __brand: 'PixelX' };

/** Y coordinate in pixels (0 = top of frame) */
export type PixelY = number & { readonly __brand: 'PixelY' };

/** X coordinate normalized to 0-1 (0 = left, 1 = right) */
export type NormalizedX = number & { readonly __brand: 'NormalizedX' };

/** Y coordinate normalized to 0-1 (0 = top, 1 = bottom) */
export type NormalizedY = number & { readonly __brand: 'NormalizedY' };

// Coordinate constructors
export const asPixelX = (value: number): PixelX => value as PixelX;
export const asPixelY = (value: number): PixelY => value as PixelY;
export const asNormalizedX = (value: number): NormalizedX =>
  value as NormalizedX;
export const asNormalizedY = (value: number): NormalizedY =>
  value as NormalizedY;

// ============================================
// Dimension Types
// ============================================

/** Video/image width in pixels */
export type VideoWidth = number & { readonly __brand: 'VideoWidth' };

/** Video/image height in pixels */
export type VideoHeight = number & { readonly __brand: 'VideoHeight' };

// Dimension constructors
export const asVideoWidth = (value: number): VideoWidth => value as VideoWidth;
export const asVideoHeight = (value: number): VideoHeight =>
  value as VideoHeight;

// Default video dimensions (1080p)
export const DEFAULT_VIDEO_WIDTH: VideoWidth = asVideoWidth(1920);
export const DEFAULT_VIDEO_HEIGHT: VideoHeight = asVideoHeight(1080);

// ============================================
// Physical Measurement Types
// ============================================

/** Height in centimeters (human height measurement) */
export type HeightCm = number & { readonly __brand: 'HeightCm' };

/** Distance in meters */
export type Meters = number & { readonly __brand: 'Meters' };

// Physical measurement constructors
export const asHeightCm = (value: number): HeightCm => value as HeightCm;
export const asMeters = (value: number): Meters => value as Meters;

// Default human height (average adult ~5'8")
export const DEFAULT_USER_HEIGHT_CM: HeightCm = asHeightCm(173);

// ============================================
// Time Types
// ============================================

/** Time duration in seconds */
export type Seconds = number & { readonly __brand: 'Seconds' };

/** Time duration in milliseconds */
export type Milliseconds = number & { readonly __brand: 'Milliseconds' };

/** Timestamp (epoch milliseconds) */
export type TimestampMs = number & { readonly __brand: 'TimestampMs' };

// Time constructors
export const asSeconds = (value: number): Seconds => value as Seconds;
export const asMilliseconds = (value: number): Milliseconds =>
  value as Milliseconds;
export const asTimestampMs = (value: number): TimestampMs =>
  value as TimestampMs;

// ============================================
// Velocity Types
// ============================================

/** Speed in meters per second */
export type MetersPerSecond = number & { readonly __brand: 'MetersPerSecond' };

/** Speed in pixels per second */
export type PixelsPerSecond = number & { readonly __brand: 'PixelsPerSecond' };

// Velocity constructors
export const asMetersPerSecond = (value: number): MetersPerSecond =>
  value as MetersPerSecond;
export const asPixelsPerSecond = (value: number): PixelsPerSecond =>
  value as PixelsPerSecond;

// ============================================
// Angle Types
// ============================================

/** Angle in degrees (0-360 or -180 to +180) */
export type AngleDegrees = number & { readonly __brand: 'AngleDegrees' };

/** Angle in radians */
export type AngleRadians = number & { readonly __brand: 'AngleRadians' };

// Angle constructors
export const asAngleDegrees = (value: number): AngleDegrees =>
  value as AngleDegrees;
export const asAngleRadians = (value: number): AngleRadians =>
  value as AngleRadians;

// Angle conversions
export const degreesToRadians = (degrees: AngleDegrees): AngleRadians =>
  asAngleRadians(degrees * (Math.PI / 180));
export const radiansToDegrees = (radians: AngleRadians): AngleDegrees =>
  asAngleDegrees(radians * (180 / Math.PI));

// ============================================
// Percentage Types
// ============================================

/** Depth percentage 0-100 (0 = standing, 100 = full squat) */
export type DepthPercent = number & { readonly __brand: 'DepthPercent' };

/** Generic percentage 0-100 */
export type Percent = number & { readonly __brand: 'Percent' };

/** Confidence score 0-1 */
export type Confidence = number & { readonly __brand: 'Confidence' };

// Percentage constructors
export const asDepthPercent = (value: number): DepthPercent =>
  value as DepthPercent;
export const asPercent = (value: number): Percent => value as Percent;
export const asConfidence = (value: number): Confidence => value as Confidence;

// ============================================
// Conversion Utilities
// ============================================

/** Normalize pixel Y to 0-1 range */
export function normalizeY(
  pixelY: PixelY,
  videoHeight: VideoHeight
): NormalizedY {
  return asNormalizedY(pixelY / videoHeight);
}

/** Normalize pixel X to 0-1 range */
export function normalizeX(
  pixelX: PixelX,
  videoWidth: VideoWidth
): NormalizedX {
  return asNormalizedX(pixelX / videoWidth);
}

/** Convert normalized Y back to pixels */
export function denormalizeY(
  normalizedY: NormalizedY,
  videoHeight: VideoHeight
): PixelY {
  return asPixelY(normalizedY * videoHeight);
}

/** Convert normalized X back to pixels */
export function denormalizeX(
  normalizedX: NormalizedX,
  videoWidth: VideoWidth
): PixelX {
  return asPixelX(normalizedX * videoWidth);
}

/** Convert centimeters to meters */
export function cmToMeters(heightCm: HeightCm): Meters {
  return asMeters(heightCm / 100);
}

/** Convert meters to centimeters */
export function metersToCm(meters: Meters): HeightCm {
  return asHeightCm(meters * 100);
}

/** Convert milliseconds to seconds */
export function msToSeconds(ms: Milliseconds): Seconds {
  return asSeconds(ms / 1000);
}

/** Convert seconds to milliseconds */
export function secondsToMs(seconds: Seconds): Milliseconds {
  return asMilliseconds(seconds * 1000);
}
