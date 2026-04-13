import type { CaptureSessionState, DebugLogEntry, ListenerPosition } from './types'

export const MESSAGE_TARGET_BACKGROUND = 'background'
export const MESSAGE_TARGET_OFFSCREEN = 'offscreen'
export const MESSAGE_TARGET_SIDEPANEL = 'sidepanel'

export type RuntimeMessage =
  | {
      type: 'SESSION_START'
      target: 'background' | 'offscreen'
      streamId?: string
      tabId?: number
      tabTitle?: string
      state?: CaptureSessionState
    }
  | {
      type: 'SESSION_STOP'
      target: 'background' | 'offscreen' | 'sidepanel'
      reason?: string
      state?: CaptureSessionState
    }
  | {
      type: 'SESSION_STATUS'
      target: 'background' | 'sidepanel'
      state?: CaptureSessionState
      logs?: DebugLogEntry[]
    }
  | {
      type: 'POSITION_UPDATE'
      target: 'background' | 'offscreen'
      position: ListenerPosition
      arenaId?: string
      realism?: number
      energy?: number
    }
  | {
      type: 'PARAMS_UPDATE'
      target: 'background' | 'offscreen'
      realism: number
      energy: number
      arenaId?: string
    }
  | {
      type: 'SNAP_TO_SWEET_SPOT'
      target: 'background'
    }
  | {
      type: 'AUDIO_METER_FRAME'
      target: 'background' | 'sidepanel'
      level: number
    }
  | {
      type: 'CAPTURE_ERROR'
      target: 'background' | 'sidepanel'
      error: string
      recoverable?: boolean
      state?: CaptureSessionState
    }
  | {
      type: 'DEBUG_LOG'
      target: 'background' | 'sidepanel'
      entry: DebugLogEntry
    }

export function isTargetedMessage(
  message: unknown,
  target: RuntimeMessage['target'],
): message is RuntimeMessage {
  return Boolean(
    message &&
      typeof message === 'object' &&
      'type' in message &&
      'target' in message &&
      (message as RuntimeMessage).target === target,
  )
}
