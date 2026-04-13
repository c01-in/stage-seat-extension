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
    const front = deriveAcousticSnapshot({ x: 0.5, y: 0.28 }, 0.7, 0.6, ARENA_PRESET.id)
    const rear = deriveAcousticSnapshot({ x: 0.5, y: 0.88 }, 0.7, 0.6, ARENA_PRESET.id)

    expect(front.directGain).toBeGreaterThan(rear.directGain)
    expect(front.lateGain).toBeLessThan(rear.lateGain)
    expect(front.directLowpassHz).toBeGreaterThan(rear.directLowpassHz)
  })

  it('side seats push the image off-center and raise edge factor', () => {
    const center = deriveAcousticSnapshot({ x: 0.5, y: 0.5 }, 0.7, 0.6, ARENA_PRESET.id)
    const side = deriveAcousticSnapshot({ x: 0.88, y: 0.5 }, 0.7, 0.6, ARENA_PRESET.id)

    expect(Math.abs(center.directPan)).toBeLessThan(Math.abs(side.directPan))
    expect(getEdgeFactor({ x: 0.88, y: 0.5 }, ARENA_PRESET.id)).toBeGreaterThan(
      getEdgeFactor({ x: 0.5, y: 0.5 }, ARENA_PRESET.id),
    )
  })
})
