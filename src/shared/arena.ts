import type { ArenaPreset, AudienceBounds, ListenerPosition } from './types'

export const ARENA_PRESET: ArenaPreset = {
  id: 'arena-midnight',
  name: 'Midnight Arena',
  stageRect: {
    x: 0.22,
    y: 0.06,
    width: 0.56,
    height: 0.11,
  },
  audienceBounds: {
    minX: 0.1,
    maxX: 0.9,
    minY: 0.24,
    maxY: 0.92,
  },
  sweetSpot: {
    x: 0.5,
    y: 0.39,
  },
  acousticProfile: {
    widthBias: 0.16,
    depthBias: 0.08,
    clarityBias: 0.12,
    envelopmentBias: 0.18,
  },
}

export const ARENA_PRESETS = [ARENA_PRESET]
export const DEFAULT_ARENA_ID = ARENA_PRESET.id
export const DEFAULT_REALISM = 0.68
export const DEFAULT_ENERGY = 0.62

export function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value))
}

export function getArenaById(arenaId: string) {
  return ARENA_PRESETS.find((arena) => arena.id === arenaId) ?? ARENA_PRESET
}

export function clampToAudience(position: ListenerPosition, bounds: AudienceBounds) {
  return {
    x: clamp(position.x, bounds.minX, bounds.maxX),
    y: clamp(position.y, bounds.minY, bounds.maxY),
  }
}

export function snapToSweetSpot(arenaId: string) {
  const arena = getArenaById(arenaId)
  return { ...arena.sweetSpot }
}

export function getDepth(position: ListenerPosition, arenaId: string) {
  const arena = getArenaById(arenaId)
  const { minY, maxY } = arena.audienceBounds
  return clamp((position.y - minY) / (maxY - minY))
}

export function getLateral(position: ListenerPosition, arenaId: string) {
  const arena = getArenaById(arenaId)
  const center = (arena.audienceBounds.minX + arena.audienceBounds.maxX) / 2
  const halfWidth = (arena.audienceBounds.maxX - arena.audienceBounds.minX) / 2
  return clamp((position.x - center) / halfWidth, -1, 1)
}

export function getEdgeFactor(position: ListenerPosition, arenaId: string) {
  const lateral = Math.abs(getLateral(position, arenaId))
  const depth = getDepth(position, arenaId)
  return clamp(lateral * 0.78 + depth * 0.22)
}
