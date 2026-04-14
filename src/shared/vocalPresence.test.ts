import { describe, expect, it } from 'vitest'
import { estimateVocalPresenceFromSpectrum } from './vocalPresence'

function fillBand(
  spectrum: Float32Array,
  sampleRate: number,
  fftSize: number,
  minFrequencyHz: number,
  maxFrequencyHz: number,
  value: number,
) {
  for (let bin = 1; bin < spectrum.length; bin += 1) {
    const frequency = (bin * sampleRate) / fftSize
    if (frequency >= minFrequencyHz && frequency <= maxFrequencyHz) {
      spectrum[bin] = value
    }
  }
}

describe('vocal presence estimator', () => {
  it('scores a vocal-shaped spectrum higher than an instrumental-heavy one', () => {
    const fftSize = 2048
    const sampleRate = 44_100

    const vocalLike = new Float32Array(fftSize / 2).fill(-96)
    fillBand(vocalLike, sampleRate, fftSize, 120, 350, -52)
    fillBand(vocalLike, sampleRate, fftSize, 350, 1200, -28)
    fillBand(vocalLike, sampleRate, fftSize, 1200, 4200, -34)
    fillBand(vocalLike, sampleRate, fftSize, 5200, 11000, -72)

    const instrumentalLike = new Float32Array(fftSize / 2).fill(-96)
    fillBand(instrumentalLike, sampleRate, fftSize, 40, 120, -30)
    fillBand(instrumentalLike, sampleRate, fftSize, 120, 350, -48)
    fillBand(instrumentalLike, sampleRate, fftSize, 350, 1200, -62)
    fillBand(instrumentalLike, sampleRate, fftSize, 1200, 4200, -68)
    fillBand(instrumentalLike, sampleRate, fftSize, 5200, 11000, -42)

    const vocalPresence = estimateVocalPresenceFromSpectrum(vocalLike, sampleRate, fftSize)
    const instrumentalPresence = estimateVocalPresenceFromSpectrum(
      instrumentalLike,
      sampleRate,
      fftSize,
    )

    expect(vocalPresence).toBeGreaterThan(instrumentalPresence)
    expect(vocalPresence).toBeGreaterThan(0.45)
    expect(instrumentalPresence).toBeLessThan(0.5)
  })
})
