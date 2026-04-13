import { clamp, getArenaById, getDepth, getEdgeFactor, getLateral } from './arena'
import type { AcousticSnapshot, ListenerPosition } from './types'

function lerp(start: number, end: number, amount: number) {
  return start + (end - start) * amount
}

export function deriveAcousticSnapshot(
  position: ListenerPosition,
  realism: number,
  energy: number,
  arenaId: string,
): AcousticSnapshot {
  const arena = getArenaById(arenaId)
  const depth = getDepth(position, arenaId)
  const frontness = 1 - depth
  const lateral = getLateral(position, arenaId)
  const edgeFactor = getEdgeFactor(position, arenaId)
  const realismMix = clamp(realism)
  const energyMix = clamp(energy)
  const centerFocus = 1 - Math.abs(lateral)
  const widthBias = arena.acousticProfile.widthBias
  const depthBias = arena.acousticProfile.depthBias

  const directGain =
    lerp(0.98, 0.44, depth + depthBias * 0.35) *
    lerp(1, 0.82, edgeFactor) *
    lerp(0.9, 1.02, realismMix)

  const directPan =
    lateral * (0.18 + edgeFactor * 0.32 + energyMix * 0.08 + widthBias * 0.15)

  const directLowpassHz = lerp(
    17200,
    4300,
    clamp(depth * 0.76 + edgeFactor * 0.24 - frontness * 0.08),
  )

  const directPresenceDb = lerp(3.2, -5.6, clamp(depth * 0.82 + edgeFactor * 0.22))

  const earlyGain =
    lerp(0.2, 0.62, depth * 0.9 + realismMix * 0.1) *
    lerp(0.88, 1.16, edgeFactor) *
    lerp(0.96, 1.08, widthBias)

  const earlyDelayMs = lerp(14, 58, clamp(depth * 0.88 + Math.abs(lateral) * 0.18))
  const earlySpread = clamp(0.42 + Math.abs(lateral) * 0.4 + energyMix * 0.12 + widthBias)
  const earlyTilt = clamp(lateral * (0.28 + edgeFactor * 0.54), -1, 1)

  const lateGain =
    lerp(0.18, 0.78, clamp(depth * 0.86 + realismMix * 0.12 + arena.acousticProfile.envelopmentBias)) *
    lerp(0.96, 1.12, edgeFactor)

  const latePreDelayMs = lerp(22, 78, clamp(depth * 0.82 + realismMix * 0.22))
  const lateToneHz = lerp(9200, 3400, clamp(depth * 0.74 + edgeFactor * 0.26))
  const lateDecaySeconds = lerp(
    1.9,
    5,
    clamp(realismMix * 0.62 + depth * 0.32 + arena.acousticProfile.envelopmentBias * 0.3),
  )
  const lateWidth = clamp(0.52 + energyMix * 0.24 + realismMix * 0.14 + widthBias)

  const subBoostDb = lerp(0.4, 6.8, energyMix)
  const outputGain =
    lerp(0.96, 0.78, depth * 0.4) *
    lerp(1, 0.9, edgeFactor * 0.4) *
    lerp(0.95, 1.08, centerFocus * 0.28)

  return {
    directGain,
    directPan,
    directLowpassHz,
    directPresenceDb,
    earlyGain,
    earlyDelayMs,
    earlySpread,
    earlyTilt,
    lateGain,
    latePreDelayMs,
    lateToneHz,
    lateDecaySeconds,
    lateWidth,
    subBoostDb,
    outputGain,
  }
}
