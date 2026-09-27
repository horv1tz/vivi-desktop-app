/* Offline end-to-end check of the voice stack without a microphone:
   Piper TTS synthesizes phrases → audio is fed into the STT/VAD pipeline (push-to-talk) and into the
   wake-word spotter. Usage:
     VIVI_MODELS_DIR=/path/to/extracted LD_LIBRARY_PATH=$PWD/node_modules/sherpa-onnx-linux-x64 npx tsx scripts/smoke-voice.ts */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { buildEngines, PiperTts } from '../src/voice-worker/engines'
import { VoicePipeline } from '../src/voice-worker/pipeline'
import { VOICE_MODELS, modelById } from '../src/shared/models'

const modelsDir = process.env.VIVI_MODELS_DIR
if (!modelsDir) throw new Error('set VIVI_MODELS_DIR')
const require = createRequire(import.meta.url)
const sherpa = require('sherpa-onnx-node')

function paths(id: string) {
  const m = modelById(id)!
  const dir = join(modelsDir!, m.dir)
  const p = (f?: string) => (f ? join(dir, f) : undefined)
  return {
    dir,
    encoder: p(m.files.encoder),
    decoder: p(m.files.decoder),
    joiner: p(m.files.joiner),
    model: p(m.files.model),
    tokens: m.files.tokens ? join(dir, m.files.tokens) : undefined,
    dataDir: p(m.files.dataDir),
  }
}

for (const id of [
  'vad-silero-v5',
  'stt-zipformer-small-ru',
  'tts-piper-ru-irina',
  'tts-piper-en-lessac',
  'kws-zipformer-en',
]) {
  const p = paths(id)
  const need = [p.encoder, p.decoder, p.joiner, p.model, p.tokens].filter(Boolean) as string[]
  for (const f of need) if (!existsSync(f)) throw new Error(`missing ${f} for ${id}`)
}

function resampleTo16k(samples: Float32Array, rate: number): Float32Array {
  if (rate === 16000) return samples
  const r = new sherpa.LinearResampler(rate, 16000)
  const out = r.resample(samples) as Float32Array
  return Float32Array.from(out)
}

async function feedFrames(
  pipeline: VoicePipeline,
  audio: Float32Array,
  tick: (ms: number) => void,
): Promise<void> {
  const FRAME = 320
  const silence = new Float32Array(FRAME)
  for (let i = 0; i < audio.length; i += FRAME) {
    const frame = audio.subarray(i, Math.min(i + FRAME, audio.length))
    const padded =
      frame.length === FRAME
        ? frame
        : (() => {
            const f = new Float32Array(FRAME)
            f.set(frame)
            return f
          })()
    tick(20)
    pipeline.feed(padded)
  }
  for (let i = 0; i < 100; i++) {
    tick(20)
    pipeline.feed(silence)
  }
}

async function main(): Promise<void> {
  const t0 = Date.now()
  const engines = buildEngines(
    {
      stt: { engine: 'online-transducer', paths: paths('stt-zipformer-small-ru'), language: 'ru' },
      vad: paths('vad-silero-v5'),
      kws: paths('kws-zipformer-en'),
      tts: { paths: paths('tts-piper-ru-irina'), speed: 1 },
    },
    {
      silenceMs: 800,
      followupMs: 0,
      bargeInRequiresWakeWord: false,
      wakeWordEnabled: true,
      wakeWordStrategy: 'kws',
      wakeWordSensitivity: 0.6,
      keywords: ['vivi', 'hey vivi'],
      numThreads: 2,
    },
  )
  console.log(
    `[voice] engines built in ${Date.now() - t0}ms; warnings: ${engines.warnings.join('; ') || 'none'}`,
  )

  // 1. TTS RU → STT RU via push-to-talk
  const phrase = 'Открой папку с документами и покажи последние файлы.'
  const t1 = Date.now()
  const ru = await engines.tts!.synthesize(phrase, 1.0)
  console.log(
    `[tts] ${ru.samples.length} samples @${ru.sampleRate}Hz in ${Date.now() - t1}ms (${(ru.samples.length / ru.sampleRate).toFixed(1)}s of audio)`,
  )
  const audio16 = resampleTo16k(ru.samples, ru.sampleRate)

  let now = 0
  const finals: string[] = []
  const partials: string[] = []
  const pipeline = new VoicePipeline(
    { wake: engines.wake, vad: engines.vad, stt: engines.stt },
    {
      sampleRate: 16000,
      silenceMs: 800,
      noSpeechTimeoutMs: 7000,
      maxUtteranceMs: 30000,
      preRollMs: 1500,
      wakeWordEnabled: true,
      bargeInMs: 300,
      bargeInGraceMs: 400,
      followupMs: 0,
      bargeInRequiresWakeWord: false,
      now: () => now,
    },
    {
      onState: (s) => console.log(`[state] ${s}`),
      onWake: () => console.log('[wake] detected'),
      onPartial: (t) => partials.push(t),
      onFinal: (t) => finals.push(t),
      onTimeout: () => console.log('[timeout]'),
      onLevel: () => undefined,
      onBargeIn: () => console.log('[barge-in]'),
      onError: (m) => console.log(`[error] ${m}`),
    },
  )
  pipeline.arm()
  pipeline.startListening({ withPreRoll: false })
  await feedFrames(pipeline, audio16, (ms) => (now += ms))
  await new Promise((r) => setTimeout(r, 300))
  console.log(`[stt] partials=${partials.length} last="${partials.at(-1) ?? ''}"`)
  console.log(`[stt] final="${finals.join(' | ')}"`)
  const ok1 =
    finals.join(' ').toLowerCase().includes('папк') ||
    finals.join(' ').toLowerCase().includes('файл')
  console.log(ok1 ? '[stt] PASS' : '[stt] FAIL (expected words about папка/файлы)')

  // 2. Wake word: English TTS says "hey vivi" → KWS should fire while armed
  const en = new PiperTts(paths('tts-piper-en-lessac'), 2)
  let wakes = 0
  const pipeline2 = new VoicePipeline(
    { wake: engines.wake, vad: engines.vad, stt: engines.stt },
    {
      sampleRate: 16000,
      silenceMs: 800,
      noSpeechTimeoutMs: 3000,
      maxUtteranceMs: 30000,
      preRollMs: 1500,
      wakeWordEnabled: true,
      bargeInMs: 300,
      bargeInGraceMs: 400,
      followupMs: 0,
      bargeInRequiresWakeWord: false,
      now: () => now,
    },
    {
      onState: () => undefined,
      onWake: () => wakes++,
      onPartial: () => undefined,
      onFinal: () => undefined,
      onTimeout: () => undefined,
      onLevel: () => undefined,
      onBargeIn: () => undefined,
      onError: (m) => console.log(`[error] ${m}`),
    },
  )
  for (const text of ['Hey Vivi.', 'Vivi!', 'Vee vee, are you there?']) {
    const w = await en.synthesize(text, 0.95)
    const a = resampleTo16k(w.samples, w.sampleRate)
    pipeline2.arm()
    const before = wakes
    await feedFrames(pipeline2, a, (ms) => (now += ms))
    pipeline2.cancel()
    console.log(`[kws] "${text}" → ${wakes > before ? 'DETECTED' : 'missed'}`)
  }
  const ru2 = await engines.tts!.synthesize('Виви, включи музыку.', 1.0)
  const a2 = resampleTo16k(ru2.samples, ru2.sampleRate)
  pipeline2.arm()
  const before = wakes
  await feedFrames(pipeline2, a2, (ms) => (now += ms))
  console.log(`[kws] RU "Виви, включи музыку" → ${wakes > before ? 'DETECTED' : 'missed'}`)
  // Negative control
  const neg = await en.synthesize('The weather is nice today.', 1.0)
  pipeline2.cancel()
  pipeline2.arm()
  const beforeNeg = wakes
  await feedFrames(pipeline2, resampleTo16k(neg.samples, neg.sampleRate), (ms) => (now += ms))
  console.log(`[kws] negative control → ${wakes > beforeNeg ? 'FALSE POSITIVE' : 'ok'}`)
  console.log(`[voice] done in ${Date.now() - t0}ms; wakes=${wakes}`)
  process.exit(ok1 && wakes > 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
void VOICE_MODELS
