/**
 * Splits streamed assistant text into speakable sentences as soon as they complete.
 * Markdown is stripped (code blocks skipped entirely) so TTS never reads symbols aloud.
 */
export interface Chunk {
  seq: number
  text: string
}

const MIN_CHARS = 20

export function stripMarkdown(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\|/g, ' ')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)([^*_\n]+?)\1/g, '$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/https?:\/\/\S+/g, (m) => {
      try {
        return new URL(m).hostname
      } catch {
        return ''
      }
    })
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

/** Index just past each sentence boundary: a terminator followed by whitespace, or a newline. */
function boundaries(text: string): number[] {
  const out: number[] = []
  const re = /[.!?…]+["»”)\]]*(?=\s)|\n/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) out.push(m.index + m[0].length)
  return out
}

export class SentenceChunker {
  private buffer = ''
  private pending = ''
  private seq = 0

  /** Feed a text delta; returns the sentences that became complete. */
  push(delta: string): Chunk[] {
    this.buffer += delta
    // Remove completed code fences; hold text from an unterminated fence.
    let hold = ''
    for (;;) {
      const fence = this.buffer.indexOf('```')
      if (fence === -1) break
      const close = this.buffer.indexOf('```', fence + 3)
      if (close === -1) {
        hold = this.buffer.slice(fence)
        this.buffer = this.buffer.slice(0, fence)
        break
      }
      this.buffer = `${this.buffer.slice(0, fence)} ${this.buffer.slice(close + 3)}`
    }
    const out = this.extract(false)
    this.buffer += hold
    return out
  }

  private extract(final: boolean): Chunk[] {
    const out: Chunk[] = []
    const cuts = boundaries(this.buffer)
    let start = 0
    for (const cut of cuts) {
      const piece = stripMarkdown(this.buffer.slice(start, cut))
      start = cut
      if (!piece) continue
      this.pending = this.pending ? `${this.pending} ${piece}` : piece
      if (this.pending.length >= MIN_CHARS) {
        out.push({ seq: this.seq++, text: this.pending })
        this.pending = ''
      }
    }
    this.buffer = this.buffer.slice(start)
    if (final) {
      const rest = stripMarkdown(this.buffer)
      this.buffer = ''
      const text = [this.pending, rest].filter(Boolean).join(' ')
      this.pending = ''
      if (text) out.push({ seq: this.seq++, text })
    }
    return out
  }

  /** Emit whatever is left (end of message). */
  flush(): Chunk[] {
    this.buffer = this.buffer.replace(/```[\s\S]*$/, ' ')
    return this.extract(true)
  }

  reset(): void {
    this.buffer = ''
    this.pending = ''
    this.seq = 0
  }
}
