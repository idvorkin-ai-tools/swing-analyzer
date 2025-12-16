/**
 * useAnalyzerState - Centralized state management for exercise analyzer.
 *
 * Uses discriminated unions to make invalid states impossible.
 * All state transitions are explicit and testable.
 *
 * Video Lifecycle:
 *   idle → loading → extracting → ready ⇄ playing
 *                                    ↓
 *                                  error
 */

import { useMemo, useReducer } from 'react';
import type { ExtractionProgress } from '../pipeline/SkeletonSource';
import type { PositionCandidate } from '../types/exercise';
import type { CropRegion } from '../types/posetrack';
import { asMetersPerSecond, type MetersPerSecond } from '../utils/brandedTypes';

// ============================================
// Video Lifecycle State (Discriminated Union)
// ============================================

/** Video is not loaded */
interface VideoIdle {
  type: 'idle';
}

/** Video is being fetched/loaded */
interface VideoLoading {
  type: 'loading';
  message: string;
  progress?: number;
}

/** Poses are being extracted from video */
interface VideoExtracting {
  type: 'extracting';
  videoFile: File;
  progress: ExtractionProgress;
}

/** Video loaded and ready to play */
interface VideoReady {
  type: 'ready';
  videoFile: File;
}

/** Video is currently playing */
interface VideoPlaying {
  type: 'playing';
  videoFile: File;
}

/** Error occurred during loading/extraction */
interface VideoError {
  type: 'error';
  message: string;
}

/** Discriminated union of all video states */
export type VideoState =
  | VideoIdle
  | VideoLoading
  | VideoExtracting
  | VideoReady
  | VideoPlaying
  | VideoError;

// ============================================
// HUD Display State
// ============================================

export interface HudState {
  spineAngle: number;
  armAngle: number;
  wristVelocity: MetersPerSecond;
  currentAngles: Record<string, number>;
  currentPosition: string | null;
}

// ============================================
// Analysis State
// ============================================

export interface AnalysisState {
  repCount: number;
  repThumbnails: Map<number, Map<string, PositionCandidate>>;
  hasPosesForCurrentFrame: boolean;
}

// ============================================
// View State
// ============================================

export interface ViewState {
  cropRegion: CropRegion | null;
  isCropEnabled: boolean;
  isLandscape: boolean;
  displayMode: 'both' | 'video' | 'overlay';
  status: string;
}

// ============================================
// Full Analyzer State
// ============================================

export interface AnalyzerState {
  video: VideoState;
  hud: HudState;
  analysis: AnalysisState;
  view: ViewState;
  isModelLoaded: boolean;
  /** Rep index for gallery navigation (0-indexed) */
  currentRepIndex: number;
}

// ============================================
// Initial State
// ============================================

export const initialAnalyzerState: AnalyzerState = {
  video: { type: 'idle' },
  hud: {
    spineAngle: 0,
    armAngle: 0,
    wristVelocity: asMetersPerSecond(0),
    currentAngles: {},
    currentPosition: null,
  },
  analysis: {
    repCount: 0,
    repThumbnails: new Map(),
    hasPosesForCurrentFrame: false,
  },
  view: {
    cropRegion: null,
    isCropEnabled: false,
    isLandscape: false,
    displayMode: 'both',
    status: 'Loading...',
  },
  isModelLoaded: false,
  currentRepIndex: 0,
};

// ============================================
// Actions
// ============================================

export type AnalyzerAction =
  // Video lifecycle
  | { type: 'START_LOADING'; message: string }
  | { type: 'LOADING_PROGRESS'; progress: number; message?: string }
  | { type: 'VIDEO_LOADED'; videoFile: File }
  | { type: 'EXTRACTION_START'; videoFile: File }
  | { type: 'EXTRACTION_PROGRESS'; progress: ExtractionProgress }
  | { type: 'EXTRACTION_COMPLETE' }
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'VIDEO_ENDED' }
  | { type: 'ERROR'; message: string }
  | { type: 'RESET_VIDEO' }
  // Analysis
  | { type: 'SET_REP_COUNT'; count: number }
  | {
      type: 'ADD_THUMBNAIL';
      repNum: number;
      position: string;
      candidate: PositionCandidate;
    }
  | {
      type: 'SET_REP_THUMBNAILS';
      repNum: number;
      positions: Map<string, PositionCandidate>;
    }
  | { type: 'CLEAR_THUMBNAILS' }
  | { type: 'SET_HAS_POSES'; hasPoses: boolean }
  // HUD
  | {
      type: 'UPDATE_HUD';
      spineAngle: number;
      armAngle: number;
      wristVelocity?: number;
    }
  | { type: 'UPDATE_ANGLES'; angles: Record<string, number> }
  | { type: 'SET_POSITION'; position: string | null }
  // View
  | { type: 'TOGGLE_CROP' }
  | { type: 'SET_CROP_REGION'; region: CropRegion | null }
  | { type: 'SET_DISPLAY_MODE'; mode: 'both' | 'video' | 'overlay' }
  | { type: 'SET_LANDSCAPE'; isLandscape: boolean }
  | { type: 'SET_STATUS'; status: string }
  // Model
  | { type: 'MODEL_LOADED' }
  // Navigation
  | { type: 'SET_REP_INDEX'; index: number }
  // Full reset
  | { type: 'RESET_ALL' };

// ============================================
// Reducer
// ============================================

export function analyzerReducer(
  state: AnalyzerState,
  action: AnalyzerAction
): AnalyzerState {
  switch (action.type) {
    // ---- Video Lifecycle ----
    case 'START_LOADING':
      return {
        ...state,
        video: { type: 'loading', message: action.message },
        view: { ...state.view, status: action.message },
      };

    case 'LOADING_PROGRESS':
      if (state.video.type !== 'loading') return state;
      return {
        ...state,
        video: {
          ...state.video,
          progress: action.progress,
          message: action.message ?? state.video.message,
        },
        view: {
          ...state.view,
          status: action.message ?? `Loading... ${action.progress}%`,
        },
      };

    case 'VIDEO_LOADED':
      // Can transition from loading to ready (skipping extraction if cached)
      if (state.video.type !== 'loading' && state.video.type !== 'extracting') {
        return state;
      }
      return {
        ...state,
        video: { type: 'ready', videoFile: action.videoFile },
        view: { ...state.view, status: 'Video loaded. Press Play to start.' },
      };

    case 'EXTRACTION_START':
      if (state.video.type !== 'loading') return state;
      return {
        ...state,
        video: {
          type: 'extracting',
          videoFile: action.videoFile,
          progress: {
            currentFrame: 0,
            totalFrames: 0,
            percentage: 0,
            currentTime: 0,
            totalDuration: 0,
          },
        },
        view: { ...state.view, status: 'Extracting poses...' },
      };

    case 'EXTRACTION_PROGRESS':
      if (state.video.type !== 'extracting') return state;
      return {
        ...state,
        video: { ...state.video, progress: action.progress },
      };

    case 'EXTRACTION_COMPLETE':
      if (state.video.type !== 'extracting') return state;
      return {
        ...state,
        video: { type: 'ready', videoFile: state.video.videoFile },
        view: { ...state.view, status: 'Video loaded. Press Play to start.' },
      };

    case 'PLAY': {
      if (state.video.type !== 'ready' && state.video.type !== 'playing') {
        return state;
      }
      const videoFile = state.video.videoFile;
      return {
        ...state,
        video: { type: 'playing', videoFile },
      };
    }

    case 'PAUSE':
    case 'VIDEO_ENDED':
      if (state.video.type !== 'playing') return state;
      return {
        ...state,
        video: { type: 'ready', videoFile: state.video.videoFile },
      };

    case 'ERROR':
      return {
        ...state,
        video: { type: 'error', message: action.message },
        view: { ...state.view, status: `Error: ${action.message}` },
      };

    case 'RESET_VIDEO':
      return {
        ...state,
        video: { type: 'idle' },
        analysis: {
          repCount: 0,
          repThumbnails: new Map(),
          hasPosesForCurrentFrame: false,
        },
        currentRepIndex: 0,
        view: { ...state.view, status: 'Ready' },
      };

    // ---- Analysis ----
    case 'SET_REP_COUNT':
      return {
        ...state,
        analysis: { ...state.analysis, repCount: action.count },
      };

    case 'ADD_THUMBNAIL': {
      const newThumbnails = new Map(state.analysis.repThumbnails);
      const repMap = newThumbnails.get(action.repNum) ?? new Map();
      repMap.set(action.position, action.candidate);
      newThumbnails.set(action.repNum, repMap);
      return {
        ...state,
        analysis: { ...state.analysis, repThumbnails: newThumbnails },
      };
    }

    case 'SET_REP_THUMBNAILS': {
      const newThumbnails = new Map(state.analysis.repThumbnails);
      newThumbnails.set(action.repNum, action.positions);
      return {
        ...state,
        analysis: { ...state.analysis, repThumbnails: newThumbnails },
      };
    }

    case 'CLEAR_THUMBNAILS':
      return {
        ...state,
        analysis: { ...state.analysis, repThumbnails: new Map() },
      };

    case 'SET_HAS_POSES':
      return {
        ...state,
        analysis: {
          ...state.analysis,
          hasPosesForCurrentFrame: action.hasPoses,
        },
      };

    // ---- HUD ----
    case 'UPDATE_HUD':
      return {
        ...state,
        hud: {
          ...state.hud,
          spineAngle: action.spineAngle,
          armAngle: action.armAngle,
          wristVelocity:
            action.wristVelocity !== undefined
              ? asMetersPerSecond(action.wristVelocity)
              : state.hud.wristVelocity,
        },
      };

    case 'UPDATE_ANGLES':
      return {
        ...state,
        hud: { ...state.hud, currentAngles: action.angles },
      };

    case 'SET_POSITION':
      return {
        ...state,
        hud: { ...state.hud, currentPosition: action.position },
        view: action.position
          ? { ...state.view, status: action.position }
          : state.view,
      };

    // ---- View ----
    case 'TOGGLE_CROP':
      return {
        ...state,
        view: { ...state.view, isCropEnabled: !state.view.isCropEnabled },
      };

    case 'SET_CROP_REGION':
      return {
        ...state,
        view: { ...state.view, cropRegion: action.region },
      };

    case 'SET_DISPLAY_MODE':
      return {
        ...state,
        view: { ...state.view, displayMode: action.mode },
      };

    case 'SET_LANDSCAPE':
      return {
        ...state,
        view: { ...state.view, isLandscape: action.isLandscape },
      };

    case 'SET_STATUS':
      return {
        ...state,
        view: { ...state.view, status: action.status },
      };

    // ---- Model ----
    case 'MODEL_LOADED':
      return {
        ...state,
        isModelLoaded: true,
        view: { ...state.view, status: 'Ready' },
      };

    // ---- Navigation ----
    case 'SET_REP_INDEX':
      if (action.index < 0 || action.index >= state.analysis.repCount) {
        return state;
      }
      return {
        ...state,
        currentRepIndex: action.index,
      };

    // ---- Full Reset ----
    case 'RESET_ALL':
      return {
        ...initialAnalyzerState,
        isModelLoaded: state.isModelLoaded, // Preserve model loaded state
      };

    default:
      return state;
  }
}

// ============================================
// Selectors (derived state)
// ============================================

/** Check if video is in a playable state */
export function isVideoReady(state: AnalyzerState): boolean {
  return state.video.type === 'ready' || state.video.type === 'playing';
}

/** Check if video is currently playing */
export function isVideoPlaying(state: AnalyzerState): boolean {
  return state.video.type === 'playing';
}

/** Check if video is loading or extracting */
export function isVideoLoading(state: AnalyzerState): boolean {
  return state.video.type === 'loading' || state.video.type === 'extracting';
}

/** Get current video file if available */
export function getVideoFile(state: AnalyzerState): File | null {
  const { video } = state;
  if (
    video.type === 'extracting' ||
    video.type === 'ready' ||
    video.type === 'playing'
  ) {
    return video.videoFile;
  }
  return null;
}

/** Get loading progress (0-100) if loading */
export function getLoadingProgress(state: AnalyzerState): number | undefined {
  if (state.video.type === 'loading') {
    return state.video.progress;
  }
  if (state.video.type === 'extracting') {
    return state.video.progress.percentage;
  }
  return undefined;
}

/** Get loading message if loading */
export function getLoadingMessage(state: AnalyzerState): string | undefined {
  if (state.video.type === 'loading') {
    return state.video.message;
  }
  if (state.video.type === 'extracting') {
    return 'Extracting poses...';
  }
  return undefined;
}

// ============================================
// Hook
// ============================================

export interface UseAnalyzerStateReturn {
  state: AnalyzerState;
  dispatch: React.Dispatch<AnalyzerAction>;
  // Convenience dispatchers
  actions: {
    startLoading: (message: string) => void;
    setLoadingProgress: (progress: number, message?: string) => void;
    videoLoaded: (videoFile: File) => void;
    startExtraction: (videoFile: File) => void;
    updateExtractionProgress: (progress: ExtractionProgress) => void;
    extractionComplete: () => void;
    play: () => void;
    pause: () => void;
    videoEnded: () => void;
    error: (message: string) => void;
    resetVideo: () => void;
    setRepCount: (count: number) => void;
    addThumbnail: (
      repNum: number,
      position: string,
      candidate: PositionCandidate
    ) => void;
    setRepThumbnails: (
      repNum: number,
      positions: Map<string, PositionCandidate>
    ) => void;
    clearThumbnails: () => void;
    setHasPoses: (hasPoses: boolean) => void;
    updateHud: (
      spineAngle: number,
      armAngle: number,
      wristVelocity?: number
    ) => void;
    updateAngles: (angles: Record<string, number>) => void;
    setPosition: (position: string | null) => void;
    toggleCrop: () => void;
    setCropRegion: (region: CropRegion | null) => void;
    setDisplayMode: (mode: 'both' | 'video' | 'overlay') => void;
    setLandscape: (isLandscape: boolean) => void;
    setStatus: (status: string) => void;
    modelLoaded: () => void;
    setRepIndex: (index: number) => void;
    resetAll: () => void;
  };
  // Selectors
  isVideoReady: boolean;
  isVideoPlaying: boolean;
  isVideoLoading: boolean;
  videoFile: File | null;
  loadingProgress: number | undefined;
  loadingMessage: string | undefined;
}

export function useAnalyzerState(
  initialState?: Partial<AnalyzerState>
): UseAnalyzerStateReturn {
  const [state, dispatch] = useReducer(
    analyzerReducer,
    initialState
      ? { ...initialAnalyzerState, ...initialState }
      : initialAnalyzerState
  );

  // Memoized action creators
  const actions = useMemo(
    () => ({
      startLoading: (message: string) =>
        dispatch({ type: 'START_LOADING', message }),
      setLoadingProgress: (progress: number, message?: string) =>
        dispatch({ type: 'LOADING_PROGRESS', progress, message }),
      videoLoaded: (videoFile: File) =>
        dispatch({ type: 'VIDEO_LOADED', videoFile }),
      startExtraction: (videoFile: File) =>
        dispatch({ type: 'EXTRACTION_START', videoFile }),
      updateExtractionProgress: (progress: ExtractionProgress) =>
        dispatch({ type: 'EXTRACTION_PROGRESS', progress }),
      extractionComplete: () => dispatch({ type: 'EXTRACTION_COMPLETE' }),
      play: () => dispatch({ type: 'PLAY' }),
      pause: () => dispatch({ type: 'PAUSE' }),
      videoEnded: () => dispatch({ type: 'VIDEO_ENDED' }),
      error: (message: string) => dispatch({ type: 'ERROR', message }),
      resetVideo: () => dispatch({ type: 'RESET_VIDEO' }),
      setRepCount: (count: number) =>
        dispatch({ type: 'SET_REP_COUNT', count }),
      addThumbnail: (
        repNum: number,
        position: string,
        candidate: PositionCandidate
      ) => dispatch({ type: 'ADD_THUMBNAIL', repNum, position, candidate }),
      setRepThumbnails: (
        repNum: number,
        positions: Map<string, PositionCandidate>
      ) => dispatch({ type: 'SET_REP_THUMBNAILS', repNum, positions }),
      clearThumbnails: () => dispatch({ type: 'CLEAR_THUMBNAILS' }),
      setHasPoses: (hasPoses: boolean) =>
        dispatch({ type: 'SET_HAS_POSES', hasPoses }),
      updateHud: (
        spineAngle: number,
        armAngle: number,
        wristVelocity?: number
      ) =>
        dispatch({ type: 'UPDATE_HUD', spineAngle, armAngle, wristVelocity }),
      updateAngles: (angles: Record<string, number>) =>
        dispatch({ type: 'UPDATE_ANGLES', angles }),
      setPosition: (position: string | null) =>
        dispatch({ type: 'SET_POSITION', position }),
      toggleCrop: () => dispatch({ type: 'TOGGLE_CROP' }),
      setCropRegion: (region: CropRegion | null) =>
        dispatch({ type: 'SET_CROP_REGION', region }),
      setDisplayMode: (mode: 'both' | 'video' | 'overlay') =>
        dispatch({ type: 'SET_DISPLAY_MODE', mode }),
      setLandscape: (isLandscape: boolean) =>
        dispatch({ type: 'SET_LANDSCAPE', isLandscape }),
      setStatus: (status: string) => dispatch({ type: 'SET_STATUS', status }),
      modelLoaded: () => dispatch({ type: 'MODEL_LOADED' }),
      setRepIndex: (index: number) =>
        dispatch({ type: 'SET_REP_INDEX', index }),
      resetAll: () => dispatch({ type: 'RESET_ALL' }),
    }),
    []
  );

  // Memoized selectors
  const selectors = useMemo(
    () => ({
      isVideoReady: isVideoReady(state),
      isVideoPlaying: isVideoPlaying(state),
      isVideoLoading: isVideoLoading(state),
      videoFile: getVideoFile(state),
      loadingProgress: getLoadingProgress(state),
      loadingMessage: getLoadingMessage(state),
    }),
    [state]
  );

  return {
    state,
    dispatch,
    actions,
    ...selectors,
  };
}
