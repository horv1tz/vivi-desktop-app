/**
 * Splits a command line into arguments.
 * - POSIX (default): whitespace-separated, single/double quotes, backslash escapes.
 * - win32: Microsoft C runtime rules — only double quotes group, backslashes are literal unless they
 *   precede a double quote (2n backslashes + quote → n backslashes and a quote toggle; 2n+1 → n
 *   backslashes and a literal quote), so `C:\\Program Files\\x` survives unquoted.
 */
export function splitArgs(input: string, platform: NodeJS.Platform = process.platform): string[] {
  return platform === 'win32' ? splitWindows(input) : splitPosix(input)
}

function splitPosix(input: string): string[] {
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

function splitWindows(input: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  let has = false
  let i = 0
  while (i < input.length) {
    const c = input[i]!
    if (c === '\\') {
      let n = 0
      while (input[i] === '\\') {
        n++
        i++
      }
      if (input[i] === '"') {
        cur += '\\'.repeat(Math.floor(n / 2))
        if (n % 2 === 1) {
          cur += '"'
          i++
        }
        // even count: the quote is handled by the next iteration as a toggle
      } else {
        cur += '\\'.repeat(n)
      }
      has = true
      continue
    }
    if (c === '"') {
      inQuotes = !inQuotes
      has = true
      i++
      continue
    }
    if (!inQuotes && /\s/.test(c)) {
      if (has || cur) out.push(cur)
      cur = ''
      has = false
      i++
      continue
    }
    cur += c
    has = true
    i++
  }
  if (has || cur) out.push(cur)
  return out
}
