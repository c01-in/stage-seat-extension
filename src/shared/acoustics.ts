import { clamp, getArenaById, getDepth, getEdgeFactor, getLateral } from './arena'
import type { AcousticSnapshot, ListenerPosition } from './types'

function lerp(start: number, end: number, amount: number) {
  return start + (end - start) * amount
}

function clampSigned(value: number) {
  return Math.max(-1, Math.min(1, value))
}

function blendSigned(negative: number, neutral: number, positive: number, amount: number) {
  const signed = clampSigned(amount)
  return signed >= 0 ? lerp(neutral, positive, signed) : lerp(neutral, negative, -signed)
}

function offsetSigned(negative: number, positive: number, amount: number) {
  const signed = clampSigned(amount)
  return signed >= 0 ? lerp(0, positive, signed) : lerp(0, negative, -signed)
}

export function deriveAcousticSnapshot(
  position: ListenerPosition,
  realism: number,
  energy: number,
  clarity: number,
  arenaId: string,
  vocalPresence = 1,
): AcousticSnapshot {
  const arena = getArenaById(arenaId)
  const depth = getDepth(position, arenaId)
  const frontness = 1 - depth
  const lateral = getLateral(position, arenaId)
  const stageOffset = -lateral
  const edgeFactor = getEdgeFactor(position, arenaId)
  const realismSigned = clampSigned(realism)
  const energySigned = clampSigned(energy)
  const claritySigned = clampSigned(clarity)
  const vocalWeight = clamp(vocalPresence)
  const realismPresence = Math.max(0, realismSigned)
  const realismTightness = Math.max(0, -realismSigned)
  const energyControl = Math.max(0, -energySigned)
  const clarityFocus = Math.max(0, claritySigned) * (0.34 + vocalWeight * 0.66) * (1 + arena.acousticProfile.clarityBias * 1.2)
  const claritySoften = Math.max(0, -claritySigned) * (0.58 + (1 - vocalWeight) * 0.18)
  const clarityNearAccent = clarityFocus * (0.44 + frontness * 0.56)
  const clarityDistanceRecovery = clarityFocus * (0.3 + depth * 0.34 + vocalWeight * 0.16)
  const clarityRoomTrim = clarityFocus * (0.26 + vocalWeight * 0.34)
  const centerFocus = 1 - Math.abs(lateral)
  const widthBias = arena.acousticProfile.widthBias
  const depthBias = arena.acousticProfile.depthBias
  const basePanWidth = 0.18 + edgeFactor * 0.32 + widthBias * 0.15

  const directGain =
    lerp(0.98, 0.44, depth + depthBias * 0.35) *
    lerp(1, 0.82, edgeFactor) *
    blendSigned(1.06, 1, 0.96, realismSigned) *
    blendSigned(0.88, 1, 1.16, clarityNearAccent - claritySoften * 0.72)

  const directPan =
    stageOffset *
    basePanWidth *
    blendSigned(0.74, 1, 1.34, energySigned)

  const directLowpassHz = lerp(
    17200,
    4300,
    clamp(depth * 0.76 + edgeFactor * 0.24 - frontness * 0.08),
  ) *
    blendSigned(
      0.82,
      1,
      1.38,
      clarityDistanceRecovery + frontness * clarityFocus * 0.28 - claritySoften * 0.82 + realismTightness * 0.1,
    )

  const directPresenceDb =
    lerp(3.2, -5.6, clamp(depth * 0.82 + edgeFactor * 0.22)) +
    offsetSigned(
      -(2.4 + (1 - vocalWeight) * 1.2),
      7.6 + vocalWeight * 1.8 + arena.acousticProfile.clarityBias * 3,
      clarityNearAccent + vocalWeight * 0.14 - claritySoften,
    ) +
    offsetSigned(1.2, -1.1, realismSigned)

  const earlyGain =
    lerp(0.2, 0.62, depth * 0.9 + realismPresence * 0.12) *
    lerp(0.88, 1.16, edgeFactor) *
    lerp(0.96, 1.08, widthBias) *
    blendSigned(1.12, 1, 0.82, clarityRoomTrim - claritySoften * 0.44) *
    blendSigned(0.72, 1, 1.18, realismSigned)

  const earlyDelayMs = lerp(14, 58, clamp(depth * 0.88 + Math.abs(lateral) * 0.18))
  const earlySpread = clamp(
    (0.42 + Math.abs(lateral) * 0.4 + widthBias) *
      blendSigned(0.78, 1, 1.2, energySigned) *
      blendSigned(1.1, 1, 0.82, clarityFocus * (0.34 + vocalWeight * 0.2) - claritySoften * 0.4),
  )
  const earlyTilt = clamp(stageOffset * (0.28 + edgeFactor * 0.54), -1, 1)

  const lateGain =
    lerp(0.18, 0.78, clamp(depth * 0.86 + realismPresence * 0.16 + arena.acousticProfile.envelopmentBias)) *
    lerp(0.96, 1.12, edgeFactor) *
    blendSigned(1.18, 1, 0.66, clarityRoomTrim + frontness * clarityFocus * 0.2 - claritySoften * 0.52) *
    blendSigned(0.62, 1, 1.36, realismSigned)

  const latePreDelayMs = lerp(22, 78, clamp(depth * 0.82 + realismPresence * 0.24))
  const lateToneHz =
    lerp(9200, 3400, clamp(depth * 0.74 + edgeFactor * 0.26)) *
    blendSigned(0.86, 1, 1.16, clarityDistanceRecovery * 0.84 - claritySoften * 0.4)
  const lateDecaySeconds = lerp(
    1.9,
    5,
    clamp(realismPresence * 0.72 + depth * 0.32 + arena.acousticProfile.envelopmentBias * 0.3),
  ) *
    blendSigned(0.64, 1, 1.3, realismSigned) *
    blendSigned(1.1, 1, 0.86, clarityRoomTrim + vocalWeight * clarityFocus * 0.1 - claritySoften * 0.44)
  const lateWidth = clamp(
    (0.52 + realismPresence * 0.16 + widthBias) *
      blendSigned(0.72, 1, 1.32, energySigned) *
      blendSigned(1.14, 1, 0.76, clarityFocus * (0.34 + vocalWeight * 0.24) - claritySoften * 0.4),
  )

  const subBoostDb = offsetSigned(-3.4, 7.2, energySigned) - offsetSigned(-0.4, 1.6, clarityFocus * 0.74 - claritySoften * 0.36)
  const outputGain =
    lerp(0.96, 0.78, depth * 0.4) *
    lerp(1, 0.9, edgeFactor * 0.4) *
    lerp(0.95, 1.08, centerFocus * 0.28) *
    blendSigned(0.94, 1, 1.08, clarityNearAccent * 0.86 - energyControl * 0.08) *
    blendSigned(1.04, 1, 0.96, realismSigned)

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
