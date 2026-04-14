import { deriveAcousticSnapshot } from '../shared/acoustics'
import { DEBUG_MODE } from '../shared/debug'
import {
  MESSAGE_TARGET_BACKGROUND,
  MESSAGE_TARGET_OFFSCREEN,
  isTargetedMessage,
  type RuntimeMessage,
} from '../shared/messages'
import {
  buildChromaFromSpectrum,
  estimateModeForTonic,
  formatKeySignatureFromTonic,
  getChromaEnergy,
  getPitchClassIndex,
  smoothChroma,
} from '../shared/musicKey'
import {
  detectPitchFromTimeDomain,
  formatPitchLabelFromFrequency,
  smoothFrequency,
} from '../shared/pitch'
import type { AcousticSnapshot, CaptureSessionState, DebugLogEntry } from '../shared/types'

const SMOOTH_SECONDS = 0.08
const METER_INTERVAL_MS = 1000 / 24
const PITCH_DETECTION_INTERVAL_MS = 140
const PITCH_NULL_REPORT_THRESHOLD = 8
const BPM_DETECTION_INTERVAL_MS = 100
const SONG_KEY_DETECTION_INTERVAL_MS = 1200
const SONG_KEY_NULL_REPORT_THRESHOLD = 10
const MIN_SONG_KEY_CHROMA_ENERGY = 0.004
const SONG_KEY_NOTE_WINDOW_MS = 16000
const MIN_SONG_KEY_NOTE_SAMPLES = 8
const DEFAULT_NOTE_WINDOW_MS = 3600
const MIN_NOTE_WINDOW_MS = 2200
const MAX_NOTE_WINDOW_MS = 6200
const ASSUMED_BEATS_PER_BAR = 4
const ASSUMED_BARS_PER_WINDOW = 2
const BPM_MIN = 60
const BPM_MAX = 180
const BPM_HISTORY_MS = 18000
const BPM_REPORT_DELTA = 2

function toDetails(value: unknown) {
  if (value == null) {
    return undefined
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function logOffscreen(message: string, details?: unknown) {
  const entry: DebugLogEntry = {
    scope: 'offscreen',
    timestamp: new Date().toISOString(),
    message,
    details: toDetails(details),
  }

  console.log(`[StageSeat][offscreen] ${entry.message}`, entry.details ?? '')
  void chrome.runtime.sendMessage({
    type: 'DEBUG_LOG',
    target: MESSAGE_TARGET_BACKGROUND,
    entry,
  } satisfies RuntimeMessage)
}

function setSmoothValue(audioParam: AudioParam, value: number, now: number) {
  audioParam.cancelScheduledValues(now)
  audioParam.setTargetAtTime(value, now, SMOOTH_SECONDS)
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function normalizeBpm(rawBpm: number) {
  let bpm = rawBpm
  while (bpm < BPM_MIN) {
    bpm *= 2
  }
  while (bpm > BPM_MAX) {
    bpm /= 2
  }
  return bpm
}

function estimateTempoFromFluxHistory(fluxHistory: readonly { timestamp: number; value: number }[]) {
  if (fluxHistory.length < 32) {
    return null
  }

  const values = fluxHistory.map((entry) => entry.value)
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const centered = values.map((value) => Math.max(0, value - mean * 0.92))
  const stepMs = Math.max(
    1,
    fluxHistory[fluxHistory.length - 1].timestamp - fluxHistory[fluxHistory.length - 2].timestamp,
  )

  const minLag = Math.round(60_000 / (BPM_MAX * stepMs))
  const maxLag = Math.round(60_000 / (BPM_MIN * stepMs))
  let bestLag = -1
  let bestScore = 0

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let score = 0
    for (let index = lag; index < centered.length; index += 1) {
      score += centered[index] * centered[index - lag]
    }

    const bpm = 60_000 / (lag * stepMs)
    const slowPreference = bpm <= 110 ? 1.08 : 1
    score *= slowPreference

    if (score > bestScore) {
      bestScore = score
      bestLag = lag
    }
  }

  if (bestLag < 0) {
    return null
  }

  const bpm = normalizeBpm(60_000 / (bestLag * stepMs))
  const halfBpm = bpm / 2
  if (halfBpm >= BPM_MIN) {
    const halfLag = Math.round(60_000 / (halfBpm * stepMs))
    let halfScore = 0
    for (let index = halfLag; index < centered.length; index += 1) {
      halfScore += centered[index] * centered[index - halfLag]
    }
    if (bpm >= 116 && halfScore >= bestScore * 0.76) {
      return Math.round(halfBpm)
    }
  }

  return Math.round(bpm)
}

function computeSpectralFlux(
  previousSpectrum: Float32Array | null,
  currentSpectrum: Float32Array,
  sampleRate: number,
  fftSize: number,
) {
  let flux = 0
  const minFrequencyHz = 40
  const maxFrequencyHz = 2500

  for (let bin = 1; bin < currentSpectrum.length; bin += 1) {
    const frequency = (bin * sampleRate) / fftSize
    if (frequency < minFrequencyHz || frequency > maxFrequencyHz) {
      continue
    }

    const currentMagnitude = Math.max(0, (currentSpectrum[bin] + 100) / 100)
    const previousMagnitude =
      previousSpectrum != null ? Math.max(0, (previousSpectrum[bin] + 100) / 100) : 0
    const delta = currentMagnitude - previousMagnitude
    if (delta > 0) {
      flux += delta
    }
  }

  return flux
}

function createImpulseBuffer(
  context: AudioContext,
  decaySeconds: number,
  toneHz: number,
  width: number,
) {
  const length = Math.max(context.sampleRate * decaySeconds, 1)
  const impulse = context.createBuffer(2, length, context.sampleRate)
  const brightness = Math.max(0.12, Math.min(toneHz, context.sampleRate * 0.45) / (context.sampleRate * 0.5))

  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const data = impulse.getChannelData(channel)
    for (let index = 0; index < length; index += 1) {
      const t = index / length
      const decay = (1 - t) ** (1.8 + decaySeconds * 0.38)
      const noise = Math.random() * 2 - 1
      const stereoSkew = channel === 0 ? 1 : -1
      const stereoVariance = (Math.random() * 2 - 1) * width * 0.22 * stereoSkew
      data[index] = noise * decay * brightness + stereoVariance * decay * 0.38
    }
  }

  return impulse
}

class ArenaAudioEngine {
  private context: AudioContext | null = null
  private mediaStream: MediaStream | null = null
  private meterTimer: number | null = null
  private pitchTimer: number | null = null
  private bpmTimer: number | null = null
  private songKeyTimer: number | null = null

  private directGain: GainNode | null = null
  private directPanner: StereoPannerNode | null = null
  private directLowpass: BiquadFilterNode | null = null
  private directPresence: BiquadFilterNode | null = null
  private earlyBusGain: GainNode | null = null
  private earlyLeftDelay: DelayNode | null = null
  private earlyRightDelay: DelayNode | null = null
  private earlyLeftGain: GainNode | null = null
  private earlyRightGain: GainNode | null = null
  private earlyLeftPanner: StereoPannerNode | null = null
  private earlyRightPanner: StereoPannerNode | null = null
  private earlyTone: BiquadFilterNode | null = null
  private latePreDelay: DelayNode | null = null
  private lateTone: BiquadFilterNode | null = null
  private lateConvolver: ConvolverNode | null = null
  private lateGain: GainNode | null = null
  private lowShelf: BiquadFilterNode | null = null
  private masterGain: GainNode | null = null
  private analyser: AnalyserNode | null = null
  private songKeyAnalyser: AnalyserNode | null = null
  private pitchHighpass: BiquadFilterNode | null = null
  private pitchLowpass: BiquadFilterNode | null = null
  private pitchAnalyser: AnalyserNode | null = null
  private lastReportedSongKey: string | null = null
  private pendingSongKey: string | null = null
  private pendingSongKeyFrames = 0
  private smoothedChroma: number[] | null = null
  private songKeySampleCount = 0
  private nullSongKeyFrames = 0
  private lastReportedNote: string | null = null
  private pendingNote: string | null = null
  private pendingNoteFrames = 0
  private pitchSampleCount = 0
  private nullPitchFrames = 0
  private smoothedPitchHz: number | null = null
  private noteHistory: Array<{ timestamp: number; note: string }> = []
  private spectralFluxHistory: Array<{ timestamp: number; value: number }> = []
  private previousBpmSpectrum: Float32Array | null = null
  private estimatedBpm: number | null = null
  private lastReportedBpm: number | null = null

  async start(streamId: string, state: CaptureSessionState) {
    await this.stop('restart')
    logOffscreen('Starting audio engine', {
      tabId: state.tabId,
      streamIdPresent: Boolean(streamId),
      position: state.listenerPosition,
      realism: state.realism,
      energy: state.energy,
    })

    this.context = new AudioContext({ latencyHint: 'interactive' })
    const media = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      } as MediaTrackConstraints,
      video: false,
    })
    this.mediaStream = media
    logOffscreen('Media stream acquired', {
      trackCount: media.getTracks().length,
      sampleRate: this.context.sampleRate,
    })

    const sourceNode = this.context.createMediaStreamSource(media)
    const directLowpass = this.context.createBiquadFilter()
    directLowpass.type = 'lowpass'
    const directPresence = this.context.createBiquadFilter()
    directPresence.type = 'peaking'
    directPresence.frequency.value = 2800
    directPresence.Q.value = 0.9
    const directPanner = this.context.createStereoPanner()
    const directGain = this.context.createGain()

    const earlyTone = this.context.createBiquadFilter()
    earlyTone.type = 'lowpass'
    const earlyLeftDelay = this.context.createDelay(0.2)
    const earlyRightDelay = this.context.createDelay(0.2)
    const earlyLeftPanner = this.context.createStereoPanner()
    const earlyRightPanner = this.context.createStereoPanner()
    const earlyLeftGain = this.context.createGain()
    const earlyRightGain = this.context.createGain()
    const earlyBusGain = this.context.createGain()

    const latePreDelay = this.context.createDelay(0.3)
    const lateTone = this.context.createBiquadFilter()
    lateTone.type = 'lowpass'
    const lateConvolver = this.context.createConvolver()
    const lateGain = this.context.createGain()

    const lowShelf = this.context.createBiquadFilter()
    lowShelf.type = 'lowshelf'
    lowShelf.frequency.value = 120
    const compressor = this.context.createDynamicsCompressor()
    compressor.threshold.value = -16
    compressor.knee.value = 18
    compressor.ratio.value = 2.4
    compressor.attack.value = 0.008
    compressor.release.value = 0.26
    const masterGain = this.context.createGain()
    const analyser = this.context.createAnalyser()
    analyser.fftSize = 1024
    const songKeyAnalyser = DEBUG_MODE ? this.context.createAnalyser() : null
    if (songKeyAnalyser) {
      songKeyAnalyser.fftSize = 4096
      songKeyAnalyser.smoothingTimeConstant = 0.88
      songKeyAnalyser.minDecibels = -100
      songKeyAnalyser.maxDecibels = -12
    }
    const pitchHighpass = DEBUG_MODE ? this.context.createBiquadFilter() : null
    if (pitchHighpass) {
      pitchHighpass.type = 'highpass'
      pitchHighpass.frequency.value = 140
      pitchHighpass.Q.value = 0.8
    }
    const pitchLowpass = DEBUG_MODE ? this.context.createBiquadFilter() : null
    if (pitchLowpass) {
      pitchLowpass.type = 'lowpass'
      pitchLowpass.frequency.value = 1200
      pitchLowpass.Q.value = 0.7
    }
    const pitchAnalyser = DEBUG_MODE ? this.context.createAnalyser() : null
    if (pitchAnalyser) {
      pitchAnalyser.fftSize = 4096
      pitchAnalyser.smoothingTimeConstant = 0.12
    }

    sourceNode.connect(directLowpass)
    if (songKeyAnalyser) {
      sourceNode.connect(songKeyAnalyser)
    }
    if (pitchHighpass && pitchLowpass && pitchAnalyser) {
      sourceNode.connect(pitchHighpass)
      pitchHighpass.connect(pitchLowpass)
      pitchLowpass.connect(pitchAnalyser)
    }
    directLowpass.connect(directPresence)
    directPresence.connect(directPanner)
    directPanner.connect(directGain)
    directGain.connect(lowShelf)

    sourceNode.connect(earlyTone)
    earlyTone.connect(earlyLeftDelay)
    earlyTone.connect(earlyRightDelay)
    earlyLeftDelay.connect(earlyLeftPanner)
    earlyRightDelay.connect(earlyRightPanner)
    earlyLeftPanner.connect(earlyLeftGain)
    earlyRightPanner.connect(earlyRightGain)
    earlyLeftGain.connect(earlyBusGain)
    earlyRightGain.connect(earlyBusGain)
    earlyBusGain.connect(lowShelf)

    sourceNode.connect(latePreDelay)
    latePreDelay.connect(lateTone)
    lateTone.connect(lateConvolver)
    lateConvolver.connect(lateGain)
    lateGain.connect(lowShelf)

    lowShelf.connect(compressor)
    compressor.connect(masterGain)
    masterGain.connect(this.context.destination)
    masterGain.connect(analyser)

    this.directGain = directGain
    this.directPanner = directPanner
    this.directLowpass = directLowpass
    this.directPresence = directPresence
    this.earlyBusGain = earlyBusGain
    this.earlyLeftDelay = earlyLeftDelay
    this.earlyRightDelay = earlyRightDelay
    this.earlyLeftGain = earlyLeftGain
    this.earlyRightGain = earlyRightGain
    this.earlyLeftPanner = earlyLeftPanner
    this.earlyRightPanner = earlyRightPanner
    this.earlyTone = earlyTone
    this.latePreDelay = latePreDelay
    this.lateTone = lateTone
    this.lateConvolver = lateConvolver
    this.lateGain = lateGain
    this.lowShelf = lowShelf
    this.masterGain = masterGain
    this.analyser = analyser
    this.songKeyAnalyser = songKeyAnalyser
    this.pitchHighpass = pitchHighpass
    this.pitchLowpass = pitchLowpass
    this.pitchAnalyser = pitchAnalyser
    this.lastReportedSongKey = state.currentSongKey
    this.pendingSongKey = null
    this.pendingSongKeyFrames = 0
    this.smoothedChroma = null
    this.songKeySampleCount = 0
    this.nullSongKeyFrames = 0
    this.lastReportedNote = state.currentDetectedNote
    this.pendingNote = null
    this.pendingNoteFrames = 0
    this.pitchSampleCount = 0
    this.nullPitchFrames = 0
    this.smoothedPitchHz = null
    this.noteHistory = []
    this.spectralFluxHistory = []
    this.previousBpmSpectrum = null
    this.estimatedBpm = null
    this.lastReportedBpm = null

    media.getAudioTracks().forEach((track) => {
      track.addEventListener('ended', () => {
        logOffscreen('Captured track ended unexpectedly')
        void this.stop('Track ended')
        void chrome.runtime.sendMessage({
          type: 'CAPTURE_ERROR',
          target: MESSAGE_TARGET_BACKGROUND,
          error: 'The page stopped exposing audio for capture.',
        } satisfies RuntimeMessage)
      })
    })

    await this.context.resume()
    logOffscreen('Audio context resumed', { state: this.context.state })
    this.applyState(state, true)
    this.startMeterLoop()
    this.startBpmDetectionLoop()
    this.startSongKeyDetectionLoop()
    this.startPitchDetectionLoop()
  }

  async stop(reason = 'Stopped') {
    logOffscreen('Stopping audio engine', { reason })
    if (this.meterTimer != null) {
      window.clearInterval(this.meterTimer)
      this.meterTimer = null
    }
    if (this.pitchTimer != null) {
      window.clearInterval(this.pitchTimer)
      this.pitchTimer = null
    }
    if (this.bpmTimer != null) {
      window.clearInterval(this.bpmTimer)
      this.bpmTimer = null
    }
    if (this.songKeyTimer != null) {
      window.clearInterval(this.songKeyTimer)
      this.songKeyTimer = null
    }

    this.mediaStream?.getTracks().forEach((track) => track.stop())
    this.mediaStream = null

    if (this.context) {
      await this.context.close().catch(() => undefined)
    }

    this.context = null
    this.directGain = null
    this.directPanner = null
    this.directLowpass = null
    this.directPresence = null
    this.earlyBusGain = null
    this.earlyLeftDelay = null
    this.earlyRightDelay = null
    this.earlyLeftGain = null
    this.earlyRightGain = null
    this.earlyLeftPanner = null
    this.earlyRightPanner = null
    this.earlyTone = null
    this.latePreDelay = null
    this.lateTone = null
    this.lateConvolver = null
    this.lateGain = null
    this.lowShelf = null
    this.masterGain = null
    this.analyser = null
    this.songKeyAnalyser = null
    this.pitchHighpass = null
    this.pitchLowpass = null
    this.pitchAnalyser = null
    this.lastReportedSongKey = null
    this.pendingSongKey = null
    this.pendingSongKeyFrames = 0
    this.smoothedChroma = null
    this.songKeySampleCount = 0
    this.nullSongKeyFrames = 0
    this.lastReportedNote = null
    this.pendingNote = null
    this.pendingNoteFrames = 0
    this.pitchSampleCount = 0
    this.nullPitchFrames = 0
    this.smoothedPitchHz = null
    this.noteHistory = []
    this.spectralFluxHistory = []
    this.previousBpmSpectrum = null
    this.estimatedBpm = null
    this.lastReportedBpm = null
  }

  updateState(state: CaptureSessionState) {
    logOffscreen('Applying updated acoustic state', {
      phase: state.phase,
      position: state.listenerPosition,
      realism: state.realism,
      energy: state.energy,
    })
    this.applyState(state)
  }

  private startMeterLoop() {
    if (!this.analyser) {
      return
    }

    const data = new Uint8Array(this.analyser.fftSize)
    this.meterTimer = window.setInterval(() => {
      if (!this.analyser) {
        return
      }

      this.analyser.getByteTimeDomainData(data)
      let total = 0
      for (let index = 0; index < data.length; index += 1) {
        const centered = data[index] / 128 - 1
        total += centered * centered
      }
      const level = Math.min(1, Math.sqrt(total / data.length) * 2.6)
      void chrome.runtime.sendMessage({
        type: 'AUDIO_METER_FRAME',
        target: MESSAGE_TARGET_BACKGROUND,
        level,
      } satisfies RuntimeMessage)
    }, METER_INTERVAL_MS)
  }

  private startSongKeyDetectionLoop() {
    if (!DEBUG_MODE || !this.songKeyAnalyser || !this.context) {
      return
    }

    logOffscreen('Song key detector enabled', {
      intervalMs: SONG_KEY_DETECTION_INTERVAL_MS,
      fftSize: this.songKeyAnalyser.fftSize,
    })

    const spectrum = new Float32Array(this.songKeyAnalyser.frequencyBinCount)
    this.songKeyTimer = window.setInterval(() => {
      if (!this.songKeyAnalyser || !this.context) {
        return
      }

      const now = Date.now()
      this.songKeySampleCount += 1
      this.songKeyAnalyser.getFloatFrequencyData(spectrum)
      const chroma = buildChromaFromSpectrum(
        spectrum,
        this.context.sampleRate,
        this.songKeyAnalyser.fftSize,
      )
      this.smoothedChroma = smoothChroma(this.smoothedChroma, chroma, 0.78)
      const tonicLabel = this.getDominantSongTonic(now)
      const tonicIndex = tonicLabel != null ? getPitchClassIndex(tonicLabel) : -1
      const modeEstimate =
        tonicIndex >= 0 && this.smoothedChroma && getChromaEnergy(this.smoothedChroma) >= MIN_SONG_KEY_CHROMA_ENERGY
          ? estimateModeForTonic(this.smoothedChroma, tonicIndex)
          : null
      const nextSongKey = formatKeySignatureFromTonic(tonicLabel, modeEstimate?.mode ?? null)

      if (this.songKeySampleCount <= 3 || this.songKeySampleCount % 5 === 0) {
        logOffscreen('Song key detector sample', {
          sampleCount: this.songKeySampleCount,
          tonic: tonicLabel,
          chromaEnergy: this.smoothedChroma ? Number(getChromaEnergy(this.smoothedChroma).toFixed(6)) : 0,
          songKey: nextSongKey,
          confidence: modeEstimate ? Number(modeEstimate.confidence.toFixed(4)) : null,
        })
      }

      this.maybeReportSongKey(nextSongKey)
    }, SONG_KEY_DETECTION_INTERVAL_MS)
  }

  private startBpmDetectionLoop() {
    if (!DEBUG_MODE || !this.songKeyAnalyser || !this.context) {
      return
    }

    logOffscreen('Bpm detector enabled', {
      intervalMs: BPM_DETECTION_INTERVAL_MS,
      fftSize: this.songKeyAnalyser.fftSize,
    })

    const spectrum = new Float32Array(this.songKeyAnalyser.frequencyBinCount)
    this.bpmTimer = window.setInterval(() => {
      if (!this.songKeyAnalyser || !this.context) {
        return
      }

      const now = Date.now()
      this.songKeyAnalyser.getFloatFrequencyData(spectrum)
      const flux = computeSpectralFlux(
        this.previousBpmSpectrum,
        spectrum,
        this.context.sampleRate,
        this.songKeyAnalyser.fftSize,
      )
      this.previousBpmSpectrum = new Float32Array(spectrum)
      this.spectralFluxHistory = [
        ...this.spectralFluxHistory.filter((entry) => now - entry.timestamp <= BPM_HISTORY_MS),
        { timestamp: now, value: flux },
      ]

      const estimatedTempo = estimateTempoFromFluxHistory(this.spectralFluxHistory)
      if (estimatedTempo != null) {
        this.estimatedBpm = estimatedTempo
        this.maybeReportBpm()
      }
    }, BPM_DETECTION_INTERVAL_MS)
  }

  private startPitchDetectionLoop() {
    if (!DEBUG_MODE || !this.pitchAnalyser || !this.context) {
      return
    }

    logOffscreen('Pitch detector enabled', {
      intervalMs: PITCH_DETECTION_INTERVAL_MS,
      fftSize: this.pitchAnalyser.fftSize,
      filterHz: {
        highpass: this.pitchHighpass?.frequency.value ?? null,
        lowpass: this.pitchLowpass?.frequency.value ?? null,
      },
    })

    const samples = new Float32Array(this.pitchAnalyser.fftSize)
    this.pitchTimer = window.setInterval(() => {
      if (!this.pitchAnalyser || !this.context) {
        return
      }

      this.pitchSampleCount += 1
      this.pitchAnalyser.getFloatTimeDomainData(samples)
      const now = Date.now()
      const estimate = detectPitchFromTimeDomain(samples, this.context.sampleRate)
      if (estimate) {
        this.smoothedPitchHz = smoothFrequency(this.smoothedPitchHz, estimate.frequency, 0.42)
      } else {
        this.smoothedPitchHz = null
      }
      const detectedNote = formatPitchLabelFromFrequency(this.smoothedPitchHz)
      if (detectedNote) {
        this.noteHistory.push({ timestamp: now, note: detectedNote })
      }
      this.pruneNoteHistory(now)
      const nextNote = this.getDominantRecentNote(now)

      if (this.pitchSampleCount <= 4 || this.pitchSampleCount % 10 === 0) {
        logOffscreen('Pitch detector sample', {
          sampleCount: this.pitchSampleCount,
          frequencyHz: this.smoothedPitchHz ? Number(this.smoothedPitchHz.toFixed(2)) : null,
          detectedNote,
          dominantNote: nextNote,
          correlation: estimate ? Number(estimate.correlation.toFixed(4)) : null,
          bpm: this.estimatedBpm ? Math.round(this.estimatedBpm) : null,
          windowMs: this.getNoteWindowMs(),
        })
      }

      this.maybeReportDetectedNote(nextNote)
    }, PITCH_DETECTION_INTERVAL_MS)
  }

  private maybeReportBpm() {
    const roundedBpm = this.estimatedBpm ? Math.round(this.estimatedBpm) : null
    if (roundedBpm === this.lastReportedBpm) {
      return
    }

    if (
      roundedBpm != null &&
      this.lastReportedBpm != null &&
      Math.abs(roundedBpm - this.lastReportedBpm) < BPM_REPORT_DELTA
    ) {
      return
    }

    this.lastReportedBpm = roundedBpm

    if (latestState) {
      latestState = {
        ...latestState,
        currentEstimatedBpm: roundedBpm,
      }
    }

    logOffscreen('Estimated bpm', { bpm: roundedBpm })
    void chrome.runtime.sendMessage({
      type: 'BPM_UPDATE',
      target: MESSAGE_TARGET_BACKGROUND,
      bpm: roundedBpm,
    } satisfies RuntimeMessage)
  }

  private getNoteWindowMs() {
    if (!this.estimatedBpm) {
      return DEFAULT_NOTE_WINDOW_MS
    }

    const beatsPerWindow = ASSUMED_BEATS_PER_BAR * ASSUMED_BARS_PER_WINDOW
    const ms = (60_000 / this.estimatedBpm) * beatsPerWindow
    return clamp(ms, MIN_NOTE_WINDOW_MS, MAX_NOTE_WINDOW_MS)
  }

  private pruneNoteHistory(now: number) {
    const maxAgeMs = Math.max(MAX_NOTE_WINDOW_MS, DEFAULT_NOTE_WINDOW_MS) + 1200
    this.noteHistory = this.noteHistory.filter((entry) => now - entry.timestamp <= maxAgeMs)
  }

  private getDominantRecentNote(now: number) {
    const windowMs = this.getNoteWindowMs()
    const recentEntries = this.noteHistory.filter((entry) => now - entry.timestamp <= windowMs)
    if (recentEntries.length === 0) {
      return null
    }

    const counts = new Map<string, number>()
    for (const entry of recentEntries) {
      counts.set(entry.note, (counts.get(entry.note) ?? 0) + 1)
    }

    let bestNote: string | null = null
    let bestCount = 0
    for (const entry of [...recentEntries].reverse()) {
      const count = counts.get(entry.note) ?? 0
      if (count > bestCount) {
        bestNote = entry.note
        bestCount = count
      }
    }

    if (!bestNote) {
      return null
    }

    const confidence = bestCount / recentEntries.length
    return confidence >= 0.28 || recentEntries.length <= 3 ? bestNote : null
  }

  private getDominantSongTonic(now: number) {
    const recentEntries = this.noteHistory.filter((entry) => now - entry.timestamp <= SONG_KEY_NOTE_WINDOW_MS)
    if (recentEntries.length < MIN_SONG_KEY_NOTE_SAMPLES) {
      return null
    }

    const counts = new Map<string, number>()
    for (const entry of recentEntries) {
      const tonicLabel = entry.note.replace(/-?\d+$/, '')
      counts.set(tonicLabel, (counts.get(tonicLabel) ?? 0) + 1)
    }

    let bestLabel: string | null = null
    let bestCount = 0
    for (const entry of [...recentEntries].reverse()) {
      const tonicLabel = entry.note.replace(/-?\d+$/, '')
      const count = counts.get(tonicLabel) ?? 0
      if (count > bestCount) {
        bestLabel = tonicLabel
        bestCount = count
      }
    }

    if (!bestLabel) {
      return null
    }

    const confidence = bestCount / recentEntries.length
    return confidence >= 0.18 ? bestLabel : null
  }

  private maybeReportSongKey(nextSongKey: string | null) {
    if (nextSongKey == null && this.lastReportedSongKey) {
      this.nullSongKeyFrames += 1
      if (this.nullSongKeyFrames < SONG_KEY_NULL_REPORT_THRESHOLD) {
        if (this.songKeySampleCount <= 3 || this.songKeySampleCount % 5 === 0) {
          logOffscreen('Song key detector holding previous key', {
            previousSongKey: this.lastReportedSongKey,
            nullFrames: this.nullSongKeyFrames,
          })
        }
        return
      }
    } else {
      this.nullSongKeyFrames = 0
    }

    if (nextSongKey === this.lastReportedSongKey) {
      this.pendingSongKey = null
      this.pendingSongKeyFrames = 0
      return
    }

    if (nextSongKey === this.pendingSongKey) {
      this.pendingSongKeyFrames += 1
    } else {
      this.pendingSongKey = nextSongKey
      this.pendingSongKeyFrames = 1
    }

    const threshold = nextSongKey == null ? 3 : 2
    if (this.pendingSongKeyFrames < threshold) {
      return
    }

    this.lastReportedSongKey = nextSongKey
    this.pendingSongKey = null
    this.pendingSongKeyFrames = 0

    if (latestState) {
      latestState = {
        ...latestState,
        currentSongKey: nextSongKey,
      }
    }

    logOffscreen('Detected song key', { songKey: nextSongKey })
    void chrome.runtime.sendMessage({
      type: 'SONG_KEY_UPDATE',
      target: MESSAGE_TARGET_BACKGROUND,
      songKey: nextSongKey,
    } satisfies RuntimeMessage)
  }

  private maybeReportDetectedNote(nextNote: string | null) {
    if (nextNote == null && this.lastReportedNote) {
      this.nullPitchFrames += 1
      if (this.nullPitchFrames < PITCH_NULL_REPORT_THRESHOLD) {
        if (this.pitchSampleCount <= 4 || this.pitchSampleCount % 10 === 0) {
          logOffscreen('Pitch detector holding previous note', {
            previousNote: this.lastReportedNote,
            nullFrames: this.nullPitchFrames,
          })
        }
        return
      }
    } else {
      this.nullPitchFrames = 0
    }

    if (nextNote === this.lastReportedNote) {
      this.pendingNote = null
      this.pendingNoteFrames = 0
      return
    }

    if (nextNote === this.pendingNote) {
      this.pendingNoteFrames += 1
    } else {
      this.pendingNote = nextNote
      this.pendingNoteFrames = 1
    }

    const threshold = nextNote == null ? 3 : 1
    if (this.pendingNoteFrames < threshold) {
      return
    }

    this.lastReportedNote = nextNote
    this.pendingNote = null
    this.pendingNoteFrames = 0

    if (latestState) {
      latestState = {
        ...latestState,
        currentDetectedNote: nextNote,
      }
    }

    logOffscreen('Detected note', { note: nextNote })
    void chrome.runtime.sendMessage({
      type: 'PITCH_NOTE_UPDATE',
      target: MESSAGE_TARGET_BACKGROUND,
      note: nextNote,
    } satisfies RuntimeMessage)
  }

  private applyState(state: CaptureSessionState, forceImpulse = false) {
    if (!this.context) {
      return
    }

    const snapshot = deriveAcousticSnapshot(
      state.listenerPosition,
      state.realism,
      state.energy,
      state.arenaId,
    )
    this.applySnapshot(snapshot, forceImpulse)
  }

  private applySnapshot(snapshot: AcousticSnapshot, forceImpulse = false) {
    if (
      !this.context ||
      !this.directGain ||
      !this.directPanner ||
      !this.directLowpass ||
      !this.directPresence ||
      !this.earlyBusGain ||
      !this.earlyLeftDelay ||
      !this.earlyRightDelay ||
      !this.earlyLeftGain ||
      !this.earlyRightGain ||
      !this.earlyLeftPanner ||
      !this.earlyRightPanner ||
      !this.earlyTone ||
      !this.latePreDelay ||
      !this.lateTone ||
      !this.lateConvolver ||
      !this.lateGain ||
      !this.lowShelf ||
      !this.masterGain
    ) {
      return
    }

    const now = this.context.currentTime
    setSmoothValue(this.directGain.gain, snapshot.directGain, now)
    setSmoothValue(this.directPanner.pan, snapshot.directPan, now)
    setSmoothValue(this.directLowpass.frequency, snapshot.directLowpassHz, now)
    setSmoothValue(this.directPresence.gain, snapshot.directPresenceDb, now)
    setSmoothValue(this.earlyBusGain.gain, snapshot.earlyGain, now)
    setSmoothValue(this.earlyLeftDelay.delayTime, snapshot.earlyDelayMs / 1000, now)
    setSmoothValue(this.earlyRightDelay.delayTime, (snapshot.earlyDelayMs + 0.006) / 1000, now)
    setSmoothValue(this.earlyLeftGain.gain, 0.58 + snapshot.earlyTilt * -0.18, now)
    setSmoothValue(this.earlyRightGain.gain, 0.58 + snapshot.earlyTilt * 0.18, now)
    setSmoothValue(this.earlyLeftPanner.pan, Math.max(-1, -snapshot.earlySpread + snapshot.earlyTilt * 0.3), now)
    setSmoothValue(this.earlyRightPanner.pan, Math.min(1, snapshot.earlySpread + snapshot.earlyTilt * 0.3), now)
    setSmoothValue(this.earlyTone.frequency, snapshot.directLowpassHz * 0.72, now)
    setSmoothValue(this.latePreDelay.delayTime, snapshot.latePreDelayMs / 1000, now)
    setSmoothValue(this.lateTone.frequency, snapshot.lateToneHz, now)
    setSmoothValue(this.lateGain.gain, snapshot.lateGain, now)
    setSmoothValue(this.lowShelf.gain, snapshot.subBoostDb, now)
    setSmoothValue(this.masterGain.gain, snapshot.outputGain, now)

    if (forceImpulse || Math.random() > 0.55) {
      this.lateConvolver.buffer = createImpulseBuffer(
        this.context,
        snapshot.lateDecaySeconds,
        snapshot.lateToneHz,
        snapshot.lateWidth,
      )
      logOffscreen('Refreshed reverb impulse', {
        lateDecaySeconds: snapshot.lateDecaySeconds,
        lateToneHz: snapshot.lateToneHz,
        lateWidth: snapshot.lateWidth,
      })
    }
  }
}

const engine = new ArenaAudioEngine()
let latestState: CaptureSessionState | null = null

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  ;(async () => {
    if (!isTargetedMessage(message, MESSAGE_TARGET_OFFSCREEN)) {
      return
    }

    if (message.type === 'SESSION_START' && message.streamId && message.state) {
      logOffscreen('Received SESSION_START', {
        tabId: message.state.tabId,
        phase: message.state.phase,
      })
      latestState = {
        ...message.state,
        phase: 'active',
        currentSongKey: null,
        currentEstimatedBpm: null,
        currentDetectedNote: null,
        errorMessage: null,
      }
      try {
        await engine.start(message.streamId, latestState)
        await chrome.runtime.sendMessage({
          type: 'SESSION_STATUS',
          target: MESSAGE_TARGET_BACKGROUND,
          state: latestState,
        } satisfies RuntimeMessage)
      } catch (error) {
        logOffscreen('Failed to start audio engine', {
          error: error instanceof Error ? error.message : String(error),
        })
        await chrome.runtime.sendMessage({
          type: 'CAPTURE_ERROR',
          target: MESSAGE_TARGET_BACKGROUND,
          error: error instanceof Error ? error.message : 'Audio engine could not start for this tab.',
        } satisfies RuntimeMessage)
      }
      sendResponse({ ok: true })
      return
    }

    if (message.type === 'SESSION_STOP') {
      logOffscreen('Received SESSION_STOP', { reason: message.reason ?? 'Stopped' })
      latestState = null
      await engine.stop(message.reason ?? 'Stopped')
      sendResponse({ ok: true })
      return
    }

    if ((message.type === 'POSITION_UPDATE' || message.type === 'PARAMS_UPDATE') && latestState) {
      logOffscreen(`Received ${message.type}`, message)
      latestState = {
        ...latestState,
        listenerPosition:
          message.type === 'POSITION_UPDATE' ? message.position : latestState.listenerPosition,
        realism: message.type === 'PARAMS_UPDATE' ? message.realism : message.realism ?? latestState.realism,
        energy: message.type === 'PARAMS_UPDATE' ? message.energy : message.energy ?? latestState.energy,
        arenaId: message.arenaId ?? latestState.arenaId,
      }
      engine.updateState(latestState)
      sendResponse({ ok: true })
      return
    }
  })()

  return true
})
