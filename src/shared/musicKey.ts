const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
const PITCH_CLASS_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
const MIN_FREQUENCY_HZ = 65.41
const MAX_FREQUENCY_HZ = 2093
const MIN_CONFIDENCE = 0.015
const MIN_MODE_CONFIDENCE = 0.02

export interface KeyEstimate {
  tonicIndex: number
  tonicLabel: string
  mode: 'major' | 'minor'
  confidence: number
}

export interface ModeEstimate {
  mode: 'major' | 'minor'
  confidence: number
}

function rotateProfile(profile: readonly number[], tonicIndex: number) {
  return profile.map((_, pitchClass) => profile[(pitchClass - tonicIndex + 12) % 12])
}

function normalize(values: readonly number[]) {
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0)
  if (total <= Number.EPSILON) {
    return null
  }

  return values.map((value) => Math.max(0, value) / total)
}

function scoreProfile(
  chroma: readonly number[],
  profile: readonly number[],
  tonicIndex: number,
) {
  const rotatedProfile = rotateProfile(profile, tonicIndex)
  return chroma.reduce((sum, value, pitchClass) => sum + value * rotatedProfile[pitchClass], 0)
}

export function buildChromaFromSpectrum(
  spectrum: ArrayLike<number>,
  sampleRate: number,
  fftSize: number,
) {
  const chroma = new Array<number>(12).fill(0)
  const binCount = spectrum.length

  for (let bin = 1; bin < binCount; bin += 1) {
    const frequency = (bin * sampleRate) / fftSize
    if (frequency < MIN_FREQUENCY_HZ || frequency > MAX_FREQUENCY_HZ) {
      continue
    }

    const amplitudeDb = spectrum[bin]
    if (!Number.isFinite(amplitudeDb) || amplitudeDb <= -90) {
      continue
    }

    const midi = 69 + 12 * Math.log2(frequency / 440)
    const pitchClass = ((Math.round(midi) % 12) + 12) % 12
    const octave = Math.floor(midi / 12)
    const amplitude = 10 ** (amplitudeDb / 20)
    const weightedAmplitude = amplitude / Math.max(1, octave - 1)
    chroma[pitchClass] += weightedAmplitude
  }

  return chroma
}

export function getPitchClassIndex(label: string) {
  return PITCH_CLASS_NAMES.indexOf(label)
}

export function getPitchClassLabel(index: number) {
  return PITCH_CLASS_NAMES[((index % 12) + 12) % 12]
}

export function getChromaEnergy(chroma: readonly number[]) {
  return chroma.reduce((sum, value) => sum + Math.max(0, value), 0)
}

export function smoothChroma(
  previousChroma: readonly number[] | null,
  nextChroma: readonly number[],
  retention = 0.82,
) {
  if (nextChroma.length !== 12) {
    return null
  }

  if (!previousChroma || previousChroma.length !== 12) {
    return [...nextChroma]
  }

  return nextChroma.map(
    (value, pitchClass) => previousChroma[pitchClass] * retention + Math.max(0, value) * (1 - retention),
  )
}

export function estimateKeyFromChroma(chroma: readonly number[]): KeyEstimate | null {
  if (chroma.length !== 12) {
    return null
  }

  const normalizedChroma = normalize(chroma)
  const normalizedMajor = normalize(MAJOR_PROFILE)
  const normalizedMinor = normalize(MINOR_PROFILE)
  if (!normalizedChroma || !normalizedMajor || !normalizedMinor) {
    return null
  }

  const scores: Array<{ tonicIndex: number; mode: 'major' | 'minor'; score: number }> = []

  for (let tonicIndex = 0; tonicIndex < 12; tonicIndex += 1) {
    const rotatedMajor = rotateProfile(normalizedMajor, tonicIndex)
    const rotatedMinor = rotateProfile(normalizedMinor, tonicIndex)

    scores.push({
      tonicIndex,
      mode: 'major',
      score: normalizedChroma.reduce((sum, value, pitchClass) => sum + value * rotatedMajor[pitchClass], 0),
    })
    scores.push({
      tonicIndex,
      mode: 'minor',
      score: normalizedChroma.reduce((sum, value, pitchClass) => sum + value * rotatedMinor[pitchClass], 0),
    })
  }

  scores.sort((left, right) => right.score - left.score)
  const [best, second] = scores
  if (!best) {
    return null
  }

  const confidence =
    second && best.score > Number.EPSILON ? Math.max(0, (best.score - second.score) / best.score) : 1

  if (confidence < MIN_CONFIDENCE) {
    return null
  }

  return {
    tonicIndex: best.tonicIndex,
    tonicLabel: PITCH_CLASS_NAMES[best.tonicIndex],
    mode: best.mode,
    confidence,
  }
}

export function estimateModeForTonic(
  chroma: readonly number[],
  tonicIndex: number,
): ModeEstimate | null {
  if (chroma.length !== 12) {
    return null
  }

  const normalizedChroma = normalize(chroma)
  const normalizedMajor = normalize(MAJOR_PROFILE)
  const normalizedMinor = normalize(MINOR_PROFILE)
  if (!normalizedChroma || !normalizedMajor || !normalizedMinor) {
    return null
  }

  const majorScore = scoreProfile(normalizedChroma, normalizedMajor, tonicIndex)
  const minorScore = scoreProfile(normalizedChroma, normalizedMinor, tonicIndex)
  const winnerMode = majorScore >= minorScore ? 'major' : 'minor'
  const winnerScore = Math.max(majorScore, minorScore)
  const loserScore = Math.min(majorScore, minorScore)
  const confidence =
    winnerScore > Number.EPSILON ? Math.max(0, (winnerScore - loserScore) / winnerScore) : 0

  if (confidence < MIN_MODE_CONFIDENCE) {
    return null
  }

  return {
    mode: winnerMode,
    confidence,
  }
}

export function formatKeySignatureLabel(estimate: KeyEstimate | null) {
  if (!estimate) {
    return null
  }

  return `${estimate.tonicLabel} ${estimate.mode}`
}

export function formatKeySignatureFromTonic(
  tonicLabel: string | null,
  mode: 'major' | 'minor' | null,
) {
  if (!tonicLabel) {
    return null
  }

  return mode ? `${tonicLabel} ${mode}` : tonicLabel
}
