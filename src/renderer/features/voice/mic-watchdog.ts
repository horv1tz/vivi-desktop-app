// VO-02 (voice pipeline resilience): pure, DOM-free decision logic for detecting a broken
// microphone from the renderer. Kept separate from useVoiceBridge.ts so it is trivially
// unit-testable without any live getUserMedia/AudioWorklet/AudioContext plumbing.
import type { VoiceState } from '@shared/events'

/** Minimum/maximum bounds for the "no audio at all" watchdog, and how much to scale the
 *  configured end-of-utterance silence window by. Kept generous on both ends: never so low it
 *  could fire during a normal short pause, never so high the user is left wondering for too long
 *  why nothing is happening when the mic has genuinely died mid-listen. */
const MIC_WATCHDOG_MIN_MS = 8000
const MIC_WATCHDOG_MAX_MS = 20000
const MIC_WATCHDOG_SILENCE_MULTIPLIER = 8

/** How long a mic-error we raised locally stays visible before we fall back to 'armed' on our
 *  own, in case the main process never sends a fresh `voice:state` to clear it (e.g. the pipeline
 *  itself has no way to notice the renderer-side capture died). */
export const MIC_ERROR_DISPLAY_MS = 1500

/** Derives the "no microphone input" watchdog timeout from the configured end-of-utterance
 *  silence window (`settings.voice.silenceMs`), scaled up and clamped to a sane range. */
export function micWatchdogTimeoutMs(silenceMs: number): number {
  return Math.min(MIC_WATCHDOG_MAX_MS, Math.max(MIC_WATCHDOG_MIN_MS, silenceMs * MIC_WATCHDOG_SILENCE_MULTIPLIER))
}

export interface MicHeartbeatCheck {
  /** The voice pipeline state as last reported by the main process. */
  voiceState: VoiceState
  now: number
  /** Timestamp of the last sign of live mic frames reaching the worker (see useVoiceBridge.ts's
   *  use of the `voice:level` event, which the worker emits on every frame it processes). */
  lastHeartbeatAt: number
  timeoutMs: number
}

/**
 * Whether the mic watchdog should raise a "no microphone input" error.
 *
 * Deliberately scoped to the ACTIVE 'listening' capture state only — never the passive
 * wake-word-armed wait, where sitting quietly for a long time is completely normal and expected.
 * Also distinct from the worker's own noSpeechTimeoutMs (which requires frames to actually be
 * arriving to notice a timeout at all): this catches the case where frames have stopped arriving
 * entirely, which the worker-side timeout can never observe.
 */
export function shouldFlagMicSilence({ voiceState, now, lastHeartbeatAt, timeoutMs }: MicHeartbeatCheck): boolean {
  return voiceState === 'listening' && now - lastHeartbeatAt >= timeoutMs
}

export interface MinimalDeviceInfo {
  kind: string
  deviceId: string
}

/**
 * Whether the microphone the user selected in settings is still among the system's audio input
 * devices. An empty `inputDeviceId` means "system default", which we treat as always present —
 * there is no single device identity to lose track of, so we rely on the heartbeat watchdog above
 * for that case instead.
 */
export function isSelectedDeviceStillPresent(devices: readonly MinimalDeviceInfo[], inputDeviceId: string): boolean {
  if (!inputDeviceId) return true
  return devices.some((d) => d.kind === 'audioinput' && d.deviceId === inputDeviceId)
}
