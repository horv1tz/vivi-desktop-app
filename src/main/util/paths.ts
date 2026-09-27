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
  /** OBS-01: local-only crash dumps (crashReporter is started with uploadToServer: false). */
  get crashesDir(): string {
    return app.getPath('crashDumps')
  },
  /** AG-02: "what did Vivi do" action journal. */
  get journalFile(): string {
    return join(ensureDir(join(app.getPath('userData'), 'journal')), 'journal.json')
  },
  /** UX-08: saved main-window size/position/maximized state, restored across restarts. */
  get windowStateFile(): string {
    return join(app.getPath('userData'), 'window-state.json')
  },
  /** OBS-02: per-turn cost/token usage, local only, never uploaded. */
  get metricsFile(): string {
    return join(ensureDir(join(app.getPath('userData'), 'metrics')), 'metrics.json')
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
  /** AG-03: structured memory store (profile/preference/fact/project entries with type + date). */
  memoryFile(workspace: string): string {
    return join(paths.memoryDir(workspace), 'memory.json')
  },
  skillsDir(workspace: string): string {
    return ensureDir(join(workspace, 'skills'))
  },
  /** INT-02: named, toggleable instruction blocks injected into the system prompt when enabled. */
  skillsFile(workspace: string): string {
    return join(paths.skillsDir(workspace), 'skills.json')
  },
}
