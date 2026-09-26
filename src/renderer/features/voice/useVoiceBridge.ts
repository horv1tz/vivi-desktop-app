import { useEffect, useRef } from 'react'
import { invoke, vivi } from '../../lib/bridge'
import { useSettingsStore } from '../../stores/settings'
import { MicCapture } from '../../audio/capture'
import { TtsPlayer } from '../../audio/player'

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

  useEffect(() => {
    if (!enabled) return
    const cap = (capture.current ??= new MicCapture())
    const pl = (player.current ??= new TtsPlayer())
    pl.onEnded = (generation) => void invoke('voice:playbackEnded', generation)

    const onMessage = (e: MessageEvent): void => {
      if (e.data === 'voice:port' && e.ports[0]) {
        cap.setPort(e.ports[0])
        if (voiceEnabled) cap.start(inputDeviceId).catch((err) => console.warn('mic start failed', err))
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
}
