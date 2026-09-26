/**
 * Builds a sherpa-onnx keywords file for a BPE keyword-spotting model without running sentencepiece:
 * each keyword is spelled with pieces from tokens.txt using greedy longest-match, and several
 * alternative spellings are emitted so the spotter has more than one path to the same keyword.
 */
export function loadTokens(tokensTxt: string): Set<string> {
  const set = new Set<string>()
  for (const line of tokensTxt.split(/\r?\n/)) {
    const piece = line.trim().split(/\s+/)[0]
    if (piece) set.add(piece)
  }
  return set
}

/** Greedy longest-match tokenization of one word into BPE pieces (`▁` marks a word start). */
export function tokenizeWord(word: string, vocab: Set<string>): string[] | null {
  const upper = word.toUpperCase()
  const cased = vocab.has('▁THE') || [...vocab].some((p) => /^▁[A-Z]+$/.test(p)) ? upper : word.toLowerCase()
  const target = `▁${cased}`
  const pieces: string[] = []
  let i = 0
  while (i < target.length) {
    let found = ''
    for (let j = target.length; j > i; j--) {
      const cand = target.slice(i, j)
      if (vocab.has(cand)) {
        found = cand
        break
      }
    }
    if (!found) {
      // Word-initial marker may not combine with the first letter; try without it.
      if (i === 0 && target.startsWith('▁') && vocab.has('▁')) {
        pieces.push('▁')
        i = 1
        continue
      }
      return null
    }
    pieces.push(found)
    i += found.length
  }
  return pieces
}

export function tokenizePhrase(phrase: string, vocab: Set<string>): string[] | null {
  const out: string[] = []
  for (const w of phrase.trim().split(/\s+/)) {
    const t = tokenizeWord(w, vocab)
    if (!t) return null
    out.push(...t)
  }
  return out
}

/** Phonetic spellings that approximate how a Russian speaker says «Виви». */
export function keywordVariants(keyword: string): string[] {
  const k = keyword.trim().toLowerCase()
  if (k === 'vivi' || k === 'виви') return ['vivi', 'vee vee', 'veevee', 'vivie', 'vivvy', 'wivi']
  if (k === 'hey vivi' || k === 'эй виви') return ['hey vivi', 'hey vee vee', 'hey veevee', 'hey vivie']
  return [k]
}

export function buildKeywordsFile(keywords: string[], tokensTxt: string, boost = 1.5, threshold = 0.25): { content: string; unresolved: string[] } {
  const vocab = loadTokens(tokensTxt)
  const lines: string[] = []
  const unresolved: string[] = []
  const seen = new Set<string>()
  for (const kw of keywords) {
    const canonical = kw.trim().toLowerCase().replace(/\s+/g, '_')
    for (const variant of keywordVariants(kw)) {
      const pieces = tokenizePhrase(variant, vocab)
      if (!pieces) {
        unresolved.push(variant)
        continue
      }
      const line = `${pieces.join(' ')} :${boost} #${threshold} @${canonical}`
      if (!seen.has(line)) {
        seen.add(line)
        lines.push(line)
      }
    }
  }
  return { content: lines.join('\n') + '\n', unresolved }
}

/** Transcript-based wake detection: normalized fuzzy match of the wake word inside partial text. */
export function matchesWakeWord(text: string, keywords: string[] = ['виви', 'vivi']): boolean {
  const norm = text.toLowerCase().replace(/[^a-zа-яё\s]/gi, ' ').replace(/\s+/g, ' ').trim()
  if (!norm) return false
  const words = norm.split(' ')
  for (const kw of keywords) {
    const target = kw.toLowerCase()
    for (const w of words) {
      if (w === target || levenshtein(w, target) <= (target.length > 4 ? 2 : 1)) return true
    }
    // Two-word phrases (e.g. "hey vivi")
    if (target.includes(' ') && norm.includes(target)) return true
  }
  return false
}

export function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp = new Array<number>(n + 1)
  for (let j = 0; j <= n; j++) dp[j] = j
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]!
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]!
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return dp[n]!
}
