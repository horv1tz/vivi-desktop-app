import { chmodSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { logger } from '../logging/log'

const log = logger('claude-bin')

/**
 * Resolves the Claude Code executable to hand to the Agent SDK.
 * - VIVI_CLAUDE_BIN env var wins (useful for tests and for reusing an installed CLI).
 * - Packaged app: resources/claude-bin/claude[.exe] copied there by scripts/after-pack.cjs.
 * - Dev: undefined → the SDK resolves the binary from its platform package itself.
 */
export function resolveClaudeBinary(): string | undefined {
  const override = process.env.VIVI_CLAUDE_BIN
  if (override) {
    if (existsSync(override)) return override
    log.warn(`VIVI_CLAUDE_BIN=${override} does not exist, ignoring`)
  }
  if (!app.isPackaged) return undefined
  const bin = process.platform === 'win32' ? 'claude.exe' : 'claude'
  const candidate = join(process.resourcesPath, 'claude-bin', bin)
  if (!existsSync(candidate)) {
    log.error(`Claude Code binary missing at ${candidate}`)
    return undefined
  }
  if (process.platform !== 'win32') {
    try {
      const mode = statSync(candidate).mode & 0o777
      if ((mode & 0o111) === 0) chmodSync(candidate, 0o755)
    } catch (err) {
      log.warn('could not chmod claude binary', err)
    }
  }
  return candidate
}

export function describeClaudeBinary(): string | null {
  const explicit = resolveClaudeBinary()
  if (explicit) return explicit
  try {
    // Dev mode: report where the SDK's platform package lives, purely informational.
    const pkg = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`
    const bin = process.platform === 'win32' ? 'claude.exe' : 'claude'
    const p = join(app.getAppPath(), 'node_modules', pkg, bin)
    return existsSync(p) ? p : null
  } catch {
    return null
  }
}
