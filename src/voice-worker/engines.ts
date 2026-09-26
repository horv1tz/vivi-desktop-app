/* Thin wrappers over sherpa-onnx-node implementing the pipeline engine interfaces. */
import { existsSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import type { SttEngine, VadEngine, WakeEngine } from './pipeline'
import type { WorkerModelConfig, WorkerSettings } from './protocol'
import { buildKeywordsFile, matchesWakeWord } from './keywords'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sherpa = any

let sherpa: Sherpa | null = null

export function loadSherpa(): Sherpa {
  if (sherpa) return sherpa
  const require = createRequire(import.meta.url)
  sherpa = require('sherpa-onnx-node')
  return sherpa
}

export function sherpaVersion(): string {
  try {
    return String(loadSherpa().version)
  } catch {
    return 'unavailable'
  }
}

const SAMPLE_RATE = 16000

export class SileroVad implements VadEngine {
  private vad: Sherpa
  private speaking = false

  constructor(modelPath: string, opts: { silenceMs: number; threshold?: number }) {
    const s = loadSherpa()
    this.vad = new s.Vad(
      {
        sileroVad: {
          model: modelPath,
          threshold: opts.threshold ?? 0.5,
          minSilenceDuration: Math.max(0.3, opts.silenceMs / 1000),
          minSpeechDuration: 0.2,
          maxSpeechDuration: 30,
          windowSize: 512,
        },
        sampleRate: SAMPLE_RATE,
        numThreads: 1,
        debug: false,
      },
      45,
    )
  }

  feed(frame: Float32Array): boolean {
    this.vad.acceptWaveform(frame)
    this.speaking = !!this.vad.isDetected()
    return this.speaking
  }

  popSegments(): Float32Array[] {
    const out: Float32Array[] = []
    while (!this.vad.isEmpty()) {
      const seg = this.vad.front(false) as { samples: Float32Array }
      out.push(Float32Array.from(seg.samples))
      this.vad.pop()
    }
    return out
  }

  flush(): void {
    this.vad.flush()
  }

  reset(): void {
    this.vad.reset()
    this.vad.clear()
    this.speaking = false
  }
}

export class KwsWake implements WakeEngine {
  private spotter: Sherpa
  private stream: Sherpa
  readonly unresolved: string[]

  constructor(
    paths: { dir: string; encoder?: string; decoder?: string; joiner?: string; tokens?: string },
    keywords: string[],
    sensitivity: number,
    numThreads: number,
  ) {
    const s = loadSherpa()
    const tokensTxt = readFileSync(paths.tokens!, 'utf8')
    // Sensitivity 0..1 → threshold 0.45..0.05 (lower = more sensitive), boost 1..3.
    const threshold = +(0.45 - 0.4 * Math.min(1, Math.max(0, sensitivity))).toFixed(3)
    const boost = +(1 + 2 * sensitivity).toFixed(2)
    const { content, unresolved } = buildKeywordsFile(keywords, tokensTxt, boost, threshold)
    this.unresolved = unresolved
    const keywordsFile = join(paths.dir, 'vivi-keywords.txt')
    writeFileSync(keywordsFile, content, 'utf8')
    this.spotter = new s.KeywordSpotter({
      featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
      modelConfig: {
        transducer: { encoder: paths.encoder, decoder: paths.decoder, joiner: paths.joiner },
        tokens: paths.tokens,
        numThreads,
        provider: 'cpu',
        debug: 0,
      },
      maxActivePaths: 4,
      numTrailingBlanks: 1,
      keywordsScore: boost,
      keywordsThreshold: threshold,
      keywordsFile,
    })
    this.stream = this.spotter.createStream()
  }

  feed(frame: Float32Array): boolean {
    this.stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples: frame })
    let detected = false
    while (this.spotter.isReady(this.stream)) {
      this.spotter.decode(this.stream)
      const r = this.spotter.getResult(this.stream) as { keyword?: string }
      if (r.keyword) {
        detected = true
        this.spotter.reset(this.stream)
      }
    }
    return detected
  }

  reset(): void {
    this.spotter.reset(this.stream)
  }
}

/** Wake detection by running the streaming recognizer continuously and fuzzy-matching the transcript. */
export class TranscriptWake implements WakeEngine {
  private lastText = ''
  constructor(
    private readonly stt: OnlineTransducerStt,
    private readonly keywords: string[],
  ) {}

  feed(frame: Float32Array): boolean {
    const text = this.stt.feed(frame)
    if (text && text !== this.lastText) {
      this.lastText = text
      if (matchesWakeWord(text, this.keywords)) {
        this.stt.reset()
        this.lastText = ''
        return true
      }
    }
    if (this.stt.isEndpoint()) {
      this.stt.reset()
      this.lastText = ''
    }
    return false
  }

  reset(): void {
    this.stt.reset()
    this.lastText = ''
  }
}

export class OnlineTransducerStt implements SttEngine {
  readonly streaming = true
  private recognizer: Sherpa
  private stream: Sherpa
  private lastPartial = ''

  constructor(
    paths: { encoder?: string; decoder?: string; joiner?: string; tokens?: string },
    numThreads: number,
  ) {
    const s = loadSherpa()
    this.recognizer = new s.OnlineRecognizer({
      featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
      modelConfig: {
        transducer: { encoder: paths.encoder, decoder: paths.decoder, joiner: paths.joiner },
        tokens: paths.tokens,
        numThreads,
        provider: 'cpu',
        debug: 0,
      },
      decodingMethod: 'greedy_search',
      maxActivePaths: 4,
      enableEndpoint: true,
      rule1MinTrailingSilence: 2.4,
      rule2MinTrailingSilence: 1.2,
      rule3MinUtteranceLength: 20,
    })
    this.stream = this.recognizer.createStream()
  }

  feed(frame: Float32Array): string | null {
    this.stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples: frame })
    while (this.recognizer.isReady(this.stream)) this.recognizer.decode(this.stream)
    const text = String(
      (this.recognizer.getResult(this.stream) as { text: string }).text ?? '',
    ).trim()
    if (text && text !== this.lastPartial) {
      this.lastPartial = text
      return text
    }
    return null
  }

  isEndpoint(): boolean {
    return !!this.recognizer.isEndpoint(this.stream)
  }

  async finalize(segment: Float32Array | null): Promise<string> {
    if (segment && this.lastPartial.length === 0) {
      // Nothing streamed (e.g. pre-roll only): decode the segment in one go.
      this.stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples: segment })
    }
    // Tail padding lets the encoder flush the last frames.
    this.stream.acceptWaveform({
      sampleRate: SAMPLE_RATE,
      samples: new Float32Array(Math.round(SAMPLE_RATE * 0.5)),
    })
    this.stream.inputFinished()
    while (this.recognizer.isReady(this.stream)) this.recognizer.decode(this.stream)
    const text = String(
      (this.recognizer.getResult(this.stream) as { text: string }).text ?? '',
    ).trim()
    this.reset()
    return text
  }

  reset(): void {
    this.recognizer.reset(this.stream)
    this.stream = this.recognizer.createStream()
    this.lastPartial = ''
  }
}

export class OfflineStt implements SttEngine {
  readonly streaming = false
  private recognizer: Sherpa
  private asyncBroken = false

  constructor(
    engine: 'offline-transducer' | 'offline-whisper' | 'offline-nemo-ctc',
    paths: { encoder?: string; decoder?: string; joiner?: string; model?: string; tokens?: string },
    language: 'ru' | 'en' | 'auto',
    numThreads: number,
  ) {
    const s = loadSherpa()
    const modelConfig: Record<string, unknown> = {
      tokens: paths.tokens,
      numThreads,
      provider: 'cpu',
      debug: 0,
    }
    if (engine === 'offline-whisper')
      modelConfig.whisper = {
        encoder: paths.encoder,
        decoder: paths.decoder,
        language: language === 'auto' ? '' : language,
        task: 'transcribe',
        tailPaddings: -1,
      }
    else if (engine === 'offline-transducer')
      modelConfig.transducer = {
        encoder: paths.encoder,
        decoder: paths.decoder,
        joiner: paths.joiner,
      }
    else modelConfig.nemoCtc = { model: paths.model }
    this.recognizer = new s.OfflineRecognizer({
      featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
      modelConfig,
      decodingMethod: 'greedy_search',
    })
  }

  async finalize(segment: Float32Array | null): Promise<string> {
    if (!segment || segment.length < SAMPLE_RATE * 0.2) return ''
    const stream = this.recognizer.createStream()
    stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples: segment })
    if (!this.asyncBroken && typeof this.recognizer.decodeAsync === 'function') {
      try {
        await this.recognizer.decodeAsync(stream)
      } catch {
        this.asyncBroken = true
        this.recognizer.decode(stream)
      }
    } else this.recognizer.decode(stream)
    return String((this.recognizer.getResult(stream) as { text: string }).text ?? '').trim()
  }

  reset(): void {
    /* stateless */
  }
}

export class PiperTts {
  private tts: Sherpa
  readonly sampleRate: number

  constructor(paths: { model?: string; tokens?: string; dataDir?: string }, numThreads: number) {
    const s = loadSherpa()
    this.tts = new s.OfflineTts({
      model: {
        vits: {
          model: paths.model,
          tokens: paths.tokens,
          dataDir: paths.dataDir ?? '',
          noiseScale: 0.667,
          noiseScaleW: 0.8,
          lengthScale: 1.0,
        },
        numThreads,
        debug: 0,
        provider: 'cpu',
      },
      maxNumSentences: 1,
    })
    this.sampleRate = Number(this.tts.sampleRate) || 22050
  }

  private asyncBroken = false

  async synthesize(
    text: string,
    speed: number,
  ): Promise<{ samples: Float32Array; sampleRate: number }> {
    // enableExternalBuffer=false: Electron forbids N-API external ArrayBuffers.
    const req = { text, sid: 0, speed, enableExternalBuffer: false }
    let res: { samples: Float32Array; sampleRate: number }
    if (!this.asyncBroken && typeof this.tts.generateAsync === 'function') {
      try {
        res = await this.tts.generateAsync(req)
      } catch (err) {
        // The N-API async path is not available in every host (e.g. Electron utility processes); fall back to sync.
        this.asyncBroken = true
        process.stderr.write(
          `[voice-worker] async TTS unavailable (${(err as Error).message}); using sync synthesis\n`,
        )
        res = this.tts.generate(req)
      }
    } else res = this.tts.generate(req)
    return {
      samples: res.samples as Float32Array,
      sampleRate: Number(res.sampleRate) || this.sampleRate,
    }
  }
}

export interface BuiltEngines {
  vad: VadEngine
  stt: SttEngine
  wake: WakeEngine | null
  tts: PiperTts | null
  warnings: string[]
}

export function buildEngines(models: WorkerModelConfig, settings: WorkerSettings): BuiltEngines {
  const warnings: string[] = []
  if (!models.vad?.model || !existsSync(models.vad.model)) throw new Error('VAD model is missing')
  if (!models.stt) throw new Error('STT model is missing')
  const threads = Math.max(1, settings.numThreads)
  const vad = new SileroVad(models.vad.model, { silenceMs: settings.silenceMs })
  let stt: SttEngine
  if (models.stt.engine === 'online-transducer')
    stt = new OnlineTransducerStt(models.stt.paths, threads)
  else stt = new OfflineStt(models.stt.engine, models.stt.paths, models.stt.language, threads)

  let wake: WakeEngine | null = null
  if (settings.wakeWordEnabled) {
    if (settings.wakeWordStrategy === 'kws' && models.kws?.tokens) {
      const kws = new KwsWake(models.kws, settings.keywords, settings.wakeWordSensitivity, 1)
      if (kws.unresolved.length)
        warnings.push(`wake-word spellings not in vocabulary: ${kws.unresolved.join(', ')}`)
      wake = kws
    } else if (stt instanceof OnlineTransducerStt) {
      wake = new TranscriptWake(new OnlineTransducerStt(models.stt.paths, 1), settings.keywords)
    } else {
      warnings.push('transcript wake-word needs a streaming STT model; wake word disabled')
    }
  }
  const tts = models.tts?.paths.model ? new PiperTts(models.tts.paths, threads) : null
  return { vad, stt, wake, tts, warnings }
}
