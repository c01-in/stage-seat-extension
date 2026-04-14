import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Info } from 'lucide-react'
import { ARENA_PRESET, clampToAudience } from '../shared/arena'
import {
  MESSAGE_TARGET_BACKGROUND,
  MESSAGE_TARGET_SIDEPANEL,
  isTargetedMessage,
  type RuntimeMessage,
} from '../shared/messages'
import { createInitialSessionState } from '../shared/sessionState'
import type { CaptureSessionState, ListenerPosition } from '../shared/types'
import { BipolarSlider } from './components/BipolarSlider'
import { StageSeatVisualizer } from './components/StageSeatVisualizer'

const initialState = createInitialSessionState()

function logSidepanel(message: string, details?: unknown) {
  console.log(`[StageSeat][sidepanel] ${message}`, details ?? '')
}

function useRuntimeSession() {
  const [state, setState] = useState<CaptureSessionState>(initialState)
  const dragSendFrame = useRef<number | null>(null)
  const queuedPosition = useRef<ListenerPosition | null>(null)
  const stateRef = useRef(initialState)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const handleMessage = useEffectEvent((message: RuntimeMessage) => {
    if (!isTargetedMessage(message, MESSAGE_TARGET_SIDEPANEL)) {
      return
    }

    logSidepanel('Incoming runtime message', message)

    if (message.type === 'SESSION_STATUS' && message.state) {
      setState(message.state)
      return
    }

    if (message.type === 'AUDIO_METER_FRAME') {
      setState((current) => ({
        ...current,
        meterLevel: message.level,
      }))
      return
    }

    if (message.type === 'CAPTURE_ERROR') {
      setState((current) => ({
        ...current,
        phase: 'error',
        errorMessage: message.error,
      }))
      return
    }

    if (message.type === 'SESSION_STOP') {
      setState((current) => ({
        ...current,
        phase: 'idle',
        meterLevel: 0,
      }))
    }
  })

  useEffect(() => {
    const listener = (message: RuntimeMessage) => handleMessage(message)
    chrome.runtime.onMessage.addListener(listener)
    logSidepanel('Requesting initial session status')
    void chrome.runtime
      .sendMessage({
        type: 'SESSION_STATUS',
        target: MESSAGE_TARGET_BACKGROUND,
      } satisfies RuntimeMessage)
      .then((response: RuntimeMessage | undefined) => {
        logSidepanel('Initial session status response', response)
        if (response?.type === 'SESSION_STATUS' && response.state) {
          setState(response.state)
        }
      })

    return () => {
      chrome.runtime.onMessage.removeListener(listener)
      if (dragSendFrame.current != null) {
        window.cancelAnimationFrame(dragSendFrame.current)
      }
    }
  }, [])

  const sendPosition = (position: ListenerPosition) => {
    logSidepanel('Queueing position update', position)
    queuedPosition.current = position
    if (dragSendFrame.current != null) {
      return
    }

    dragSendFrame.current = window.requestAnimationFrame(() => {
      dragSendFrame.current = null
      if (!queuedPosition.current) {
        return
      }

      void chrome.runtime.sendMessage({
        type: 'POSITION_UPDATE',
        target: MESSAGE_TARGET_BACKGROUND,
        position: queuedPosition.current,
      } satisfies RuntimeMessage)
      queuedPosition.current = null
    })
  }

  return { state, setState, sendPosition, stateRef }
}

function statusCopy(state: CaptureSessionState) {
  switch (state.phase) {
    case 'starting':
      return 'Binding live audio'
    case 'active':
      return 'Inside the arena'
    case 'stopping':
      return 'Leaving the room'
    case 'error':
      return 'Needs a fresh tab click'
    default:
      return state.tabId ? 'Tab armed' : 'Focus a playable tab'
  }
}

export function StageSeatApp() {
  const arena = useMemo(() => ARENA_PRESET, [])
  const arenaRef = useRef<HTMLDivElement | null>(null)
  const draggingRef = useRef(false)
  const { state, setState, sendPosition, stateRef } = useRuntimeSession()

  const setPositionFromPointer = (clientX: number, clientY: number) => {
    const bounds = arenaRef.current?.getBoundingClientRect()
    if (!bounds) {
      return
    }

    const nextPosition = clampToAudience(
      {
        x: (clientX - bounds.left) / bounds.width,
        y: (clientY - bounds.top) / bounds.height,
      },
      arena.audienceBounds,
    )

    setState((current) => ({
      ...current,
      listenerPosition: nextPosition,
    }))
    sendPosition(nextPosition)
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    logSidepanel('Pointer down on arena surface', {
      x: event.clientX,
      y: event.clientY,
    })
    draggingRef.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    setPositionFromPointer(event.clientX, event.clientY)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) {
      return
    }
    setPositionFromPointer(event.clientX, event.clientY)
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    logSidepanel('Pointer up on arena surface', {
      x: event.clientX,
      y: event.clientY,
    })
    draggingRef.current = false
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const startSession = async () => {
    logSidepanel('Turn On clicked')
    await chrome.runtime.sendMessage({
      type: 'SESSION_START',
      target: MESSAGE_TARGET_BACKGROUND,
    } satisfies RuntimeMessage)
  }

  const stopSession = async () => {
    logSidepanel('Turn Off clicked')
    await chrome.runtime.sendMessage({
      type: 'SESSION_STOP',
      target: MESSAGE_TARGET_BACKGROUND,
      reason: 'Stopped by user',
    } satisfies RuntimeMessage)
  }

  const snapSweetSpot = async () => {
    logSidepanel('Sweet Spot clicked')
    await chrome.runtime.sendMessage({
      type: 'SNAP_TO_SWEET_SPOT',
      target: MESSAGE_TARGET_BACKGROUND,
    } satisfies RuntimeMessage)
  }

  const updateRealism = async (value: number) => {
    logSidepanel('Realism changed', { value })
    setState((current) => ({ ...current, realism: value }))
    await chrome.runtime.sendMessage({
      type: 'PARAMS_UPDATE',
      target: MESSAGE_TARGET_BACKGROUND,
      realism: value,
      energy: stateRef.current.energy,
      clarity: stateRef.current.clarity,
    } satisfies RuntimeMessage)
  }

  const updateEnergy = async (value: number) => {
    logSidepanel('Energy changed', { value })
    setState((current) => ({ ...current, energy: value }))
    await chrome.runtime.sendMessage({
      type: 'PARAMS_UPDATE',
      target: MESSAGE_TARGET_BACKGROUND,
      realism: stateRef.current.realism,
      energy: value,
      clarity: stateRef.current.clarity,
    } satisfies RuntimeMessage)
  }

  const updateClarity = async (value: number) => {
    logSidepanel('Clarity changed', { value })
    setState((current) => ({ ...current, clarity: value }))
    await chrome.runtime.sendMessage({
      type: 'PARAMS_UPDATE',
      target: MESSAGE_TARGET_BACKGROUND,
      realism: stateRef.current.realism,
      energy: stateRef.current.energy,
      clarity: value,
    } satisfies RuntimeMessage)
  }

  return (
    <main className="shell">
      <section className="arena-panel arena-panel-main">
        <div className="arena-topbar">
          <div className="brand-row">
            <span className="eyebrow">StageSeat</span>
            <button
              className="info-button"
              type="button"
              title="Use position to shape sound. Drag yourself across the room and hear the seat change. Front rows stay sharper. Side seats lean and smear. The center holds together."
              aria-label="About StageSeat"
            >
              <Info size={13} strokeWidth={2.2} />
            </button>
          </div>
          <div className="live-controls">
            <div
              className={`status-pill status-${state.phase}`}
              title={state.tabTitle || 'No active tab'}
            >
              {statusCopy(state)}
            </div>
            {state.phase === 'active' || state.phase === 'starting' || state.phase === 'stopping' ? (
              <button
                className="toggle-button toggle-on"
                onClick={stopSession}
                aria-label="Turn processing off"
                title="Turn processing off"
              >
                <span className="toggle-thumb" />
              </button>
            ) : (
              <button
                className="toggle-button"
                onClick={startSession}
                aria-label="Turn processing on"
                title="Turn processing on"
              >
                <span className="toggle-thumb" />
              </button>
            )}
          </div>
        </div>

        {state.errorMessage ? <div className="warning-card">{state.errorMessage}</div> : null}

        <div className="panel-head compact">
          <div>
            <span className="panel-kicker">Venue Map</span>
            <h2>{arena.name}</h2>
          </div>
          <button className="ghost-button" onClick={snapSweetSpot}>
            Sweet Spot
          </button>
        </div>

        <div
          ref={arenaRef}
          className="arena-surface"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <StageSeatVisualizer
            arena={arena}
            listenerPosition={state.listenerPosition}
            level={state.meterLevel}
            active={state.phase === 'active'}
          />
          <div
            className="stage-zone"
            style={{
              left: `${arena.stageRect.x * 100}%`,
              top: `${arena.stageRect.y * 100}%`,
              width: `${arena.stageRect.width * 100}%`,
              height: `${arena.stageRect.height * 100}%`,
            }}
          >
            <div className="stage-stack stage-left" />
            <div className="stage-stack stage-center" />
            <div className="stage-stack stage-right" />
          </div>
          <div
            className="sweet-spot-marker"
            style={{
              left: `${arena.sweetSpot.x * 100}%`,
              top: `${arena.sweetSpot.y * 100}%`,
            }}
          />
          <div
            className="listener-node"
            style={{
              left: `${state.listenerPosition.x * 100}%`,
              top: `${state.listenerPosition.y * 100}%`,
            }}
          >
            <div className="listener-core" />
            <span>Seat</span>
          </div>
          <div className="arena-grid" aria-hidden="true" />
        </div>
      </section>

      <section className="controls-panel">
        <div className="panel-head">
          <h2>Controls</h2>
          <select value={arena.id} disabled className="arena-select" aria-label="Arena">
            <option value={arena.id}>{arena.name}</option>
          </select>
        </div>

        <BipolarSlider label="Realism" value={state.realism} onChange={(value) => void updateRealism(value)} />

        <BipolarSlider label="Energy" value={state.energy} onChange={(value) => void updateEnergy(value)} />

        <BipolarSlider
          label="Clarity (Vocal Focus)"
          value={state.clarity}
          onChange={(value) => void updateClarity(value)}
        />

        <div className="meter-card">
          <div className="control-copy compact">
            <span>Live</span>
          </div>
          <div className="meter-track">
            <div
              className="meter-fill"
              style={{ width: `${Math.max(8, state.meterLevel * 100)}%` }}
            />
          </div>
        </div>
      </section>
    </main>
  )
}
