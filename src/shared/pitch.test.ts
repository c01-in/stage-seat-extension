import { describe, expect, it } from 'vitest'
import {
  detectPitchFromTimeDomain,
  formatPitchLabel,
  formatPitchLabelFromFrequency,
  smoothFrequency,
} from './pitch'

function makeSineWave(frequency: number, sampleRate: number, size: number) {
  const samples = new Float32Array(size)
  for (let index = 0; index < size; index += 1) {
    samples[index] = Math.sin((2 * Math.PI * frequency * index) / sampleRate)
  }
  return samples
}

describe('pitch detection', () => {
  it('detects A4 from a clean sine wave', () => {
    const samples = makeSineWave(440, 48_000, 4096)
    const estimate = detectPitchFromTimeDomain(samples, 48_000)

    expect(formatPitchLabel(estimate)).toBe('A4')
  })

  it('formats pitch labels from frequency', () => {
    expect(formatPitchLabelFromFrequency(311.13)).toBe('Eb4')
  })

  it('smooths nearby frequencies', () => {
    expect(smoothFrequency(440, 450, 0.5)).toBe(445)
  })
})
