import { useEffect, useRef } from 'react'
import { invoke, vivi } from '../../lib/bridge'
import { useSettingsStore } from '../../stores/settings'
import { useVoiceStore } from '../../stores/voice'
import { MicCapture } from '../../audio/capture'
import { TtsPlayer } from '../../audio/player'
import {
  isSelectedDeviceStillPresent,
  MIC_ERROR_DISPLAY_MS,
  micWatchdogTimeoutMs,
  shouldFlagMicSilence,
} from './mic-watchdog'

/** How often the "no microphone input" watchdog re-checks the heartbeat while listening (VO-02). */
const MIC_WATCHDOG_POLL_MS = 1000

/**
 * Surfaces a mic problem in the local voice store immediately (VO-02), rather than leaving the UI
 * silently sitting in whatever state it was last told about. The main process's own state machine
 * has no way to know the renderer-side capture died, so this sets — and, unless something else
 * updates the store first, shortly reverts — the state itself rather than only logging.
 */
function reportMicError(reason: string): void {
  useVoiceStore.setState({ state: 'error', detail: reason })
  setTimeout(() => {
    const cur = useVoiceStore.getState()
    if (cur.state === 'error' && cur.detail === reason)
      useVoiceStore.setState({ state: 'armed', detail: undefined })
  }, MIC_ERROR_DISPLAY_MS)
}

/**
 * Mounts microphone capture and TTS playback in the main window. The voice worker's audio port is
 * handed over by preload as a window 'message' event; playback chunks arrive over IPC.
 */
export function useVoiceBridge(enabled: boolean): void {
  const capture = useRef<MicCapture | null>(null)
  const player = useRef<TtsPlayer | null>(null)
  const inputDeviceId = useSettingsStore((s) => s.settings.voice.inputDeviceId)
  const outputDeviceId = useSettingsStore((s) => s.settings.voice.outputDeviceId)
  const voiceEnabled = useSettingsStore((s) => s.settings.voice.enabled)
  const silenceMs = useSettingsStore((s) => s.settings.voice.silenceMs)

  useEffect(() => {
    if (!enabled) return
    const cap = (capture.current ??= new MicCapture())
    const pl = (player.current ??= new TtsPlayer())
    pl.onEnded = (generation) => void invoke('voice:playbackEnded', generation)

    const onMessage = (e: MessageEvent): void => {
      if (e.data === 'voice:port' && e.ports[0]) {
        cap.setPort(e.ports[0])
        if (voiceEnabled)
          cap.start(inputDeviceId).catch((err) => console.warn('mic start failed', err))
      }
    }
    window.addEventListener('message', onMessage)
    const offAudio = vivi.on('voice:audio', (chunk) => pl.push(chunk as never))
    const offStop = vivi.on('voice:stopPlayback', ({ generation }) => pl.stop(generation))
    return () => {
      window.removeEventListener('message', onMessage)
      offAudio()
      offStop()
    }
  }, [enabled, inputDeviceId, voiceEnabled])

  useEffect(() => {
    if (!enabled) return
    void player.current?.setSink(outputDeviceId)
  }, [enabled, outputDeviceId])

  useEffect(() => {
    if (!enabled) return
    const cap = capture.current
    if (!cap) return
    if (voiceEnabled) cap.start(inputDeviceId).catch((err) => console.warn('mic start failed', err))
    else void cap.stop()
  }, [enabled, voiceEnabled, inputDeviceId])

  // VO-02: surface a broken microphone instead of silently sitting in 'armed'/'listening' forever.
  // Audio frames are transferred straight from the AudioWorklet to the voice worker (never through
  // this thread), so we can't watch frames directly here — instead we use the worker's own
  // `voice:level` event (emitted on every frame it processes) as a heartbeat, and a device-list
  // check as a fast stand-in for the underlying MediaStreamTrack's `ended` event.
  useEffect(() => {
    if (!enabled || !voiceEnabled) return
    let lastHeartbeatAt = Date.now()
    const offLevel = vivi.on('voice:level', () => {
      lastHeartbeatAt = Date.now()
    })
    const timeoutMs = micWatchdogTimeoutMs(silenceMs)
    const poll = setInterval(() => {
      const voiceState = useVoiceStore.getState().state
      if (shouldFlagMicSilence({ voiceState, now: Date.now(), lastHeartbeatAt, timeoutMs })) {
        reportMicError('no microphone input')
        lastHeartbeatAt = Date.now() // debounce: one report per silence episode, not one per tick
      }
    }, MIC_WATCHDOG_POLL_MS)

    const md = navigator.mediaDevices as MediaDevices | undefined
    const onDeviceChange = (): void => {
      md?.enumerateDevices()
        .then((devices) => {
          if (!isSelectedDeviceStillPresent(devices, inputDeviceId))
            reportMicError('microphone disconnected')
        })
        .catch(() => undefined)
    }
    md?.addEventListener('devicechange', onDeviceChange)

    return () => {
      offLevel()
      clearInterval(poll)
      md?.removeEventListener('devicechange', onDeviceChange)
    }
  }, [enabled, voiceEnabled, inputDeviceId, silenceMs])
}
