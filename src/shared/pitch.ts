const NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
const MIN_FREQUENCY_HZ = 70
const MAX_FREQUENCY_HZ = 1400
const MIN_RMS = 0.006
const MIN_CORRELATION = 0.72

export interface PitchEstimate {
  frequency: number
  midi: number
  noteIndex: number
  octave: number
  cents: number
  correlation: number
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function toMidi(frequency: number) {
  return 69 + 12 * Math.log2(frequency / 440)
}

function fromMidi(midi: number) {
  return 440 * 2 ** ((midi - 69) / 12)
}

export function detectPitchFromTimeDomain(
  samples: ArrayLike<number>,
  sampleRate: number,
): PitchEstimate | null {
  const size = samples.length
  if (size < 2) {
    return null
  }

  let rms = 0
  let mean = 0
  for (let index = 0; index < size; index += 1) {
    const sample = samples[index]
    mean += sample
    rms += sample * sample
  }
  mean /= size
  rms = Math.sqrt(rms / size)

  if (rms < MIN_RMS) {
    return null
  }

  const centered = new Float32Array(size)
  for (let index = 0; index < size; index += 1) {
    centered[index] = samples[index] - mean
  }

  const minLag = Math.floor(sampleRate / MAX_FREQUENCY_HZ)
  const maxLag = Math.floor(sampleRate / MIN_FREQUENCY_HZ)
  let bestLag = -1
  let bestCorrelation = 0
  const correlations = new Float32Array(maxLag + 1)

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sumProduct = 0
    let sumLeft = 0
    let sumRight = 0

    for (let index = 0; index < size - lag; index += 1) {
      const left = centered[index]
      const right = centered[index + lag]
      sumProduct += left * right
      sumLeft += left * left
      sumRight += right * right
    }

    const denominator = Math.sqrt(sumLeft * sumRight) + Number.EPSILON
    const correlation = sumProduct / denominator
    correlations[lag] = correlation

    if (correlation > bestCorrelation) {
      bestCorrelation = correlation
      bestLag = lag
    }
  }

  if (bestLag < 0 || bestCorrelation < MIN_CORRELATION) {
    return null
  }

  const previous = correlations[bestLag - 1] ?? correlations[bestLag]
  const current = correlations[bestLag]
  const next = correlations[bestLag + 1] ?? correlations[bestLag]
  const curvature = previous - 2 * current + next
  const offset = Math.abs(curvature) > Number.EPSILON ? clamp((previous - next) / (2 * curvature), -1, 1) : 0
  const refinedLag = bestLag + offset
  const frequency = sampleRate / refinedLag
  const midi = toMidi(frequency)
  const roundedMidi = Math.round(midi)
  const noteIndex = ((roundedMidi % 12) + 12) % 12
  const octave = Math.floor(roundedMidi / 12) - 1
  const cents = Math.round((midi - roundedMidi) * 100)

  return {
    frequency,
    midi,
    noteIndex,
    octave,
    cents,
    correlation: bestCorrelation,
  }
}

export function smoothFrequency(previousHz: number | null, nextHz: number, retention = 0.72) {
  if (!previousHz || !Number.isFinite(previousHz)) {
    return nextHz
  }

  return previousHz * retention + nextHz * (1 - retention)
}

export function formatPitchLabel(estimate: PitchEstimate | null) {
  if (!estimate) {
    return null
  }

  return `${NOTE_NAMES[estimate.noteIndex]}${estimate.octave}`
}

export function formatPitchLabelFromFrequency(frequency: number | null) {
  if (!frequency || !Number.isFinite(frequency)) {
    return null
  }

  const midi = toMidi(frequency)
  const roundedMidi = Math.round(midi)
  const noteIndex = ((roundedMidi % 12) + 12) % 12
  const octave = Math.floor(roundedMidi / 12) - 1
  return `${NOTE_NAMES[noteIndex]}${octave}`
}

export function getCentsOffFromFrequency(frequency: number) {
  const midi = toMidi(frequency)
  const nearestMidi = Math.round(midi)
  const nearestFrequency = fromMidi(nearestMidi)
  return Math.round(1200 * Math.log2(frequency / nearestFrequency))
}
