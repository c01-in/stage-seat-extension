import {
  DEFAULT_ARENA_ID,
  DEFAULT_CLARITY,
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
  | { type: 'PARAMS'; realism: number; energy: number; clarity: number }
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
    clarity: DEFAULT_CLARITY,
    meterLevel: 0,
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
        clarity: action.clarity,
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
        errorMessage: action.error,
      }
    case 'RESET':
      return {
        ...createInitialSessionState(),
        tabId: action.keepTab ? state.tabId : null,
        tabTitle: action.keepTab ? state.tabTitle : '',
        realism: state.realism,
        energy: state.energy,
        clarity: state.clarity,
        listenerPosition: state.listenerPosition,
      }
    default:
      return state
  }
}
