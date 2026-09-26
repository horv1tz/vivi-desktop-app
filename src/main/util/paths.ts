import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'

export function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true })
  return dir
}

export const paths = {
  get userData(): string {
    return app.getPath('userData')
  },
  /** Isolated Claude Code config dir (credentials, sessions) so Vivi never mixes with the user's own CLI install. */
  get claudeConfigDir(): string {
    return ensureDir(join(app.getPath('userData'), 'claude'))
  },
  get modelsDir(): string {
    return ensureDir(join(app.getPath('userData'), 'models'))
  },
  get logsDir(): string {
    return app.getPath('logs')
  },
  get defaultWorkspace(): string {
    return join(homedir(), 'Vivi')
  },
  get home(): string {
    return homedir()
  },
  workspace(configured: string): string {
    return ensureDir(configured.trim() || paths.defaultWorkspace)
  },
  memoryDir(workspace: string): string {
    return ensureDir(join(workspace, 'memory'))
  },
  memoryFile(workspace: string): string {
    return join(paths.memoryDir(workspace), 'VIVI.md')
  },
}
