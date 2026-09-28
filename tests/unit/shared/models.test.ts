import { describe, expect, it } from 'vitest'
import { modelById, requiredModels, VOICE_MODELS } from '../../../src/shared/models'

describe('VOICE_MODELS registry', () => {
  it('has unique ids', () => {
    const ids = VOICE_MODELS.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('resolves every entry by id via modelById', () => {
    for (const m of VOICE_MODELS) expect(modelById(m.id)).toBe(m)
  })

  it('every entry has a non-empty url, dir and positive sizeMb', () => {
    for (const m of VOICE_MODELS) {
      expect(m.url).toMatch(/^https:\/\//)
      expect(m.dir.length).toBeGreaterThan(0)
      expect(m.sizeMb).toBeGreaterThan(0)
    }
  })

  // VO-12: newly added local model choices — a typo in the id/url/files here would silently make
  // a Settings dropdown option download-then-fail, which requiredModels()/modelById() alone can't
  // catch since they only check the registry is internally consistent, not that it matches what
  // ships upstream (that part was verified by hand against the real k2-fsa releases before adding).
  it.each([
    'stt-whisper-tiny',
    'stt-whisper-small',
    'tts-piper-en-kristin',
    'tts-piper-en-norman',
    'tts-piper-en-joe',
    'tts-piper-en-hfc-female',
    'tts-piper-en-gb-alan',
  ])('includes %s', (id) => {
    expect(modelById(id)).toBeDefined()
  })

  it('whisper-tiny and whisper-small use the offline-whisper engine with matching file names', () => {
    const tiny = modelById('stt-whisper-tiny')!
    expect(tiny.engine).toBe('offline-whisper')
    expect(tiny.files.encoder).toBe('tiny-encoder.int8.onnx')
    expect(tiny.files.decoder).toBe('tiny-decoder.int8.onnx')
    expect(tiny.files.tokens).toBe('tiny-tokens.txt')

    const small = modelById('stt-whisper-small')!
    expect(small.engine).toBe('offline-whisper')
    expect(small.files.encoder).toBe('small-encoder.int8.onnx')
  })

  it('the new Piper voices follow the same {locale}-{speaker}-medium.onnx + espeak-ng-data layout as the existing ones', () => {
    for (const id of [
      'tts-piper-en-kristin',
      'tts-piper-en-norman',
      'tts-piper-en-joe',
      'tts-piper-en-hfc-female',
      'tts-piper-en-gb-alan',
    ]) {
      const m = modelById(id)!
      expect(m.kind).toBe('tts')
      expect(m.files.model).toMatch(/\.onnx$/)
      expect(m.files.tokens).toBe('tokens.txt')
      expect(m.files.dataDir).toBe('espeak-ng-data')
    }
  })

  it('the en_GB voice is tagged a distinct accent from the en_US ones in its description', () => {
    expect(modelById('tts-piper-en-gb-alan')?.description).toMatch(/British/)
  })
})

describe('requiredModels (VO-12 registry additions)', () => {
  it('still resolves every id it returns for the new whisper/piper defaults', () => {
    const ids = requiredModels({
      sttModel: 'stt-whisper-small',
      ttsVoice: 'tts-piper-en-gb-alan',
      wakeWordEnabled: true,
      wakeWordStrategy: 'kws',
    })
    for (const id of ids) expect(modelById(id)).toBeDefined()
    expect(ids).toContain('stt-whisper-small')
    expect(ids).toContain('tts-piper-en-gb-alan')
  })
})
