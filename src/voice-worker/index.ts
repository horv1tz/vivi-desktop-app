// Voice worker (Electron utilityProcess): owns the native sherpa-onnx engines and the
// wake-word → VAD → STT pipeline; synthesizes TTS on request. Audio frames arrive on a
// MessagePort handed over from the renderer (Int16 PCM, 16 kHz, 20 ms frames).
import type { MessagePortMain } from 'electron'
import { logger } from './log'
import { VoicePipeline } from './pipeline'
import { buildEngines, sherpaVersion, type BuiltEngines } from './engines'
import type { MainToWorker, WorkerToMain } from './protocol'

const log = logger('voice-worker')
const port = process.parentPort

function send(msg: WorkerToMain): void {
  port?.postMessage(msg)
}

let engines: BuiltEngines | null = null
let pipeline: VoicePipeline | null = null
let audioPort: MessagePortMain | null = null
let ttsQueue: TtsJob[] = []
let ttsBusy = false
let cancelledGeneration = -1
let speed = 1.0

export interface TtsJob {
  generation: number
  seq: number
  text: string
}

export interface TtsSynthesizer {
  synthesize(text: string, speed: number): Promise<{ samples: Float32Array; sampleRate: number }>
}

/**
 * Synthesizes one queued TTS chunk. Never throws (VO-02): a failed chunk resolves to a
 * 'tts-error' message instead of rejecting, so the caller's queue loop can move straight on to
 * the next chunk rather than a single bad sentence stalling — or killing — the whole reply.
 */
export async function synthesizeTtsJob(
  job: TtsJob,
  tts: TtsSynthesizer | null,
  speed: number,
  onError: (err: unknown) => void,
): Promise<WorkerToMain> {
  if (!tts)
    return {
      type: 'tts-error',
      generation: job.generation,
      seq: job.seq,
      error: 'TTS model not loaded',
    }
  try {
    const { samples, sampleRate } = await tts.synthesize(job.text, speed)
    return {
      type: 'tts-audio',
      generation: job.generation,
      seq: job.seq,
      sampleRate,
      pcm: Float32Array.from(samples).buffer,
    }
  } catch (err) {
    onError(err)
    return {
      type: 'tts-error',
      generation: job.generation,
      seq: job.seq,
      error: (err as Error).message,
    }
  }
}

function int16ToFloat(buf: ArrayBuffer): Float32Array {
  const src = new Int16Array(buf)
  const out = new Float32Array(src.length)
  for (let i = 0; i < src.length; i++) out[i] = src[i]! / 32768
  return out
}

function attachAudioPort(p: MessagePortMain): void {
  audioPort?.close()
  audioPort = p
  p.on('message', (e) => {
    const data = e.data as ArrayBuffer | { type: string }
    if (data instanceof ArrayBuffer) pipeline?.feed(int16ToFloat(data))
  })
  p.start()
  log.info('audio port attached')
}

async function runTtsQueue(): Promise<void> {
  if (ttsBusy) return
  ttsBusy = true
  try {
    while (ttsQueue.length) {
      const job = ttsQueue.shift()!
      if (job.generation <= cancelledGeneration) continue
      // A single chunk failing to synthesize must not stop the rest of the queue (VO-02): log it
      // and keep going — synthesizeTtsJob() always resolves, it never throws.
      const msg = await synthesizeTtsJob(job, engines?.tts ?? null, speed, (err) =>
        log.error(`tts synth failed (gen ${job.generation} seq ${job.seq})`, err),
      )
      if (job.generation <= cancelledGeneration) continue
      send(msg)
    }
  } finally {
    ttsBusy = false
  }
}

function handle(msg: MainToWorker, ports: MessagePortMain[]): void {
  switch (msg.type) {
    case 'ping':
      send({ type: 'pong' })
      break
    case 'audio-port':
      if (ports[0]) attachAudioPort(ports[0])
      break
    case 'init': {
      try {
        if (msg.libDir) {
          const key = process.platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH'
          process.env[key] = `${msg.libDir}${process.env[key] ? `:${process.env[key]}` : ''}`
        }
        engines = buildEngines(msg.models, msg.settings)
        speed = msg.models.tts?.speed ?? 1.0
        for (const w of engines.warnings) send({ type: 'log', level: 'warn', message: w })
        pipeline = new VoicePipeline(
          { wake: engines.wake, vad: engines.vad, stt: engines.stt },
          {
            sampleRate: 16000,
            silenceMs: msg.settings.silenceMs,
            noSpeechTimeoutMs: 7000,
            maxUtteranceMs: 30_000,
            preRollMs: 1500,
            wakeWordEnabled: msg.settings.wakeWordEnabled && !!engines.wake,
            bargeInMs: 300,
            bargeInGraceMs: 400,
          },
          {
            onState: (state) =>
              send({ type: 'state', state: state === 'finalizing' ? 'transcribing' : state }),
            onWake: () => send({ type: 'wake' }),
            onPartial: (text) => send({ type: 'partial', text }),
            onFinal: (text, durationMs) => send({ type: 'final', text, durationMs }),
            onTimeout: () => send({ type: 'timeout' }),
            onLevel: (rms) => send({ type: 'level', rms }),
            onBargeIn: () => send({ type: 'barge-in' }),
            onError: (message) => send({ type: 'error', message }),
          },
        )
        send({
          type: 'init-done',
          ok: true,
          capabilities: { stt: true, vad: true, kws: !!engines.wake, tts: !!engines.tts },
        })
        log.info(
          `engines ready (sherpa ${sherpaVersion()}) wake=${!!engines.wake} tts=${!!engines.tts}`,
        )
      } catch (err) {
        log.error('init failed', err)
        send({
          type: 'init-done',
          ok: false,
          error: (err as Error).message,
          capabilities: { stt: false, vad: false, kws: false, tts: false },
        })
      }
      break
    }
    case 'arm':
      pipeline?.arm()
      break
    case 'disarm':
      pipeline?.disarm()
      break
    case 'ptt':
      if (!pipeline) break
      if (msg.active) {
        if (pipeline.current === 'off') pipeline.arm()
        pipeline.startListening({ withPreRoll: true })
      } else pipeline.stopListening()
      break
    case 'cancel':
      pipeline?.cancel()
      break
    case 'set-speaking':
      pipeline?.setSpeaking(msg.speaking)
      break
    case 'tts':
      ttsQueue.push({ generation: msg.generation, seq: msg.seq, text: msg.text })
      void runTtsQueue()
      break
    case 'tts-cancel':
      cancelledGeneration = Math.max(cancelledGeneration, msg.generation)
      ttsQueue = ttsQueue.filter((j) => j.generation > msg.generation)
      break
    case 'shutdown':
      audioPort?.close()
      process.exit(0)
      break
  }
}

port?.on('message', (event) => {
  try {
    handle(event.data as MainToWorker, event.ports as MessagePortMain[])
  } catch (err) {
    log.error('message handling failed', err)
    send({ type: 'error', message: (err as Error).message })
  }
})

process.on('uncaughtException', (err) => {
  log.error('uncaughtException', err)
  send({ type: 'error', message: `worker crashed: ${err.message}` })
})
process.on('unhandledRejection', (reason) => log.error('unhandledRejection', reason))
process.on('exit', (code) => log.info(`worker exiting with code ${code}`))
// Keep the event loop alive: message ports alone may not hold the utility process open. Skipped
// under Vitest (which sets process.env.VITEST) so unit tests can import this module's exported
// helpers (e.g. synthesizeTtsJob) without leaking a timer into the test process.
if (!process.env.VITEST) setInterval(() => undefined, 60_000)

send({ type: 'ready' })
