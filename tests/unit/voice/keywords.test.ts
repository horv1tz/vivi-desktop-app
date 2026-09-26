import { describe, expect, it } from 'vitest'
import { buildKeywordsFile, levenshtein, matchesWakeWord, tokenizeWord } from '../../../src/voice-worker/keywords'

const tokens = ['<blk>', '▁', '▁HE', 'Y', '▁HEY', '▁V', 'I', 'V', '▁VI', 'VI', 'E', '▁VE', 'VE', '▁W', 'W', '▁WI', 'Y', 'EE', '▁VEE'].map((t, i) => `${t} ${i}`).join('\n')

describe('keywords', () => {
  it('tokenizes words greedily with BPE pieces', () => {
    const vocab = new Set(['▁HE', 'Y', '▁VI', 'VI', 'I', 'V'])
    expect(tokenizeWord('vivi', vocab)).toEqual(['▁VI', 'VI'])
    expect(tokenizeWord('hey', vocab)).toEqual(['▁HE', 'Y'])
    expect(tokenizeWord('xyz', vocab)).toBeNull()
  })

  it('builds a keywords file with variants and reports unresolved spellings', () => {
    const { content, unresolved } = buildKeywordsFile(['vivi', 'hey vivi'], tokens, 2, 0.2)
    expect(content).toContain('▁VI VI :2 #0.2 @vivi')
    expect(content).toContain('▁HEY ▁VI VI :2 #0.2 @hey_vivi')
    expect(Array.isArray(unresolved)).toBe(true)
    const small = buildKeywordsFile(['vivi'], ['▁VI 0', 'VI 1'].join('\n'), 2, 0.2)
    expect(small.content).toBe('▁VI VI :2 #0.2 @vivi\n')
    expect(small.unresolved.length).toBeGreaterThan(0)
  })

  it('matches wake words in transcripts with typos', () => {
    expect(matchesWakeWord('окей виви открой почту')).toBe(true)
    expect(matchesWakeWord('vivy what time is it')).toBe(true)
    expect(matchesWakeWord('привет как дела')).toBe(false)
    expect(levenshtein('виви', 'вивы')).toBe(1)
  })
})
