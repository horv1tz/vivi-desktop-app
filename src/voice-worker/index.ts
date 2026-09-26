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
let ttsQueue: { generation: number; seq: number; text: string }[] = []
let ttsBusy = false
let cancelledGeneration = -1
let speed = 1.0

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
      if (!engines?.tts) {
        send({ type: 'tts-error', generation: job.generation, seq: job.seq, error: 'TTS model not loaded' })
        continue
      }
      try {
        const { samples, sampleRate } = await engines.tts.synthesize(job.text, speed)
        if (job.generation <= cancelledGeneration) continue
        const copy = Float32Array.from(samples)
        send({ type: 'tts-audio', generation: job.generation, seq: job.seq, sampleRate, pcm: copy.buffer })
      } catch (err) {
        send({ type: 'tts-error', generation: job.generation, seq: job.seq, error: (err as Error).message })
      }
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
          { sampleRate: 16000, silenceMs: msg.settings.silenceMs, noSpeechTimeoutMs: 7000, maxUtteranceMs: 30_000, preRollMs: 1500, wakeWordEnabled: msg.settings.wakeWordEnabled && !!engines.wake, bargeInMs: 300, bargeInGraceMs: 400 },
          {
            onState: (state) => send({ type: 'state', state: state === 'finalizing' ? 'transcribing' : state }),
            onWake: () => send({ type: 'wake' }),
            onPartial: (text) => send({ type: 'partial', text }),
            onFinal: (text, durationMs) => send({ type: 'final', text, durationMs }),
            onTimeout: () => send({ type: 'timeout' }),
            onLevel: (rms) => send({ type: 'level', rms }),
            onBargeIn: () => send({ type: 'barge-in' }),
            onError: (message) => send({ type: 'error', message }),
          },
        )
        send({ type: 'init-done', ok: true, capabilities: { stt: true, vad: true, kws: !!engines.wake, tts: !!engines.tts } })
        log.info(`engines ready (sherpa ${sherpaVersion()}) wake=${!!engines.wake} tts=${!!engines.tts}`)
      } catch (err) {
        log.error('init failed', err)
        send({ type: 'init-done', ok: false, error: (err as Error).message, capabilities: { stt: false, vad: false, kws: false, tts: false } })
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
// Keep the event loop alive: message ports alone may not hold the utility process open.
setInterval(() => undefined, 60_000)

send({ type: 'ready' })
