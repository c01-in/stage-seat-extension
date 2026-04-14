import { describe, expect, it } from 'vitest'
import {
  buildChromaFromSpectrum,
  estimateModeForTonic,
  estimateKeyFromChroma,
  formatKeySignatureFromTonic,
  formatKeySignatureLabel,
  getPitchClassIndex,
  getChromaEnergy,
  smoothChroma,
} from './musicKey'

describe('music key detection', () => {
  it('detects a C major center from a C-E-G weighted chroma', () => {
    const estimate = estimateKeyFromChroma([1, 0, 0, 0, 0.82, 0, 0, 0.76, 0, 0, 0, 0])

    expect(formatKeySignatureLabel(estimate)).toBe('C major')
  })

  it('detects an A minor center from an A-C-E weighted chroma', () => {
    const estimate = estimateKeyFromChroma([0.72, 0, 0, 0, 0.65, 0, 0, 0, 0, 1, 0, 0])

    expect(formatKeySignatureLabel(estimate)).toBe('A minor')
  })

  it('derives a mode for a fixed tonic', () => {
    const modeEstimate = estimateModeForTonic(
      [1, 0, 0, 0, 0.78, 0, 0, 0.7, 0, 0, 0, 0],
      getPitchClassIndex('C'),
    )

    expect(formatKeySignatureFromTonic('C', modeEstimate?.mode ?? null)).toBe('C major')
  })

  it('returns null when there is no tonal evidence', () => {
    expect(estimateKeyFromChroma(new Array(12).fill(0))).toBeNull()
  })

  it('maps spectral peaks into pitch classes', () => {
    const spectrum = new Float32Array(4096 / 2).fill(-120)
    spectrum[24] = -12
    spectrum[31] = -8
    const chroma = buildChromaFromSpectrum(spectrum, 44_100, 4096)

    expect(chroma[0]).toBeGreaterThan(0)
    expect(chroma[4]).toBeGreaterThan(0)
  })

  it('smooths chroma over time for stabler key estimates', () => {
    const first = [1, 0, 0, 0, 0.5, 0, 0, 0.25, 0, 0, 0, 0]
    const second = [0.6, 0, 0, 0, 1, 0, 0, 0.8, 0, 0, 0, 0]
    const smoothed = smoothChroma(first, second, 0.5)

    expect(smoothed).toEqual([0.8, 0, 0, 0, 0.75, 0, 0, 0.525, 0, 0, 0, 0])
    expect(getChromaEnergy(smoothed ?? [])).toBeGreaterThan(0)
  })
})
