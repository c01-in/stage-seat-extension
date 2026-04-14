import { ARENA_PRESET } from '../shared/arena'
import {
  MESSAGE_TARGET_BACKGROUND,
  MESSAGE_TARGET_OFFSCREEN,
  MESSAGE_TARGET_SIDEPANEL,
  isTargetedMessage,
  type RuntimeMessage,
} from '../shared/messages'
import {
  createInitialSessionState,
  reduceSessionState,
  type SessionReducerState,
} from '../shared/sessionState'
import type { DebugLogEntry } from '../shared/types'

const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html'
const SETTINGS_KEY = 'arena_listener_settings_v1'

let sessionState: SessionReducerState = createInitialSessionState()
let creatingOffscreen: Promise<void> | null = null
let debugEntries: DebugLogEntry[] = []

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

function pushDebug(entry: DebugLogEntry) {
  debugEntries = [...debugEntries.slice(-59), entry]
  console.log(`[StageSeat][${entry.scope}] ${entry.message}`, entry.details ?? '')
  broadcast({
    type: 'DEBUG_LOG',
    target: MESSAGE_TARGET_SIDEPANEL,
    entry,
  })
}

function logBackground(message: string, details?: unknown) {
  pushDebug({
    scope: 'background',
    timestamp: new Date().toISOString(),
    message,
    details: toDetails(details),
  })
}

function broadcast(message: RuntimeMessage) {
  chrome.runtime.sendMessage(message).catch(() => {
    // The side panel might not be open yet.
  })
}

function emitStatus() {
  broadcast({
    type: 'SESSION_STATUS',
    target: MESSAGE_TARGET_SIDEPANEL,
    state: sessionState,
  })
}

async function sendToOffscreen(message: RuntimeMessage) {
  try {
    await chrome.runtime.sendMessage(message)
  } catch {
    // Ignore when the offscreen document is not live yet.
  }
}

async function persistSettings() {
  logBackground('Persisting listener settings', {
    arenaId: sessionState.arenaId,
    position: sessionState.listenerPosition,
    realism: sessionState.realism,
    energy: sessionState.energy,
  })
  await chrome.storage.local.set({
    [SETTINGS_KEY]: {
      arenaId: sessionState.arenaId,
      listenerPosition: sessionState.listenerPosition,
      realism: sessionState.realism,
      energy: sessionState.energy,
    },
  })
}

async function getCurrentActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  })
  logBackground('Resolved active tab', {
    tabId: tab?.id ?? null,
    title: tab?.title ?? null,
    url: tab?.url ?? null,
  })
  return tab ?? null
}

async function armTab(tab: chrome.tabs.Tab) {
  if (tab.id == null) {
    return false
  }

  sessionState = reduceSessionState(sessionState, {
    type: 'ARM_TAB',
    tabId: tab.id,
    tabTitle: tab.title ?? tab.url ?? 'Current tab',
  })
  logBackground('Armed tab for session', {
    tabId: tab.id,
    title: tab.title ?? tab.url ?? 'Current tab',
  })
  emitStatus()
  await enablePanelForTab(tab)
  return true
}

async function ensureActiveTabArmed() {
  if (sessionState.tabId != null) {
    logBackground('Active tab already armed', { tabId: sessionState.tabId })
    return true
  }

  const activeTab = await getCurrentActiveTab()
  if (!activeTab) {
    logBackground('No active tab available to arm')
    return false
  }

  return armTab(activeTab)
}

async function hydrateSettings() {
  logBackground('Hydrating saved settings')
  const stored = await chrome.storage.local.get(SETTINGS_KEY)
  const value = stored[SETTINGS_KEY] as
    | {
        arenaId?: string
        listenerPosition?: SessionReducerState['listenerPosition']
        realism?: number
        energy?: number
      }
    | undefined
  if (!value) {
    logBackground('No saved settings found')
    return
  }

  sessionState = {
    ...sessionState,
    arenaId: value.arenaId ?? ARENA_PRESET.id,
    listenerPosition: value.listenerPosition ?? sessionState.listenerPosition,
    realism: value.realism ?? sessionState.realism,
    energy: value.energy ?? sessionState.energy,
  }
  logBackground('Hydrated saved settings', value)
}

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl],
  })

  if (contexts.length > 0) {
    logBackground('Offscreen document already available')
    return
  }

  if (creatingOffscreen) {
    logBackground('Waiting for offscreen document creation in progress')
    await creatingOffscreen
    return
  }

  logBackground('Creating offscreen document')
  creatingOffscreen = chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ['USER_MEDIA'],
    justification: 'Process current tab audio with Web Audio in the background.',
  })

  await creatingOffscreen
  creatingOffscreen = null
  logBackground('Offscreen document ready')
}

async function enablePanelForTab(tab: chrome.tabs.Tab) {
  if (tab.id == null) {
    return
  }

  await chrome.sidePanel.setOptions({
    tabId: tab.id,
    path: 'sidepanel.html',
    enabled: true,
  })
  logBackground('Enabled side panel for tab', { tabId: tab.id })
}

async function disableGlobalPanelDefault() {
  await chrome.sidePanel.setOptions({
    enabled: false,
    path: 'sidepanel.html',
  })
  logBackground('Disabled global side panel default')
}

async function openPanelForTab(tab: chrome.tabs.Tab) {
  if (tab.id == null) {
    return
  }

  logBackground('Opening side panel for tab', { tabId: tab.id })
  await chrome.sidePanel.open({
    tabId: tab.id,
  })
}

async function stopSession(reason = 'Stopped') {
  if (sessionState.phase === 'idle' || sessionState.phase === 'stopping') {
    logBackground('Ignoring stop request because session is not active enough', {
      phase: sessionState.phase,
      reason,
    })
    return
  }

  logBackground('Stopping session', { reason, tabId: sessionState.tabId })
  sessionState = reduceSessionState(sessionState, { type: 'SET_PHASE', phase: 'stopping' })
  emitStatus()

  await sendToOffscreen({
    type: 'SESSION_STOP',
    target: MESSAGE_TARGET_OFFSCREEN,
    reason,
  } satisfies RuntimeMessage)

  sessionState = {
    ...sessionState,
    phase: 'idle',
    meterLevel: 0,
    currentSongKey: null,
    currentEstimatedBpm: null,
    currentDetectedNote: null,
    errorMessage: null,
  }
  emitStatus()
}

async function startSession() {
  logBackground('Start session requested', {
    phase: sessionState.phase,
    tabId: sessionState.tabId,
  })
  await ensureActiveTabArmed()
  const targetTabId = sessionState.tabId
  if (targetTabId == null) {
    sessionState = reduceSessionState(sessionState, {
      type: 'ERROR',
      error: 'No active music tab was detected. Focus a playable tab and try again.',
    })
    logBackground('Cannot start because no active tab is armed')
    emitStatus()
    return
  }

  if (sessionState.phase === 'active' && sessionState.tabId != null) {
    await stopSession('Switching session')
  }

  sessionState = reduceSessionState(sessionState, { type: 'SET_PHASE', phase: 'starting' })
  emitStatus()

  try {
    await ensureOffscreenDocument()
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId,
    })
    logBackground('Obtained media stream id', { targetTabId })

    await chrome.runtime.sendMessage({
      type: 'SESSION_START',
      target: MESSAGE_TARGET_OFFSCREEN,
      streamId,
      state: sessionState,
    } satisfies RuntimeMessage)
  } catch (error) {
    logBackground('Failed to start session', {
      targetTabId,
      error: error instanceof Error ? error.message : String(error),
    })
    sessionState = reduceSessionState(sessionState, {
      type: 'ERROR',
      error:
        error instanceof Error
          ? error.message
          : 'Chrome denied tab audio capture for this page.',
    })
    emitStatus()
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  logBackground('Toolbar action clicked', {
    tabId: tab.id ?? null,
    title: tab.title ?? null,
    url: tab.url ?? null,
  })
  if (tab.id == null) {
    logBackground('Toolbar click ignored because tab id is missing')
    return
  }

  const enablePanelPromise = enablePanelForTab(tab)
  await openPanelForTab(tab)
  await enablePanelPromise

  const armed = await armTab(tab)
  if (!armed) {
    logBackground('Toolbar click did not arm a tab')
    return
  }

  await startSession()
})

chrome.tabCapture.onStatusChanged.addListener((info) => {
  logBackground('tabCapture status changed', info)
  if (info.tabId !== sessionState.tabId) {
    return
  }

  if ((info.status === 'stopped' || info.status === 'error') && sessionState.phase === 'active') {
    sessionState = {
      ...sessionState,
      phase: 'idle',
      meterLevel: 0,
      currentSongKey: null,
      currentEstimatedBpm: null,
      currentDetectedNote: null,
      errorMessage: info.status === 'error' ? 'Tab capture ended unexpectedly.' : null,
    }
    emitStatus()
  }
})

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  ;(async () => {
    if (!isTargetedMessage(message, MESSAGE_TARGET_BACKGROUND)) {
      return
    }

    switch (message.type) {
      case 'SESSION_STATUS':
        await ensureActiveTabArmed()
        if (message.state) {
          logBackground('Received session status sync from offscreen', {
            phase: message.state.phase,
            tabId: message.state.tabId,
          })
          sessionState = {
            ...message.state,
            meterLevel: sessionState.meterLevel,
          }
          emitStatus()
          sendResponse({ ok: true })
          return
        }
        sendResponse({
          type: 'SESSION_STATUS',
          target: MESSAGE_TARGET_SIDEPANEL,
          state: sessionState,
          logs: debugEntries,
        } satisfies RuntimeMessage)
        return
      case 'SESSION_START':
        logBackground('SESSION_START command received from UI')
        await startSession()
        sendResponse({ ok: true })
        return
      case 'SESSION_STOP':
        logBackground('SESSION_STOP command received', { reason: message.reason })
        await stopSession(message.reason)
        sendResponse({ ok: true })
        return
      case 'POSITION_UPDATE':
        logBackground('Position update received', message.position)
        sessionState = reduceSessionState(sessionState, {
          type: 'POSITION',
          position: message.position,
        })
        emitStatus()
        await persistSettings()
        await sendToOffscreen({
          ...message,
          target: MESSAGE_TARGET_OFFSCREEN,
          realism: sessionState.realism,
          energy: sessionState.energy,
          arenaId: sessionState.arenaId,
        } satisfies RuntimeMessage)
        sendResponse({ ok: true })
        return
      case 'PARAMS_UPDATE':
        logBackground('Parameter update received', {
          realism: message.realism,
          energy: message.energy,
        })
        sessionState = reduceSessionState(sessionState, {
          type: 'PARAMS',
          realism: message.realism,
          energy: message.energy,
        })
        emitStatus()
        await persistSettings()
        await sendToOffscreen({
          ...message,
          target: MESSAGE_TARGET_OFFSCREEN,
          arenaId: sessionState.arenaId,
        } satisfies RuntimeMessage)
        sendResponse({ ok: true })
        return
      case 'SNAP_TO_SWEET_SPOT':
        logBackground('Sweet spot requested')
        sessionState = reduceSessionState(sessionState, { type: 'SWEET_SPOT' })
        emitStatus()
        await persistSettings()
        await sendToOffscreen({
          type: 'POSITION_UPDATE',
          target: MESSAGE_TARGET_OFFSCREEN,
          position: sessionState.listenerPosition,
          realism: sessionState.realism,
          energy: sessionState.energy,
          arenaId: sessionState.arenaId,
        } satisfies RuntimeMessage)
        sendResponse({ ok: true })
        return
      case 'AUDIO_METER_FRAME':
        sessionState = reduceSessionState(sessionState, {
          type: 'METER',
          level: message.level,
        })
        broadcast({
          type: 'AUDIO_METER_FRAME',
          target: MESSAGE_TARGET_SIDEPANEL,
          level: message.level,
        })
        sendResponse({ ok: true })
        return
      case 'PITCH_NOTE_UPDATE':
        sessionState = reduceSessionState(sessionState, {
          type: 'PITCH_NOTE',
          note: message.note,
        })
        emitStatus()
        sendResponse({ ok: true })
        return
      case 'SONG_KEY_UPDATE':
        sessionState = reduceSessionState(sessionState, {
          type: 'SONG_KEY',
          songKey: message.songKey,
        })
        emitStatus()
        sendResponse({ ok: true })
        return
      case 'BPM_UPDATE':
        sessionState = reduceSessionState(sessionState, {
          type: 'BPM',
          bpm: message.bpm,
        })
        emitStatus()
        sendResponse({ ok: true })
        return
      case 'CAPTURE_ERROR':
        logBackground('Capture error received', { error: message.error })
        sessionState = reduceSessionState(sessionState, {
          type: 'ERROR',
          error: message.error,
        })
        sessionState = {
          ...sessionState,
          meterLevel: 0,
        }
        broadcast({
          type: 'CAPTURE_ERROR',
          target: MESSAGE_TARGET_SIDEPANEL,
          error: message.error,
          state: sessionState,
        })
        emitStatus()
        sendResponse({ ok: true })
        return
      case 'DEBUG_LOG':
        pushDebug(message.entry)
        sendResponse({ ok: true })
        return
    }
  })()

  return true
})

void hydrateSettings().then(() => {
  emitStatus()
  logBackground('Background initialized')
})

void disableGlobalPanelDefault().catch((error) => {
  logBackground('Failed to disable global side panel default', {
    error: error instanceof Error ? error.message : String(error),
  })
})
