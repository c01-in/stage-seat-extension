import { deriveAcousticSnapshot } from '../shared/acoustics'
import {
  MESSAGE_TARGET_BACKGROUND,
  MESSAGE_TARGET_OFFSCREEN,
  isTargetedMessage,
  type RuntimeMessage,
} from '../shared/messages'
import type { AcousticSnapshot, CaptureSessionState, DebugLogEntry } from '../shared/types'

const SMOOTH_SECONDS = 0.08
const METER_INTERVAL_MS = 1000 / 24

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

    sourceNode.connect(directLowpass)
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
    masterGain.connect(analyser)
    analyser.connect(this.context.destination)

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
  }

  async stop(reason = 'Stopped') {
    logOffscreen('Stopping audio engine', { reason })
    if (this.meterTimer != null) {
      window.clearInterval(this.meterTimer)
      this.meterTimer = null
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
