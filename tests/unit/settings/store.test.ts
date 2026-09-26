import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultSettings } from '../../../src/shared/settings'
import { type PersistedStore, SettingsStore } from '../../../src/main/settings/store'

/** In-memory stand-in for electron-store's own `{ store, path }` API. */
function fakePersistedStore(path: string, initial: Record<string, unknown> = {}): PersistedStore {
  let data = initial
  return {
    get store() {
      return data
    },
    set store(v: Record<string, unknown>) {
      data = v
    },
    path,
  }
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vivi-settings-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('SettingsStore (UX-03: self-repair)', () => {
  it('starts with defaults and writes a backup on first load', () => {
    const settingsPath = join(dir, 'settings.json')
    const store = new SettingsStore(fakePersistedStore(settingsPath))
    expect(store.get().agent.model).toBe('')
    expect(readFileSync(`${settingsPath}.backup`, 'utf8')).toContain('"schemaVersion"')
  })

  it('keeps a matching backup up to date across updates', () => {
    const settingsPath = join(dir, 'settings.json')
    const store = new SettingsStore(fakePersistedStore(settingsPath))
    store.update({ agent: { model: 'claude-opus-5' } })
    const backup = JSON.parse(readFileSync(`${settingsPath}.backup`, 'utf8'))
    expect(backup.agent.model).toBe('claude-opus-5')
  })

  it('restores from backup instead of resetting when the main file is corrupted (UX-03)', () => {
    const settingsPath = join(dir, 'settings.json')
    const backend = fakePersistedStore(settingsPath)
    const first = new SettingsStore(backend)
    first.update({ agent: { model: 'claude-opus-5', maxTurns: 42 } })
    // Simulate corruption: the "file" (backend.store) is now garbage, but the backup written
    // alongside it on real disk survives.
    const corrupted = fakePersistedStore(settingsPath, {
      not: 'valid settings at all',
      agent: 'not an object',
    } as unknown as Record<string, unknown>)
    const second = new SettingsStore(corrupted)
    expect(second.get().agent.model).toBe('claude-opus-5')
    expect(second.get().agent.maxTurns).toBe(42)
    // The corrupted primary store should have been healed in place.
    expect((corrupted.store as { agent?: { model?: string } }).agent?.model).toBe('claude-opus-5')
  })

  it('falls back to defaults only when both the main file and the backup are unusable', () => {
    const settingsPath = join(dir, 'settings.json')
    writeFileSync(`${settingsPath}.backup`, 'not json at all', 'utf8')
    const corrupted = fakePersistedStore(settingsPath, {
      agent: 'not an object',
    } as unknown as Record<string, unknown>)
    const store = new SettingsStore(corrupted)
    expect(store.get()).toEqual(defaultSettings())
  })

  it('does not treat a settings file with no schemaVersion as corrupted (fresh installs / pre-versioning)', () => {
    const settingsPath = join(dir, 'settings.json')
    const store = new SettingsStore(
      fakePersistedStore(settingsPath, { agent: { model: 'claude-sonnet-5' } }),
    )
    expect(store.get().agent.model).toBe('claude-sonnet-5')
    expect(store.get().schemaVersion).toBe(1)
  })
})
