import {
  DEFAULT_ARENA_ID,
  DEFAULT_ENERGY,
  DEFAULT_REALISM,
  ARENA_PRESET,
  clampToAudience,
  snapToSweetSpot,
} from './arena'
import type { CaptureSessionState, ListenerPosition, SessionPhase } from './types'

export type SessionReducerState = CaptureSessionState

export type SessionReducerAction =
  | { type: 'ARM_TAB'; tabId: number; tabTitle: string }
  | { type: 'SET_PHASE'; phase: SessionPhase }
  | { type: 'POSITION'; position: ListenerPosition }
  | { type: 'PARAMS'; realism: number; energy: number }
  | { type: 'SONG_KEY'; songKey: string | null }
  | { type: 'BPM'; bpm: number | null }
  | { type: 'PITCH_NOTE'; note: string | null }
  | { type: 'SWEET_SPOT' }
  | { type: 'METER'; level: number }
  | { type: 'ERROR'; error: string }
  | { type: 'RESET'; keepTab: boolean }

export function createInitialSessionState(): SessionReducerState {
  return {
    phase: 'idle',
    tabId: null,
    tabTitle: '',
    arenaId: DEFAULT_ARENA_ID,
    listenerPosition: { ...ARENA_PRESET.sweetSpot },
    realism: DEFAULT_REALISM,
    energy: DEFAULT_ENERGY,
    meterLevel: 0,
    currentSongKey: null,
    currentEstimatedBpm: null,
    currentDetectedNote: null,
    errorMessage: null,
  }
}

export function reduceSessionState(
  state: SessionReducerState,
  action: SessionReducerAction,
): SessionReducerState {
  switch (action.type) {
    case 'ARM_TAB':
      return {
        ...state,
        tabId: action.tabId,
        tabTitle: action.tabTitle,
        errorMessage: null,
      }
    case 'SET_PHASE':
      return {
        ...state,
        phase: action.phase,
        errorMessage: action.phase === 'error' ? state.errorMessage : null,
      }
    case 'POSITION':
      return {
        ...state,
        listenerPosition: clampToAudience(action.position, ARENA_PRESET.audienceBounds),
      }
    case 'PARAMS':
      return {
        ...state,
        realism: action.realism,
        energy: action.energy,
      }
    case 'SONG_KEY':
      return {
        ...state,
        currentSongKey: action.songKey,
      }
    case 'BPM':
      return {
        ...state,
        currentEstimatedBpm: action.bpm,
      }
    case 'PITCH_NOTE':
      return {
        ...state,
        currentDetectedNote: action.note,
      }
    case 'SWEET_SPOT':
      return {
        ...state,
        listenerPosition: snapToSweetSpot(state.arenaId),
      }
    case 'METER':
      return {
        ...state,
        meterLevel: action.level,
      }
    case 'ERROR':
      return {
        ...state,
        phase: 'error',
        currentSongKey: null,
        currentEstimatedBpm: null,
        currentDetectedNote: null,
        errorMessage: action.error,
      }
    case 'RESET':
      return {
        ...createInitialSessionState(),
        tabId: action.keepTab ? state.tabId : null,
        tabTitle: action.keepTab ? state.tabTitle : '',
        realism: state.realism,
        energy: state.energy,
        listenerPosition: state.listenerPosition,
      }
    default:
      return state
  }
}
