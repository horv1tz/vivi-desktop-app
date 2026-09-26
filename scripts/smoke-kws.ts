/* Tunes wake-word detection offline: KWS at several sensitivities + transcript strategy (RU). */
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { KwsWake, OnlineTransducerStt, PiperTts, TranscriptWake } from '../src/voice-worker/engines'
import { modelById } from '../src/shared/models'

const modelsDir = process.env.VIVI_MODELS_DIR!
const sherpa = createRequire(import.meta.url)('sherpa-onnx-node')
function paths(id: string) {
  const m = modelById(id)!
  const dir = join(modelsDir, m.dir)
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
function to16k(s: Float32Array, rate: number): Float32Array {
  const r = new sherpa.LinearResampler(rate, 16000)
  return Float32Array.from(r.resample(s) as Float32Array)
}
function feed(
  engine: { feed: (f: Float32Array) => boolean; reset: () => void },
  audio: Float32Array,
): boolean {
  engine.reset()
  let hit = false
  const FRAME = 320
  const padded = new Float32Array(audio.length + FRAME * 60)
  padded.set(audio)
  for (let i = 0; i + FRAME <= padded.length; i += FRAME)
    if (engine.feed(padded.subarray(i, i + FRAME))) hit = true
  return hit
}
const en = new PiperTts(paths('tts-piper-en-lessac'), 2)
const ru = new PiperTts(paths('tts-piper-ru-irina'), 2)
const samples: [string, Float32Array, boolean][] = []
for (const [text, positive] of [
  ['Hey Vivi.', true],
  ['Vivi!', true],
  ['Vivi, open the browser.', true],
  ['The weather is nice today.', false],
  ['Give me a minute.', false],
] as [string, boolean][]) {
  const w = await en.synthesize(text, 0.95)
  samples.push([`EN ${text}`, to16k(w.samples, w.sampleRate), positive])
}
for (const [text, positive] of [
  ['Виви, включи музыку.', true],
  ['Виви!', true],
  ['Эй, Виви, что нового?', true],
  ['Какая сегодня погода?', false],
  ['Привет, как дела?', false],
] as [string, boolean][]) {
  const w = await ru.synthesize(text, 1.0)
  samples.push([`RU ${text}`, to16k(w.samples, w.sampleRate), positive])
}
for (const sens of [0.5, 0.75, 1.0]) {
  const kws = new KwsWake(paths('kws-zipformer-en'), ['vivi', 'hey vivi'], sens, 2)
  const res = samples.map(
    ([name, a, pos]) => `${feed(kws, a) ? (pos ? '✓' : '✗FP') : pos ? '✗miss' : '·'} ${name}`,
  )
  console.log(`--- KWS sensitivity ${sens}\n${res.join('\n')}`)
}
const tw = new TranscriptWake(new OnlineTransducerStt(paths('stt-zipformer-small-ru'), 2), [
  'виви',
  'vivi',
])
console.log(
  `--- transcript strategy (RU streaming STT)\n${samples.map(([name, a, pos]) => `${feed(tw, a) ? (pos ? '✓' : '✗FP') : pos ? '✗miss' : '·'} ${name}`).join('\n')}`,
)
