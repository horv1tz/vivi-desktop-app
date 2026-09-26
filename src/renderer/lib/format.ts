export function formatUsd(v: number): string {
  if (v === 0) return '$0.00'
  if (v < 0.01) return `$${v.toFixed(4)}`
  return `$${v.toFixed(2)}`
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} KB`
  return `${n} B`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

export function relativeTime(ts: number, locale: string): string {
  const diff = Date.now() - ts
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const min = Math.round(diff / 60_000)
  if (Math.abs(min) < 60) return rtf.format(-min, 'minute')
  const h = Math.round(min / 60)
  if (Math.abs(h) < 24) return rtf.format(-h, 'hour')
  return rtf.format(-Math.round(h / 24), 'day')
}
