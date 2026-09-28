// ---------- Voice model registry (sherpa-onnx assets from the k2-fsa GitHub releases) ----------

export type ModelKind = 'stt' | 'tts' | 'vad' | 'kws'
export type SttEngine =
  'online-transducer' | 'offline-transducer' | 'offline-whisper' | 'offline-nemo-ctc'

export interface ModelFiles {
  /** Relative to the extracted model directory. */
  encoder?: string
  decoder?: string
  joiner?: string
  model?: string
  tokens: string
  dataDir?: string
}

export interface VoiceModel {
  id: string
  kind: ModelKind
  name: string
  /** ISO 639-1 language or 'multi'. */
  language: 'ru' | 'en' | 'multi'
  sizeMb: number
  /** Download URL (tar.bz2 archive or a single .onnx file). */
  url: string
  /**
   * VO-08: SHA-256 of the raw downloaded bytes at `url` (the archive itself, before
   * decompression, for tar.bz2 models), hex-encoded. A model without one skips verification
   * (unchanged from previous behavior) rather than failing closed — most entries below don't have
   * a pinned hash yet; add one whenever a model's checksum has actually been verified against the
   * upstream release.
   */
  sha256?: string
  /** Directory name created after extraction (for archives). */
  dir: string
  engine?: SttEngine
  files: ModelFiles
  description?: string
  recommended?: boolean
}

const ASR = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models'
const TTS = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models'
const KWS = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models'

export const VOICE_MODELS: VoiceModel[] = [
  // ---- VAD ----
  {
    id: 'vad-silero-v5',
    kind: 'vad',
    name: 'Silero VAD v5',
    language: 'multi',
    sizeMb: 2.3,
    url: `${ASR}/silero_vad_v5.onnx`,
    sha256: '6b99cbfd39246b6706f98ec13c7c50c6b299181f2474fa05cbc8046acc274396',
    dir: 'silero_vad_v5',
    files: { model: 'silero_vad_v5.onnx', tokens: '' },
    recommended: true,
  },
  // ---- STT Russian ----
  {
    id: 'stt-zipformer-small-ru',
    kind: 'stt',
    name: 'Zipformer small RU (streaming, Vosk)',
    language: 'ru',
    sizeMb: 23,
    url: `${ASR}/sherpa-onnx-streaming-zipformer-small-ru-vosk-int8-2025-08-16.tar.bz2`,
    dir: 'sherpa-onnx-streaming-zipformer-small-ru-vosk-int8-2025-08-16',
    engine: 'online-transducer',
    files: {
      encoder: 'encoder.int8.onnx',
      decoder: 'decoder.onnx',
      joiner: 'joiner.int8.onnx',
      tokens: 'tokens.txt',
    },
    description: 'Fast streaming Russian recognition with live partial results.',
    recommended: true,
  },
  {
    id: 'stt-zipformer-ru',
    kind: 'stt',
    name: 'Zipformer RU (offline, higher accuracy)',
    language: 'ru',
    sizeMb: 60,
    url: `${ASR}/sherpa-onnx-zipformer-ru-int8-2025-04-20.tar.bz2`,
    dir: 'sherpa-onnx-zipformer-ru-int8-2025-04-20',
    engine: 'offline-transducer',
    files: {
      encoder: 'encoder.int8.onnx',
      decoder: 'decoder.onnx',
      joiner: 'joiner.int8.onnx',
      tokens: 'tokens.txt',
    },
    description: 'Decodes each utterance after you stop speaking; more accurate.',
  },
  {
    id: 'stt-gigaam-v2-ru',
    kind: 'stt',
    name: 'GigaAM v2 RU (offline, best accuracy)',
    language: 'ru',
    sizeMb: 159,
    url: `${ASR}/sherpa-onnx-nemo-ctc-giga-am-v2-russian-2025-04-19.tar.bz2`,
    dir: 'sherpa-onnx-nemo-ctc-giga-am-v2-russian-2025-04-19',
    engine: 'offline-nemo-ctc',
    files: { model: 'model.int8.onnx', tokens: 'tokens.txt' },
    description: 'Sber GigaAM v2 CTC; the most accurate Russian model here.',
  },
  // ---- STT English ----
  {
    id: 'stt-zipformer-en',
    kind: 'stt',
    name: 'Zipformer EN (streaming)',
    language: 'en',
    sizeMb: 310,
    url: `${ASR}/sherpa-onnx-streaming-zipformer-en-2023-06-26.tar.bz2`,
    dir: 'sherpa-onnx-streaming-zipformer-en-2023-06-26',
    engine: 'online-transducer',
    files: {
      encoder: 'encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx',
      decoder: 'decoder-epoch-99-avg-1-chunk-16-left-128.onnx',
      joiner: 'joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx',
      tokens: 'tokens.txt',
    },
    description: 'Streaming English recognition with partial results.',
    recommended: true,
  },
  // ---- STT multilingual ----
  {
    id: 'stt-whisper-tiny',
    kind: 'stt',
    name: 'Whisper tiny (multilingual, fastest)',
    language: 'multi',
    sizeMb: 111,
    url: `${ASR}/sherpa-onnx-whisper-tiny.tar.bz2`,
    sha256: 'c46116994e539aa165266d96b325252728429c12535eb9d8b6a2b10f129e66b1',
    dir: 'sherpa-onnx-whisper-tiny',
    engine: 'offline-whisper',
    files: {
      encoder: 'tiny-encoder.int8.onnx',
      decoder: 'tiny-decoder.int8.onnx',
      tokens: 'tiny-tokens.txt',
    },
    description: 'Smallest, fastest multilingual model; lower accuracy — good for weaker CPUs.',
  },
  {
    id: 'stt-whisper-base',
    kind: 'stt',
    name: 'Whisper base (multilingual)',
    language: 'multi',
    sizeMb: 208,
    url: `${ASR}/sherpa-onnx-whisper-base.tar.bz2`,
    dir: 'sherpa-onnx-whisper-base',
    engine: 'offline-whisper',
    files: {
      encoder: 'base-encoder.int8.onnx',
      decoder: 'base-decoder.int8.onnx',
      tokens: 'base-tokens.txt',
    },
    description: 'Auto-detects the language; good for mixed RU/EN.',
  },
  {
    id: 'stt-whisper-small',
    kind: 'stt',
    name: 'Whisper small (multilingual, more accurate)',
    language: 'multi',
    sizeMb: 610,
    url: `${ASR}/sherpa-onnx-whisper-small.tar.bz2`,
    dir: 'sherpa-onnx-whisper-small',
    engine: 'offline-whisper',
    files: {
      encoder: 'small-encoder.int8.onnx',
      decoder: 'small-decoder.int8.onnx',
      tokens: 'small-tokens.txt',
    },
    description: 'More accurate than base, still well short of turbo’s size.',
  },
  {
    id: 'stt-whisper-turbo',
    kind: 'stt',
    name: 'Whisper large-v3 turbo (multilingual, best quality)',
    language: 'multi',
    sizeMb: 564,
    url: `${ASR}/sherpa-onnx-whisper-turbo.tar.bz2`,
    dir: 'sherpa-onnx-whisper-turbo',
    engine: 'offline-whisper',
    files: {
      encoder: 'turbo-encoder.int8.onnx',
      decoder: 'turbo-decoder.int8.onnx',
      tokens: 'turbo-tokens.txt',
    },
    description: 'Highest quality multilingual model; needs a fast CPU.',
  },
  // ---- TTS ----
  {
    id: 'tts-piper-ru-irina',
    kind: 'tts',
    name: 'Irina (RU, female)',
    language: 'ru',
    sizeMb: 67,
    url: `${TTS}/vits-piper-ru_RU-irina-medium.tar.bz2`,
    dir: 'vits-piper-ru_RU-irina-medium',
    files: { model: 'ru_RU-irina-medium.onnx', tokens: 'tokens.txt', dataDir: 'espeak-ng-data' },
    recommended: true,
  },
  {
    id: 'tts-piper-ru-denis',
    kind: 'tts',
    name: 'Denis (RU, male)',
    language: 'ru',
    sizeMb: 64,
    url: `${TTS}/vits-piper-ru_RU-denis-medium.tar.bz2`,
    dir: 'vits-piper-ru_RU-denis-medium',
    files: { model: 'ru_RU-denis-medium.onnx', tokens: 'tokens.txt', dataDir: 'espeak-ng-data' },
  },
  {
    id: 'tts-piper-ru-dmitri',
    kind: 'tts',
    name: 'Dmitri (RU, male)',
    language: 'ru',
    sizeMb: 64,
    url: `${TTS}/vits-piper-ru_RU-dmitri-medium.tar.bz2`,
    dir: 'vits-piper-ru_RU-dmitri-medium',
    files: { model: 'ru_RU-dmitri-medium.onnx', tokens: 'tokens.txt', dataDir: 'espeak-ng-data' },
  },
  {
    id: 'tts-piper-ru-ruslan',
    kind: 'tts',
    name: 'Ruslan (RU, male)',
    language: 'ru',
    sizeMb: 64,
    url: `${TTS}/vits-piper-ru_RU-ruslan-medium.tar.bz2`,
    dir: 'vits-piper-ru_RU-ruslan-medium',
    files: { model: 'ru_RU-ruslan-medium.onnx', tokens: 'tokens.txt', dataDir: 'espeak-ng-data' },
  },
  {
    id: 'tts-piper-en-lessac',
    kind: 'tts',
    name: 'Lessac (EN-US, male)',
    language: 'en',
    sizeMb: 67,
    url: `${TTS}/vits-piper-en_US-lessac-medium.tar.bz2`,
    dir: 'vits-piper-en_US-lessac-medium',
    files: { model: 'en_US-lessac-medium.onnx', tokens: 'tokens.txt', dataDir: 'espeak-ng-data' },
    recommended: true,
  },
  {
    id: 'tts-piper-en-amy',
    kind: 'tts',
    name: 'Amy (EN-US, female)',
    language: 'en',
    sizeMb: 64,
    url: `${TTS}/vits-piper-en_US-amy-medium.tar.bz2`,
    dir: 'vits-piper-en_US-amy-medium',
    files: { model: 'en_US-amy-medium.onnx', tokens: 'tokens.txt', dataDir: 'espeak-ng-data' },
  },
  {
    id: 'tts-piper-en-kristin',
    kind: 'tts',
    name: 'Kristin (EN-US, female)',
    language: 'en',
    sizeMb: 64,
    url: `${TTS}/vits-piper-en_US-kristin-medium.tar.bz2`,
    sha256: 'c2206f572df2956c50b1ae3367eebce3853c663e890cba8048cd62b1e4dbe6c7',
    dir: 'vits-piper-en_US-kristin-medium',
    files: { model: 'en_US-kristin-medium.onnx', tokens: 'tokens.txt', dataDir: 'espeak-ng-data' },
  },
  {
    id: 'tts-piper-en-norman',
    kind: 'tts',
    name: 'Norman (EN-US, male)',
    language: 'en',
    sizeMb: 64,
    url: `${TTS}/vits-piper-en_US-norman-medium.tar.bz2`,
    dir: 'vits-piper-en_US-norman-medium',
    files: { model: 'en_US-norman-medium.onnx', tokens: 'tokens.txt', dataDir: 'espeak-ng-data' },
  },
  {
    id: 'tts-piper-en-joe',
    kind: 'tts',
    name: 'Joe (EN-US, male)',
    language: 'en',
    sizeMb: 64,
    url: `${TTS}/vits-piper-en_US-joe-medium.tar.bz2`,
    dir: 'vits-piper-en_US-joe-medium',
    files: { model: 'en_US-joe-medium.onnx', tokens: 'tokens.txt', dataDir: 'espeak-ng-data' },
  },
  {
    id: 'tts-piper-en-hfc-female',
    kind: 'tts',
    name: 'HFC female (EN-US)',
    language: 'en',
    sizeMb: 64,
    url: `${TTS}/vits-piper-en_US-hfc_female-medium.tar.bz2`,
    dir: 'vits-piper-en_US-hfc_female-medium',
    files: {
      model: 'en_US-hfc_female-medium.onnx',
      tokens: 'tokens.txt',
      dataDir: 'espeak-ng-data',
    },
  },
  {
    id: 'tts-piper-en-gb-alan',
    kind: 'tts',
    name: 'Alan (EN-GB, male)',
    language: 'en',
    sizeMb: 64,
    url: `${TTS}/vits-piper-en_GB-alan-medium.tar.bz2`,
    sha256: 'a48d4017da0f77668b27bed63fe6e04dd64c6397e1fadad4f460efb0ef7c9012',
    dir: 'vits-piper-en_GB-alan-medium',
    files: { model: 'en_GB-alan-medium.onnx', tokens: 'tokens.txt', dataDir: 'espeak-ng-data' },
    description: 'British English accent, distinct from the EN-US voices above.',
  },
  // ---- Keyword spotting (wake word) ----
  {
    id: 'kws-zipformer-en',
    kind: 'kws',
    name: 'Wake-word spotter (EN BPE, Gigaspeech)',
    language: 'en',
    sizeMb: 18,
    url: `${KWS}/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2`,
    dir: 'sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01',
    files: {
      encoder: 'encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
      decoder: 'decoder-epoch-12-avg-2-chunk-16-left-64.onnx',
      joiner: 'joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
      tokens: 'tokens.txt',
    },
    description: 'Detects “Vivi” / “hey Vivi” with a tiny always-on model.',
    recommended: true,
  },
]

export function modelById(id: string): VoiceModel | undefined {
  return VOICE_MODELS.find((m) => m.id === id)
}

/** Default STT model id for a language setting. */
export function defaultSttModel(language: 'ru' | 'en' | 'auto'): string {
  if (language === 'ru') return 'stt-zipformer-small-ru'
  if (language === 'en') return 'stt-zipformer-en'
  return 'stt-whisper-base'
}

export function defaultTtsVoice(language: 'ru' | 'en' | 'auto'): string {
  return language === 'en' ? 'tts-piper-en-lessac' : 'tts-piper-ru-irina'
}

/** Models required for the given voice settings (all must be installed before voice starts). */
export function requiredModels(opts: {
  sttModel: string
  ttsVoice: string
  wakeWordEnabled: boolean
  wakeWordStrategy: 'kws' | 'transcript'
}): string[] {
  const ids = ['vad-silero-v5', opts.sttModel, opts.ttsVoice]
  if (opts.wakeWordEnabled && opts.wakeWordStrategy === 'kws') ids.push('kws-zipformer-en')
  return [...new Set(ids)].filter((id) => modelById(id))
}
