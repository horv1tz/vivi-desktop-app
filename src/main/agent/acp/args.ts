/** Splits a command line the way a POSIX shell would for the simple cases: whitespace-separated, single/double quotes, backslash escapes. */
export function splitArgs(input: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  let has = false
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!
    if (quote) {
      if (c === quote) quote = null
      else if (c === '\\' && quote === '"' && i + 1 < input.length) cur += input[++i]
      else cur += c
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      has = true
      continue
    }
    if (c === '\\' && i + 1 < input.length) {
      cur += input[++i]
      has = true
      continue
    }
    if (/\s/.test(c)) {
      if (has || cur) out.push(cur)
      cur = ''
      has = false
      continue
    }
    cur += c
    has = true
  }
  if (has || cur) out.push(cur)
  return out
}
