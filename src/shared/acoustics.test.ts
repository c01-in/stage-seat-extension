import { describe, expect, it } from 'vitest'
import { ARENA_PRESET, clampToAudience, getEdgeFactor, snapToSweetSpot } from './arena'
import { deriveAcousticSnapshot } from './acoustics'

describe('arena acoustics', () => {
  it('sweet spot sits inside the audience bounds', () => {
    const sweetSpot = snapToSweetSpot(ARENA_PRESET.id)
    const clamped = clampToAudience(sweetSpot, ARENA_PRESET.audienceBounds)
    expect(clamped).toEqual(sweetSpot)
  })

  it('rear seats sound wetter and less direct than front seats', () => {
    const front = deriveAcousticSnapshot({ x: 0.5, y: 0.28 }, 0.7, 0.6, 0.24, ARENA_PRESET.id)
    const rear = deriveAcousticSnapshot({ x: 0.5, y: 0.88 }, 0.7, 0.6, 0.24, ARENA_PRESET.id)

    expect(front.directGain).toBeGreaterThan(rear.directGain)
    expect(front.lateGain).toBeLessThan(rear.lateGain)
    expect(front.directLowpassHz).toBeGreaterThan(rear.directLowpassHz)
  })

  it('side seats push the image off-center and raise edge factor', () => {
    const center = deriveAcousticSnapshot({ x: 0.5, y: 0.5 }, 0.7, 0.6, 0.24, ARENA_PRESET.id)
    const leftSide = deriveAcousticSnapshot({ x: 0.12, y: 0.5 }, 0.7, 0.6, 0.24, ARENA_PRESET.id)
    const rightSide = deriveAcousticSnapshot({ x: 0.88, y: 0.5 }, 0.7, 0.6, 0.24, ARENA_PRESET.id)

    expect(Math.abs(center.directPan)).toBeLessThan(Math.abs(leftSide.directPan))
    expect(Math.abs(center.directPan)).toBeLessThan(Math.abs(rightSide.directPan))
    expect(leftSide.directPan).toBeGreaterThan(0)
    expect(leftSide.earlyTilt).toBeGreaterThan(0)
    expect(rightSide.directPan).toBeLessThan(0)
    expect(rightSide.earlyTilt).toBeLessThan(0)
    expect(getEdgeFactor({ x: 0.88, y: 0.5 }, ARENA_PRESET.id)).toBeGreaterThan(
      getEdgeFactor({ x: 0.5, y: 0.5 }, ARENA_PRESET.id),
    )
  })

  it('clarity strengthens direct presence and trims room masking', () => {
    const base = deriveAcousticSnapshot({ x: 0.5, y: 0.42 }, 0.7, 0.6, 0, ARENA_PRESET.id, 1)
    const focused = deriveAcousticSnapshot({ x: 0.5, y: 0.42 }, 0.7, 0.6, 1, ARENA_PRESET.id, 1)

    expect(focused.directPresenceDb).toBeGreaterThan(base.directPresenceDb)
    expect(focused.directLowpassHz).toBeGreaterThan(base.directLowpassHz)
    expect(focused.lateGain).toBeLessThan(base.lateGain)
    expect(focused.lateWidth).toBeLessThan(base.lateWidth)
    expect(focused.earlyGain).toBeLessThan(base.earlyGain)
    expect(focused.subBoostDb).toBeLessThan(base.subBoostDb)
  })

  it('zeroed controls keep energy and clarity at neutral', () => {
    const neutral = deriveAcousticSnapshot({ x: 0.5, y: 0.42 }, 0, 0, 0, ARENA_PRESET.id, 1)
    const energetic = deriveAcousticSnapshot({ x: 0.5, y: 0.42 }, 0, 1, 0, ARENA_PRESET.id, 1)
    const controlled = deriveAcousticSnapshot({ x: 0.5, y: 0.42 }, 0, -1, 0, ARENA_PRESET.id, 1)

    expect(energetic.subBoostDb).toBeGreaterThan(neutral.subBoostDb)
    expect(controlled.subBoostDb).toBeLessThan(neutral.subBoostDb)
    expect(energetic.lateWidth).toBeGreaterThan(neutral.lateWidth)
    expect(controlled.lateWidth).toBeLessThan(neutral.lateWidth)
  })

  it('clarity stays beneficial in the rear while being strongest near the stage', () => {
    const nearBase = deriveAcousticSnapshot({ x: 0.5, y: 0.3 }, 0.7, 0.6, 0, ARENA_PRESET.id, 1)
    const nearFocused = deriveAcousticSnapshot({ x: 0.5, y: 0.3 }, 0.7, 0.6, 1, ARENA_PRESET.id, 1)
    const rearBase = deriveAcousticSnapshot({ x: 0.5, y: 0.82 }, 0.7, 0.6, 0, ARENA_PRESET.id, 1)
    const rearFocused = deriveAcousticSnapshot({ x: 0.5, y: 0.82 }, 0.7, 0.6, 1, ARENA_PRESET.id, 1)

    expect(rearFocused.directPresenceDb).toBeGreaterThan(rearBase.directPresenceDb)
    expect(rearFocused.directLowpassHz).toBeGreaterThan(rearBase.directLowpassHz)
    expect(nearFocused.directPresenceDb - nearBase.directPresenceDb).toBeGreaterThan(
      rearFocused.directPresenceDb - rearBase.directPresenceDb,
    )
  })

  it('clarity hits harder when vocals are present than when they are absent', () => {
    const base = deriveAcousticSnapshot({ x: 0.5, y: 0.42 }, 0.7, 0.6, 0, ARENA_PRESET.id, 0)
    const instrumental = deriveAcousticSnapshot({ x: 0.5, y: 0.42 }, 0.7, 0.6, 1, ARENA_PRESET.id, 0)
    const vocal = deriveAcousticSnapshot({ x: 0.5, y: 0.42 }, 0.7, 0.6, 1, ARENA_PRESET.id, 1)

    expect(vocal.directPresenceDb - base.directPresenceDb).toBeGreaterThan(
      instrumental.directPresenceDb - base.directPresenceDb,
    )
    expect(base.lateGain - vocal.lateGain).toBeGreaterThan(base.lateGain - instrumental.lateGain)
  })
})
