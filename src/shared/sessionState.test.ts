import { describe, expect, it } from 'vitest'
import { ARENA_PRESET } from './arena'
import { createInitialSessionState, reduceSessionState } from './sessionState'

describe('session state reducer', () => {
  it('arms a tab without losing the current listening settings', () => {
    const initial = createInitialSessionState()
    const armed = reduceSessionState(initial, {
      type: 'ARM_TAB',
      tabId: 12,
      tabTitle: 'Example stream',
    })

    expect(armed.tabId).toBe(12)
    expect(armed.tabTitle).toBe('Example stream')
    expect(armed.listenerPosition).toEqual(ARENA_PRESET.sweetSpot)
    expect(armed.realism).toBe(0)
    expect(armed.energy).toBe(0)
    expect(armed.clarity).toBe(initial.clarity)
  })

  it('clamps positions into the audience area', () => {
    const next = reduceSessionState(createInitialSessionState(), {
      type: 'POSITION',
      position: { x: 1.5, y: -0.4 },
    })

    expect(next.listenerPosition.x).toBe(ARENA_PRESET.audienceBounds.maxX)
    expect(next.listenerPosition.y).toBe(ARENA_PRESET.audienceBounds.minY)
  })

  it('snaps back to sweet spot when requested', () => {
    const moved = reduceSessionState(createInitialSessionState(), {
      type: 'POSITION',
      position: { x: 0.75, y: 0.82 },
    })
    const snapped = reduceSessionState(moved, { type: 'SWEET_SPOT' })

    expect(snapped.listenerPosition).toEqual(ARENA_PRESET.sweetSpot)
  })

  it('enters error phase with a readable message', () => {
    const errored = reduceSessionState(createInitialSessionState(), {
      type: 'ERROR',
      error: 'Capture failed',
    })

    expect(errored.phase).toBe('error')
    expect(errored.errorMessage).toBe('Capture failed')
  })

  it('stores the latest clarity value with the other controls', () => {
    const next = reduceSessionState(createInitialSessionState(), {
      type: 'PARAMS',
      realism: 0.74,
      energy: 0.58,
      clarity: 0.42,
    })

    expect(next.realism).toBe(0.74)
    expect(next.energy).toBe(0.58)
    expect(next.clarity).toBe(0.42)
  })
})
