import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifyVideoLoadError,
  fetchWithProgress,
  formatPositionForDisplay,
  getFileNameFromUrl,
  getVideoLoadErrorMessage,
  isLandscapeVideo,
} from './videoLoadingUtils';

describe('videoLoadingUtils', () => {
  describe('getFileNameFromUrl', () => {
    it('extracts filename from simple URL', () => {
      expect(getFileNameFromUrl('https://example.com/video.webm')).toBe(
        'video.webm'
      );
    });

    it('extracts filename from URL with path', () => {
      expect(
        getFileNameFromUrl('https://example.com/path/to/swing-sample.mp4')
      ).toBe('swing-sample.mp4');
    });

    it('returns fallback for URL ending in slash', () => {
      expect(getFileNameFromUrl('https://example.com/')).toBe(
        'sample-video.webm'
      );
    });

    it('returns fallback for empty string', () => {
      expect(getFileNameFromUrl('')).toBe('sample-video.webm');
    });

    it('strips query string from filename', () => {
      expect(getFileNameFromUrl('https://example.com/video.webm?v=123')).toBe(
        'video.webm'
      );
    });

    it('strips hash from filename', () => {
      expect(getFileNameFromUrl('https://example.com/video.webm#section')).toBe(
        'video.webm'
      );
    });

    it('handles URL with both query and hash', () => {
      expect(
        getFileNameFromUrl('https://example.com/video.webm?v=1#start')
      ).toBe('video.webm');
    });

    it('handles relative URL', () => {
      expect(getFileNameFromUrl('/videos/local-video.mp4')).toBe(
        'local-video.mp4'
      );
    });

    it('handles filename-only URL', () => {
      expect(getFileNameFromUrl('just-a-file.webm')).toBe('just-a-file.webm');
    });
  });

  describe('classifyVideoLoadError', () => {
    it('classifies QuotaExceededError', () => {
      const error = new DOMException('', 'QuotaExceededError');
      expect(classifyVideoLoadError(error)).toBe('quota_exceeded');
    });

    it('classifies timeout error', () => {
      expect(classifyVideoLoadError(new Error('Request timeout'))).toBe(
        'timeout'
      );
      expect(classifyVideoLoadError(new Error('Timeout loading video'))).toBe(
        'timeout'
      );
    });

    it('classifies network/fetch error', () => {
      expect(classifyVideoLoadError(new Error('fetch failed'))).toBe('network');
      expect(classifyVideoLoadError(new Error('Network error'))).toBe(
        'network'
      );
    });

    it('classifies model load error', () => {
      expect(classifyVideoLoadError(new Error('Failed to load model'))).toBe(
        'model_load'
      );
    });

    it('classifies format unsupported error', () => {
      expect(classifyVideoLoadError(new Error('Format not supported'))).toBe(
        'format_unsupported'
      );
      expect(classifyVideoLoadError(new Error('Video format invalid'))).toBe(
        'format_unsupported'
      );
    });

    it('returns unknown for non-Error objects', () => {
      expect(classifyVideoLoadError('string error')).toBe('unknown');
      expect(classifyVideoLoadError(null)).toBe('unknown');
      expect(classifyVideoLoadError(undefined)).toBe('unknown');
      expect(classifyVideoLoadError({ message: 'object' })).toBe('unknown');
    });

    it('returns unknown for generic errors', () => {
      expect(classifyVideoLoadError(new Error('Something went wrong'))).toBe(
        'unknown'
      );
    });
  });

  describe('getVideoLoadErrorMessage', () => {
    it('returns quota exceeded message', () => {
      const error = new DOMException('', 'QuotaExceededError');
      expect(getVideoLoadErrorMessage(error, 'video')).toBe(
        'Storage full. Clear browser data and try again.'
      );
    });

    it('returns timeout message', () => {
      const error = new Error('Timeout');
      expect(getVideoLoadErrorMessage(error, 'video')).toBe(
        'Video load timed out. Check your network and try again.'
      );
    });

    it('returns network error message', () => {
      const error = new Error('Network error');
      expect(getVideoLoadErrorMessage(error, 'video')).toBe(
        'Network error loading video. Check your connection.'
      );
    });

    it('returns model load error message', () => {
      const error = new Error('Failed to load model');
      expect(getVideoLoadErrorMessage(error, 'video')).toBe(
        'Failed to load pose detection. Check network and refresh.'
      );
    });

    it('returns format unsupported message', () => {
      const error = new Error('Format not supported');
      expect(getVideoLoadErrorMessage(error, 'video')).toBe(
        'Video format not supported by your browser.'
      );
    });

    it('includes context for unknown errors', () => {
      expect(
        getVideoLoadErrorMessage(new Error('Unknown'), 'sample video')
      ).toBe('Could not load sample video');
      expect(getVideoLoadErrorMessage(null, 'the file')).toBe(
        'Could not load the file'
      );
    });
  });

  describe('formatPositionForDisplay', () => {
    it('capitalizes lowercase position', () => {
      expect(formatPositionForDisplay('top')).toBe('Top');
      expect(formatPositionForDisplay('bottom')).toBe('Bottom');
      expect(formatPositionForDisplay('connect')).toBe('Connect');
      expect(formatPositionForDisplay('release')).toBe('Release');
    });

    it('handles uppercase position', () => {
      expect(formatPositionForDisplay('TOP')).toBe('Top');
      expect(formatPositionForDisplay('BOTTOM')).toBe('Bottom');
    });

    it('handles mixed case position', () => {
      expect(formatPositionForDisplay('ToP')).toBe('Top');
      expect(formatPositionForDisplay('bOTTOM')).toBe('Bottom');
    });

    it('handles single character', () => {
      expect(formatPositionForDisplay('t')).toBe('T');
      expect(formatPositionForDisplay('T')).toBe('T');
    });

    it('returns empty string for empty input', () => {
      expect(formatPositionForDisplay('')).toBe('');
    });
  });

  describe('isLandscapeVideo', () => {
    it('returns true for landscape video (wider than threshold)', () => {
      // 1920x1080 = 1.78 aspect ratio > 1.2
      expect(isLandscapeVideo(1920, 1080)).toBe(true);
    });

    it('returns false for portrait video', () => {
      // 1080x1920 = 0.56 aspect ratio < 1.2
      expect(isLandscapeVideo(1080, 1920)).toBe(false);
    });

    it('returns false for square video (exactly at threshold)', () => {
      // 1200x1000 = 1.2 aspect ratio (not > 1.2)
      expect(isLandscapeVideo(1200, 1000)).toBe(false);
    });

    it('returns true when just over threshold', () => {
      // 1201x1000 = 1.201 aspect ratio > 1.2
      expect(isLandscapeVideo(1201, 1000)).toBe(true);
    });

    it('returns false for zero height (prevent division by zero)', () => {
      expect(isLandscapeVideo(1920, 0)).toBe(false);
    });

    it('supports custom threshold', () => {
      // 1500x1000 = 1.5 aspect ratio
      expect(isLandscapeVideo(1500, 1000, 1.6)).toBe(false); // < 1.6
      expect(isLandscapeVideo(1500, 1000, 1.4)).toBe(true); // > 1.4
    });
  });

  describe('fetchWithProgress', () => {
    let originalFetch: typeof fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('reports progress during download', async () => {
      const progressValues: number[] = [];
      const mockBody = {
        getReader: () => ({
          read: vi
            .fn()
            .mockResolvedValueOnce({
              done: false,
              value: new Uint8Array(50),
            })
            .mockResolvedValueOnce({
              done: false,
              value: new Uint8Array(50),
            })
            .mockResolvedValueOnce({ done: true }),
        }),
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: {
          get: (name: string) =>
            name === 'content-length' ? '100' : 'video/webm',
        },
        body: mockBody,
      });

      await fetchWithProgress('https://example.com/video.webm', (p) =>
        progressValues.push(p)
      );

      expect(progressValues).toEqual([50, 100]);
    });

    it('falls back to blob() when no content-length', async () => {
      const progressValues: number[] = [];
      const mockBlob = new Blob(['test']);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: {
          get: () => null,
        },
        body: null,
        blob: () => Promise.resolve(mockBlob),
      });

      const result = await fetchWithProgress(
        'https://example.com/video.webm',
        (p) => progressValues.push(p)
      );

      expect(progressValues).toEqual([100]);
      expect(result).toBe(mockBlob);
    });

    it('throws error on failed response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      await expect(
        fetchWithProgress('https://example.com/missing.webm', vi.fn())
      ).rejects.toThrow('Failed to fetch: 404');
    });

    it('respects abort signal', async () => {
      const controller = new AbortController();
      global.fetch = vi.fn().mockImplementation(() => {
        throw new DOMException('Aborted', 'AbortError');
      });

      controller.abort();

      await expect(
        fetchWithProgress(
          'https://example.com/video.webm',
          vi.fn(),
          controller.signal
        )
      ).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('uses correct content type from response', async () => {
      const mockBody = {
        getReader: () => ({
          read: vi.fn().mockResolvedValueOnce({ done: true }),
        }),
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: {
          get: (name: string) =>
            name === 'content-length' ? '0' : 'video/mp4',
        },
        body: mockBody,
      });

      const result = await fetchWithProgress(
        'https://example.com/video.mp4',
        vi.fn()
      );

      expect(result.type).toBe('video/mp4');
    });
  });
});
