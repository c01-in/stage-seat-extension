export type SessionPhase = 'idle' | 'starting' | 'active' | 'error' | 'stopping'

export interface ListenerPosition {
  x: number
  y: number
}

export interface StageRect {
  x: number
  y: number
  width: number
  height: number
}

export interface AudienceBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export interface ArenaAcousticProfile {
  widthBias: number
  depthBias: number
  clarityBias: number
  envelopmentBias: number
}

export interface ArenaPreset {
  id: string
  name: string
  stageRect: StageRect
  audienceBounds: AudienceBounds
  sweetSpot: ListenerPosition
  acousticProfile: ArenaAcousticProfile
}

export interface CaptureSessionState {
  phase: SessionPhase
  tabId: number | null
  tabTitle: string
  arenaId: string
  listenerPosition: ListenerPosition
  realism: number
  energy: number
  meterLevel: number
  currentSongKey: string | null
  currentEstimatedBpm: number | null
  currentDetectedNote: string | null
  errorMessage: string | null
}

export interface DebugLogEntry {
  scope: 'background' | 'offscreen' | 'sidepanel'
  timestamp: string
  message: string
  details?: string
}

export interface AcousticSnapshot {
  directGain: number
  directPan: number
  directLowpassHz: number
  directPresenceDb: number
  earlyGain: number
  earlyDelayMs: number
  earlySpread: number
  earlyTilt: number
  lateGain: number
  latePreDelayMs: number
  lateToneHz: number
  lateDecaySeconds: number
  lateWidth: number
  subBoostDb: number
  outputGain: number
}
