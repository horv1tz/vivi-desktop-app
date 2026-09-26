import { EventEmitter } from 'node:events'
import Store from 'electron-store'
import { type DeepPartial, SettingsSchema, type Settings, defaultSettings } from '@shared/settings'
import { logger } from '../logging/log'

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
    out[k] = isPlainObject(cur) && isPlainObject(v) ? deepMerge(cur, v as DeepPartial<typeof cur>) : v
  }
  return out as T
}

class SettingsStore extends EventEmitter {
  private store = new Store<Record<string, unknown>>({ name: 'settings', clearInvalidConfig: true })
  private cache: Settings

  constructor() {
    super()
    this.cache = this.load()
  }

  private load(): Settings {
    const raw = this.store.store
    const parsed = SettingsSchema.safeParse(raw)
    if (parsed.success) return parsed.data
    log.warn('settings file invalid, falling back to defaults for bad fields', parsed.error.issues.slice(0, 5))
    const merged = deepMerge(defaultSettings(), raw as DeepPartial<Settings>)
    const retry = SettingsSchema.safeParse(merged)
    return retry.success ? retry.data : defaultSettings()
  }

  get(): Settings {
    return this.cache
  }

  update(patch: DeepPartial<Settings>): Settings {
    const next = SettingsSchema.parse(deepMerge(this.cache, patch))
    this.cache = next
    this.store.store = next as unknown as Record<string, unknown>
    this.emit('changed', next)
    return next
  }

  reset(): Settings {
    this.cache = defaultSettings()
    this.store.store = this.cache as unknown as Record<string, unknown>
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
