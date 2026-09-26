import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const HEADER = `# VIVI.md — memory about the user\n\nVivi appends durable facts and preferences here. Edit freely; keep it short.\n\n`

export function ensureMemoryFile(file: string): void {
  if (existsSync(file)) return
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, HEADER, 'utf8')
}

export function rememberFact(file: string, fact: string, category?: string): string {
  ensureMemoryFile(file)
  const line = `- ${category ? `[${category}] ` : ''}${fact.trim().replace(/\s+/g, ' ')} _(${new Date().toISOString().slice(0, 10)})_\n`
  const existing = readFileSync(file, 'utf8')
  if (existing.includes(line.trim())) return 'already remembered'
  appendFileSync(file, line, 'utf8')
  return `remembered: ${fact.trim()}`
}

export function readMemory(file: string): string {
  return existsSync(file) ? readFileSync(file, 'utf8') : ''
}
