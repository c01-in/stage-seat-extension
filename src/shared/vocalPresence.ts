function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value))
}

function getBandAverage(
  spectrum: Float32Array,
  sampleRate: number,
  fftSize: number,
  minFrequencyHz: number,
  maxFrequencyHz: number,
) {
  let total = 0
  let count = 0

  for (let bin = 1; bin < spectrum.length; bin += 1) {
    const frequency = (bin * sampleRate) / fftSize
    if (frequency < minFrequencyHz || frequency > maxFrequencyHz) {
      continue
    }

    const normalized = clamp((spectrum[bin] + 100) / 100)
    total += normalized
    count += 1
  }

  return count > 0 ? total / count : 0
}

export function estimateVocalPresenceFromSpectrum(
  spectrum: Float32Array,
  sampleRate: number,
  fftSize: number,
) {
  const sub = getBandAverage(spectrum, sampleRate, fftSize, 40, 120)
  const body = getBandAverage(spectrum, sampleRate, fftSize, 120, 350)
  const vocalCore = getBandAverage(spectrum, sampleRate, fftSize, 350, 1200)
  const presence = getBandAverage(spectrum, sampleRate, fftSize, 1200, 4200)
  const air = getBandAverage(spectrum, sampleRate, fftSize, 5200, 11000)

  const vocalContour = clamp((vocalCore * 0.58 + presence * 0.42 - sub * 0.36 - air * 0.12 + 0.12) / 0.72)
  const bodySupport = clamp((body * 0.52 + vocalCore * 0.48 - sub * 0.3 + 0.08) / 0.64)
  const presenceShape = clamp((presence - air * 0.74 + 0.12) / 0.56)

  return clamp(vocalContour * 0.46 + bodySupport * 0.26 + presenceShape * 0.28)
}
