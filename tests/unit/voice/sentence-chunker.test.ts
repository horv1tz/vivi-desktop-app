import { describe, expect, it } from 'vitest'
import { SentenceChunker, stripMarkdown } from '../../../src/main/voice/sentence-chunker'

describe('SentenceChunker', () => {
  it('emits complete sentences as they stream in and flushes the rest', () => {
    const c = new SentenceChunker()
    const out = [...c.push('Привет! Я нашла три файла в папке. Первый называ'), ...c.push('ется notes.md, второй — plan.txt.'), ...c.flush()]
    expect(out.map((x) => x.text)).toEqual(['Привет! Я нашла три файла в папке.', 'Первый называется notes.md, второй — plan.txt.'])
    expect(out.map((x) => x.seq)).toEqual([0, 1])
  })

  it('does not split on decimals and skips code blocks', () => {
    const c = new SentenceChunker()
    const out = [...c.push('Версия 3.5 установлена. Вот команда:\n```bash\nnpm test\n```\nГотово, можно запускать.'), ...c.flush()]
    const text = out.map((x) => x.text).join(' | ')
    expect(text).toContain('Версия 3.5 установлена.')
    expect(text).not.toContain('npm test')
    expect(text).toContain('Готово, можно запускать.')
  })

  it('strips markdown for speech', () => {
    expect(stripMarkdown('**Bold** and `code` with [link](https://example.com/x) and\n- item')).toBe('Bold and code with link and\nitem')
  })

  it('flush returns nothing when empty', () => {
    const c = new SentenceChunker()
    expect(c.flush()).toEqual([])
  })
})
