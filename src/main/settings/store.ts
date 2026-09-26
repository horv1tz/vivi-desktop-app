import { EventEmitter } from 'node:events'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import Store from 'electron-store'
import { type DeepPartial, SettingsSchema, type Settings, defaultSettings } from '@shared/settings'
import { logger } from '../logging/log'
import { migrateSettings } from './migrations'

const log = logger('settings')

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function deepMerge<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (patch === undefined) return base
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch as T
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    const cur = (base as Record<string, unknown>)[k]
    out[k] =
      isPlainObject(cur) && isPlainObject(v) ? deepMerge(cur, v as DeepPartial<typeof cur>) : v
  }
  return out as T
}

/** The slice of electron-store's API SettingsStore actually needs; lets tests inject a fake in-memory store. */
export interface PersistedStore {
  store: Record<string, unknown>
  path: string
}

export class SettingsStore extends EventEmitter {
  private store: PersistedStore
  /** UX-03: a copy of the last known-good parsed settings, restored from if the main file gets corrupted. */
  private get backupPath(): string {
    return `${this.store.path}.backup`
  }
  private cache: Settings

  constructor(
    store: PersistedStore = new Store<Record<string, unknown>>({
      name: 'settings',
      clearInvalidConfig: true,
    }),
  ) {
    super()
    this.store = store
    this.cache = this.load()
  }

  private load(): Settings {
    const raw = migrateSettings(this.store.store)
    const parsed = SettingsSchema.safeParse(raw)
    if (parsed.success) {
      this.writeBackup(parsed.data)
      return parsed.data
    }
    log.warn(
      'settings file invalid, falling back to defaults for bad fields',
      parsed.error.issues.slice(0, 5),
    )
    const merged = deepMerge(defaultSettings(), raw as DeepPartial<Settings>)
    const retry = SettingsSchema.safeParse(merged)
    if (retry.success) {
      this.writeBackup(retry.data)
      return retry.data
    }
    // The live file is unsalvageable even merged onto defaults (e.g. truncated/binary-garbage
    // JSON) — try the last known-good backup before wiping out every setting the user had.
    const restored = this.restoreFromBackup()
    if (restored) {
      log.warn('settings file was corrupted; restored from backup')
      // Heal the primary file immediately so the corruption doesn't linger on disk.
      this.store.store = restored as unknown as Record<string, unknown>
      return restored
    }
    log.error('settings file and backup both unusable; resetting to defaults')
    return defaultSettings()
  }

  private writeBackup(s: Settings): void {
    try {
      writeFileSync(this.backupPath, JSON.stringify(s), 'utf8')
    } catch (err) {
      log.warn('could not write settings backup', err)
    }
  }

  private restoreFromBackup(): Settings | null {
    try {
      if (!existsSync(this.backupPath)) return null
      const raw = JSON.parse(readFileSync(this.backupPath, 'utf8')) as Record<string, unknown>
      const parsed = SettingsSchema.safeParse(migrateSettings(raw))
      return parsed.success ? parsed.data : null
    } catch (err) {
      log.warn('settings backup unusable', err)
      return null
    }
  }

  get(): Settings {
    return this.cache
  }

  update(patch: DeepPartial<Settings>): Settings {
    const next = SettingsSchema.parse(deepMerge(this.cache, patch))
    this.cache = next
    this.store.store = next as unknown as Record<string, unknown>
    this.writeBackup(next)
    this.emit('changed', next)
    return next
  }

  reset(): Settings {
    this.cache = defaultSettings()
    this.store.store = this.cache as unknown as Record<string, unknown>
    this.writeBackup(this.cache)
    this.emit('changed', this.cache)
    return this.cache
  }

  onChanged(listener: (s: Settings) => void): () => void {
    this.on('changed', listener)
    return () => this.off('changed', listener)
  }

  get path(): string {
    return this.store.path
  }
}

let instance: SettingsStore | null = null
export function settings(): SettingsStore {
  if (!instance) instance = new SettingsStore()
  return instance
}
