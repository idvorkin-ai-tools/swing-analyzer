import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PositionCandidate } from '../types/exercise';
import { asMetersPerSecond } from '../utils/brandedTypes';
import {
  type AnalyzerState,
  analyzerReducer,
  getLoadingMessage,
  getLoadingProgress,
  getVideoFile,
  initialAnalyzerState,
  isVideoLoading,
  isVideoPlaying,
  isVideoReady,
  useAnalyzerState,
} from './useAnalyzerState';

describe('analyzerReducer', () => {
  describe('video lifecycle', () => {
    it('transitions from idle to loading', () => {
      const state = analyzerReducer(initialAnalyzerState, {
        type: 'START_LOADING',
        message: 'Loading video...',
      });

      expect(state.video.type).toBe('loading');
      if (state.video.type === 'loading') {
        expect(state.video.message).toBe('Loading video...');
      }
      expect(state.view.status).toBe('Loading video...');
    });

    it('updates loading progress', () => {
      const loadingState: AnalyzerState = {
        ...initialAnalyzerState,
        video: { type: 'loading', message: 'Loading...' },
      };

      const state = analyzerReducer(loadingState, {
        type: 'LOADING_PROGRESS',
        progress: 50,
        message: 'Downloading...',
      });

      expect(state.video.type).toBe('loading');
      if (state.video.type === 'loading') {
        expect(state.video.progress).toBe(50);
        expect(state.video.message).toBe('Downloading...');
      }
    });

    it('ignores loading progress when not in loading state', () => {
      const state = analyzerReducer(initialAnalyzerState, {
        type: 'LOADING_PROGRESS',
        progress: 50,
      });

      expect(state.video.type).toBe('idle');
    });

    it('transitions from loading to ready', () => {
      const loadingState: AnalyzerState = {
        ...initialAnalyzerState,
        video: { type: 'loading', message: 'Loading...' },
      };
      const videoFile = new File([''], 'test.mp4');

      const state = analyzerReducer(loadingState, {
        type: 'VIDEO_LOADED',
        videoFile,
      });

      expect(state.video.type).toBe('ready');
      if (state.video.type === 'ready') {
        expect(state.video.videoFile).toBe(videoFile);
      }
    });

    it('transitions from loading to extracting', () => {
      const loadingState: AnalyzerState = {
        ...initialAnalyzerState,
        video: { type: 'loading', message: 'Loading...' },
      };
      const videoFile = new File([''], 'test.mp4');

      const state = analyzerReducer(loadingState, {
        type: 'EXTRACTION_START',
        videoFile,
      });

      expect(state.video.type).toBe('extracting');
      if (state.video.type === 'extracting') {
        expect(state.video.videoFile).toBe(videoFile);
        expect(state.video.progress.currentFrame).toBe(0);
      }
    });

    it('updates extraction progress', () => {
      const videoFile = new File([''], 'test.mp4');
      const extractingState: AnalyzerState = {
        ...initialAnalyzerState,
        video: {
          type: 'extracting',
          videoFile,
          progress: {
            currentFrame: 0,
            totalFrames: 100,
            percentage: 0,
            currentTime: 0,
            totalDuration: 10,
          },
        },
      };

      const state = analyzerReducer(extractingState, {
        type: 'EXTRACTION_PROGRESS',
        progress: {
          currentFrame: 50,
          totalFrames: 100,
          percentage: 50,
          currentTime: 5,
          totalDuration: 10,
        },
      });

      expect(state.video.type).toBe('extracting');
      if (state.video.type === 'extracting') {
        expect(state.video.progress.currentFrame).toBe(50);
      }
    });

    it('transitions from extracting to ready on completion', () => {
      const videoFile = new File([''], 'test.mp4');
      const extractingState: AnalyzerState = {
        ...initialAnalyzerState,
        video: {
          type: 'extracting',
          videoFile,
          progress: {
            currentFrame: 100,
            totalFrames: 100,
            percentage: 100,
            currentTime: 10,
            totalDuration: 10,
          },
        },
      };

      const state = analyzerReducer(extractingState, {
        type: 'EXTRACTION_COMPLETE',
      });

      expect(state.video.type).toBe('ready');
      if (state.video.type === 'ready') {
        expect(state.video.videoFile).toBe(videoFile);
      }
    });

    it('transitions from ready to playing', () => {
      const videoFile = new File([''], 'test.mp4');
      const readyState: AnalyzerState = {
        ...initialAnalyzerState,
        video: { type: 'ready', videoFile },
      };

      const state = analyzerReducer(readyState, { type: 'PLAY' });

      expect(state.video.type).toBe('playing');
      if (state.video.type === 'playing') {
        expect(state.video.videoFile).toBe(videoFile);
      }
    });

    it('transitions from playing to ready on pause', () => {
      const videoFile = new File([''], 'test.mp4');
      const playingState: AnalyzerState = {
        ...initialAnalyzerState,
        video: { type: 'playing', videoFile },
      };

      const state = analyzerReducer(playingState, { type: 'PAUSE' });

      expect(state.video.type).toBe('ready');
    });

    it('transitions from playing to ready on video ended', () => {
      const videoFile = new File([''], 'test.mp4');
      const playingState: AnalyzerState = {
        ...initialAnalyzerState,
        video: { type: 'playing', videoFile },
      };

      const state = analyzerReducer(playingState, { type: 'VIDEO_ENDED' });

      expect(state.video.type).toBe('ready');
    });

    it('transitions to error state', () => {
      const loadingState: AnalyzerState = {
        ...initialAnalyzerState,
        video: { type: 'loading', message: 'Loading...' },
      };

      const state = analyzerReducer(loadingState, {
        type: 'ERROR',
        message: 'Network error',
      });

      expect(state.video.type).toBe('error');
      if (state.video.type === 'error') {
        expect(state.video.message).toBe('Network error');
      }
      expect(state.view.status).toBe('Error: Network error');
    });

    it('resets video state', () => {
      const videoFile = new File([''], 'test.mp4');
      const playingState: AnalyzerState = {
        ...initialAnalyzerState,
        video: { type: 'playing', videoFile },
        analysis: {
          repCount: 5,
          repThumbnails: new Map(),
          hasPosesForCurrentFrame: true,
        },
      };

      const state = analyzerReducer(playingState, { type: 'RESET_VIDEO' });

      expect(state.video.type).toBe('idle');
      expect(state.analysis.repCount).toBe(0);
    });

    it('ignores invalid transitions', () => {
      // Can't play from idle
      const state1 = analyzerReducer(initialAnalyzerState, { type: 'PLAY' });
      expect(state1.video.type).toBe('idle');

      // Can't pause from idle
      const state2 = analyzerReducer(initialAnalyzerState, { type: 'PAUSE' });
      expect(state2.video.type).toBe('idle');

      // Can't complete extraction from loading
      const loadingState: AnalyzerState = {
        ...initialAnalyzerState,
        video: { type: 'loading', message: 'Loading...' },
      };
      const state3 = analyzerReducer(loadingState, {
        type: 'EXTRACTION_COMPLETE',
      });
      expect(state3.video.type).toBe('loading');
    });
  });

  describe('analysis state', () => {
    it('updates rep count', () => {
      const state = analyzerReducer(initialAnalyzerState, {
        type: 'SET_REP_COUNT',
        count: 5,
      });

      expect(state.analysis.repCount).toBe(5);
    });

    it('adds thumbnails', () => {
      const candidate: PositionCandidate = {
        position: 'top',
        videoTime: 1.5,
        timestamp: 1500,
        angles: { spine: 45, arm: 30 },
        score: 0.9,
      };

      const state = analyzerReducer(initialAnalyzerState, {
        type: 'ADD_THUMBNAIL',
        repNum: 1,
        position: 'top',
        candidate,
      });

      expect(state.analysis.repThumbnails.get(1)?.get('top')).toBe(candidate);
    });

    it('adds multiple thumbnails to same rep', () => {
      const topCandidate: PositionCandidate = {
        position: 'top',
        videoTime: 1.5,
        timestamp: 1500,
        angles: { spine: 45 },
        score: 0.9,
      };
      const bottomCandidate: PositionCandidate = {
        position: 'bottom',
        videoTime: 2.0,
        timestamp: 2000,
        angles: { spine: 90 },
        score: 0.85,
      };

      let state = analyzerReducer(initialAnalyzerState, {
        type: 'ADD_THUMBNAIL',
        repNum: 1,
        position: 'top',
        candidate: topCandidate,
      });
      state = analyzerReducer(state, {
        type: 'ADD_THUMBNAIL',
        repNum: 1,
        position: 'bottom',
        candidate: bottomCandidate,
      });

      expect(state.analysis.repThumbnails.get(1)?.get('top')).toBe(
        topCandidate
      );
      expect(state.analysis.repThumbnails.get(1)?.get('bottom')).toBe(
        bottomCandidate
      );
    });

    it('clears thumbnails', () => {
      const candidate: PositionCandidate = {
        position: 'top',
        videoTime: 1.5,
        timestamp: 1500,
        angles: { spine: 45 },
        score: 0.9,
      };

      let state = analyzerReducer(initialAnalyzerState, {
        type: 'ADD_THUMBNAIL',
        repNum: 1,
        position: 'top',
        candidate,
      });
      state = analyzerReducer(state, { type: 'CLEAR_THUMBNAILS' });

      expect(state.analysis.repThumbnails.size).toBe(0);
    });

    it('sets has poses flag', () => {
      const state = analyzerReducer(initialAnalyzerState, {
        type: 'SET_HAS_POSES',
        hasPoses: true,
      });

      expect(state.analysis.hasPosesForCurrentFrame).toBe(true);
    });
  });

  describe('HUD state', () => {
    it('updates HUD angles', () => {
      const state = analyzerReducer(initialAnalyzerState, {
        type: 'UPDATE_HUD',
        spineAngle: 45,
        armAngle: 30,
        wristVelocity: 2.5,
      });

      expect(state.hud.spineAngle).toBe(45);
      expect(state.hud.armAngle).toBe(30);
      expect(state.hud.wristVelocity).toBe(asMetersPerSecond(2.5));
    });

    it('preserves wrist velocity when not provided', () => {
      const stateWithVelocity: AnalyzerState = {
        ...initialAnalyzerState,
        hud: {
          ...initialAnalyzerState.hud,
          wristVelocity: asMetersPerSecond(3),
        },
      };

      const state = analyzerReducer(stateWithVelocity, {
        type: 'UPDATE_HUD',
        spineAngle: 45,
        armAngle: 30,
      });

      expect(state.hud.wristVelocity).toBe(asMetersPerSecond(3));
    });

    it('updates generic angles', () => {
      const state = analyzerReducer(initialAnalyzerState, {
        type: 'UPDATE_ANGLES',
        angles: { spine: 45, hip: 120, knee: 90 },
      });

      expect(state.hud.currentAngles).toEqual({
        spine: 45,
        hip: 120,
        knee: 90,
      });
    });

    it('sets position and updates status', () => {
      const state = analyzerReducer(initialAnalyzerState, {
        type: 'SET_POSITION',
        position: 'Top',
      });

      expect(state.hud.currentPosition).toBe('Top');
      expect(state.view.status).toBe('Top');
    });

    it('clears position without updating status', () => {
      const stateWithPosition: AnalyzerState = {
        ...initialAnalyzerState,
        hud: { ...initialAnalyzerState.hud, currentPosition: 'Top' },
        view: { ...initialAnalyzerState.view, status: 'Top' },
      };

      const state = analyzerReducer(stateWithPosition, {
        type: 'SET_POSITION',
        position: null,
      });

      expect(state.hud.currentPosition).toBeNull();
      expect(state.view.status).toBe('Top'); // Status not cleared
    });
  });

  describe('view state', () => {
    it('toggles crop', () => {
      expect(initialAnalyzerState.view.isCropEnabled).toBe(false);

      const state1 = analyzerReducer(initialAnalyzerState, {
        type: 'TOGGLE_CROP',
      });
      expect(state1.view.isCropEnabled).toBe(true);

      const state2 = analyzerReducer(state1, { type: 'TOGGLE_CROP' });
      expect(state2.view.isCropEnabled).toBe(false);
    });

    it('sets crop region', () => {
      const region = { x: 100, y: 200, width: 300, height: 400 };
      const state = analyzerReducer(initialAnalyzerState, {
        type: 'SET_CROP_REGION',
        region,
      });

      expect(state.view.cropRegion).toEqual(region);
    });

    it('sets display mode', () => {
      const state = analyzerReducer(initialAnalyzerState, {
        type: 'SET_DISPLAY_MODE',
        mode: 'overlay',
      });

      expect(state.view.displayMode).toBe('overlay');
    });

    it('sets landscape flag', () => {
      const state = analyzerReducer(initialAnalyzerState, {
        type: 'SET_LANDSCAPE',
        isLandscape: true,
      });

      expect(state.view.isLandscape).toBe(true);
    });

    it('sets status', () => {
      const state = analyzerReducer(initialAnalyzerState, {
        type: 'SET_STATUS',
        status: 'Processing frame 50/100',
      });

      expect(state.view.status).toBe('Processing frame 50/100');
    });
  });

  describe('model and navigation', () => {
    it('sets model loaded', () => {
      const state = analyzerReducer(initialAnalyzerState, {
        type: 'MODEL_LOADED',
      });

      expect(state.isModelLoaded).toBe(true);
      expect(state.view.status).toBe('Ready');
    });

    it('sets rep index within bounds', () => {
      const stateWithReps: AnalyzerState = {
        ...initialAnalyzerState,
        analysis: { ...initialAnalyzerState.analysis, repCount: 5 },
      };

      const state = analyzerReducer(stateWithReps, {
        type: 'SET_REP_INDEX',
        index: 3,
      });

      expect(state.currentRepIndex).toBe(3);
    });

    it('ignores rep index out of bounds', () => {
      const stateWithReps: AnalyzerState = {
        ...initialAnalyzerState,
        analysis: { ...initialAnalyzerState.analysis, repCount: 5 },
        currentRepIndex: 2,
      };

      // Negative index
      const state1 = analyzerReducer(stateWithReps, {
        type: 'SET_REP_INDEX',
        index: -1,
      });
      expect(state1.currentRepIndex).toBe(2);

      // Index >= repCount
      const state2 = analyzerReducer(stateWithReps, {
        type: 'SET_REP_INDEX',
        index: 5,
      });
      expect(state2.currentRepIndex).toBe(2);
    });
  });

  describe('full reset', () => {
    it('resets all state but preserves model loaded', () => {
      const videoFile = new File([''], 'test.mp4');
      const complexState: AnalyzerState = {
        video: { type: 'playing', videoFile },
        hud: {
          spineAngle: 45,
          armAngle: 30,
          wristVelocity: asMetersPerSecond(2),
          currentAngles: { spine: 45 },
          currentPosition: 'Top',
        },
        analysis: {
          repCount: 10,
          repThumbnails: new Map([[1, new Map()]]),
          hasPosesForCurrentFrame: true,
        },
        view: {
          cropRegion: { x: 0, y: 0, width: 100, height: 100 },
          isCropEnabled: true,
          isLandscape: true,
          displayMode: 'overlay',
          status: 'Playing',
        },
        isModelLoaded: true,
        currentRepIndex: 5,
      };

      const state = analyzerReducer(complexState, { type: 'RESET_ALL' });

      expect(state.video.type).toBe('idle');
      expect(state.hud.spineAngle).toBe(0);
      expect(state.analysis.repCount).toBe(0);
      expect(state.view.isCropEnabled).toBe(false);
      expect(state.currentRepIndex).toBe(0);
      // Model loaded should be preserved
      expect(state.isModelLoaded).toBe(true);
    });
  });
});

describe('selectors', () => {
  it('isVideoReady returns true for ready and playing states', () => {
    const videoFile = new File([''], 'test.mp4');

    expect(isVideoReady(initialAnalyzerState)).toBe(false);
    expect(
      isVideoReady({
        ...initialAnalyzerState,
        video: { type: 'ready', videoFile },
      })
    ).toBe(true);
    expect(
      isVideoReady({
        ...initialAnalyzerState,
        video: { type: 'playing', videoFile },
      })
    ).toBe(true);
  });

  it('isVideoPlaying returns true only for playing state', () => {
    const videoFile = new File([''], 'test.mp4');

    expect(isVideoPlaying(initialAnalyzerState)).toBe(false);
    expect(
      isVideoPlaying({
        ...initialAnalyzerState,
        video: { type: 'ready', videoFile },
      })
    ).toBe(false);
    expect(
      isVideoPlaying({
        ...initialAnalyzerState,
        video: { type: 'playing', videoFile },
      })
    ).toBe(true);
  });

  it('isVideoLoading returns true for loading and extracting states', () => {
    const videoFile = new File([''], 'test.mp4');

    expect(isVideoLoading(initialAnalyzerState)).toBe(false);
    expect(
      isVideoLoading({
        ...initialAnalyzerState,
        video: { type: 'loading', message: 'Loading...' },
      })
    ).toBe(true);
    expect(
      isVideoLoading({
        ...initialAnalyzerState,
        video: {
          type: 'extracting',
          videoFile,
          progress: {
            currentFrame: 0,
            totalFrames: 100,
            percentage: 0,
            currentTime: 0,
            totalDuration: 10,
          },
        },
      })
    ).toBe(true);
  });

  it('getVideoFile returns file when available', () => {
    const videoFile = new File([''], 'test.mp4');

    expect(getVideoFile(initialAnalyzerState)).toBeNull();
    expect(
      getVideoFile({
        ...initialAnalyzerState,
        video: { type: 'ready', videoFile },
      })
    ).toBe(videoFile);
    expect(
      getVideoFile({
        ...initialAnalyzerState,
        video: { type: 'playing', videoFile },
      })
    ).toBe(videoFile);
  });

  it('getLoadingProgress returns progress when loading', () => {
    const videoFile = new File([''], 'test.mp4');

    expect(getLoadingProgress(initialAnalyzerState)).toBeUndefined();
    expect(
      getLoadingProgress({
        ...initialAnalyzerState,
        video: { type: 'loading', message: 'Loading...', progress: 50 },
      })
    ).toBe(50);
    expect(
      getLoadingProgress({
        ...initialAnalyzerState,
        video: {
          type: 'extracting',
          videoFile,
          progress: {
            currentFrame: 25,
            totalFrames: 100,
            percentage: 25,
            currentTime: 2.5,
            totalDuration: 10,
          },
        },
      })
    ).toBe(25);
  });

  it('getLoadingMessage returns message when loading', () => {
    expect(getLoadingMessage(initialAnalyzerState)).toBeUndefined();
    expect(
      getLoadingMessage({
        ...initialAnalyzerState,
        video: { type: 'loading', message: 'Downloading...' },
      })
    ).toBe('Downloading...');
  });
});

describe('useAnalyzerState hook', () => {
  it('returns initial state', () => {
    const { result } = renderHook(() => useAnalyzerState());

    expect(result.current.state.video.type).toBe('idle');
    expect(result.current.isVideoReady).toBe(false);
    expect(result.current.isVideoPlaying).toBe(false);
  });

  it('dispatches actions via convenience methods', () => {
    const { result } = renderHook(() => useAnalyzerState());

    act(() => {
      result.current.actions.startLoading('Loading test video...');
    });

    expect(result.current.state.video.type).toBe('loading');
    if (result.current.state.video.type === 'loading') {
      expect(result.current.state.video.message).toBe('Loading test video...');
    }
    expect(result.current.isVideoLoading).toBe(true);
  });

  it('supports custom initial state', () => {
    const { result } = renderHook(() =>
      useAnalyzerState({
        isModelLoaded: true,
        view: {
          ...initialAnalyzerState.view,
          displayMode: 'overlay',
        },
      })
    );

    expect(result.current.state.isModelLoaded).toBe(true);
    expect(result.current.state.view.displayMode).toBe('overlay');
  });

  it('updates selectors when state changes', () => {
    const { result } = renderHook(() => useAnalyzerState());
    const videoFile = new File([''], 'test.mp4');

    expect(result.current.videoFile).toBeNull();

    act(() => {
      result.current.actions.startLoading('Loading...');
    });
    act(() => {
      result.current.actions.videoLoaded(videoFile);
    });

    expect(result.current.videoFile).toBe(videoFile);
    expect(result.current.isVideoReady).toBe(true);
  });

  it('handles full video lifecycle', () => {
    const { result } = renderHook(() => useAnalyzerState());
    const videoFile = new File([''], 'test.mp4');

    // Start loading
    act(() => {
      result.current.actions.startLoading('Loading...');
    });
    expect(result.current.isVideoLoading).toBe(true);

    // Video loaded
    act(() => {
      result.current.actions.videoLoaded(videoFile);
    });
    expect(result.current.isVideoReady).toBe(true);
    expect(result.current.isVideoPlaying).toBe(false);

    // Play
    act(() => {
      result.current.actions.play();
    });
    expect(result.current.isVideoPlaying).toBe(true);

    // Pause
    act(() => {
      result.current.actions.pause();
    });
    expect(result.current.isVideoPlaying).toBe(false);
    expect(result.current.isVideoReady).toBe(true);
  });
});
