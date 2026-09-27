import type { ModelPaths } from '../main/voice/models'

export interface WorkerModelConfig {
  stt?: {
    engine: 'online-transducer' | 'offline-transducer' | 'offline-whisper' | 'offline-nemo-ctc'
    paths: ModelPaths
    language: 'ru' | 'en' | 'auto'
  }
  vad?: ModelPaths
  kws?: ModelPaths
  tts?: { paths: ModelPaths; speed: number }
}

export interface WorkerSettings {
  silenceMs: number
  wakeWordEnabled: boolean
  wakeWordStrategy: 'kws' | 'transcript'
  wakeWordSensitivity: number
  keywords: string[]
  numThreads: number
  /** VO-03: how long to listen without the wake word after a voice-turn reply finishes speaking. 0 disables it. */
  followupMs: number
  /** VO-04: only the wake word interrupts TTS playback, instead of any sustained speech. */
  bargeInRequiresWakeWord: boolean
}

export type MainToWorker =
  | { type: 'init'; models: WorkerModelConfig; settings: WorkerSettings; libDir?: string }
  | { type: 'audio-port' }
  | { type: 'arm' }
  | { type: 'disarm' }
  | { type: 'ptt'; active: boolean }
  | { type: 'followup' }
  | { type: 'cancel' }
  | { type: 'set-speaking'; speaking: boolean }
  | { type: 'tts'; generation: number; seq: number; text: string }
  | { type: 'tts-cancel'; generation: number }
  | { type: 'shutdown' }
  | { type: 'ping' }

export type WorkerToMain =
  | { type: 'ready' }
  | { type: 'pong' }
  | {
      type: 'init-done'
      ok: boolean
      error?: string
      capabilities: { stt: boolean; vad: boolean; kws: boolean; tts: boolean }
    }
  | { type: 'state'; state: 'off' | 'armed' | 'listening' | 'transcribing' | 'followup' }
  | { type: 'wake' }
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string; durationMs: number }
  | { type: 'timeout' }
  | { type: 'level'; rms: number }
  | { type: 'barge-in' }
  | { type: 'tts-audio'; generation: number; seq: number; sampleRate: number; pcm: ArrayBuffer }
  | { type: 'tts-error'; generation: number; seq: number; error: string }
  | { type: 'error'; message: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
