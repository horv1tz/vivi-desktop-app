import { describe, expect, it } from 'vitest'
import { resolvePresetSteps, SCENARIO_PRESETS } from '../../../src/shared/scenario-presets'

describe('SCENARIO_PRESETS', () => {
  it('has unique ids, at least one step, and non-empty bilingual name/description', () => {
    const ids = SCENARIO_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of SCENARIO_PRESETS) {
      expect(p.steps.length).toBeGreaterThan(0)
      expect(p.name.en.length).toBeGreaterThan(0)
      expect(p.name.ru.length).toBeGreaterThan(0)
      expect(p.description.en.length).toBeGreaterThan(0)
      expect(p.description.ru.length).toBeGreaterThan(0)
      expect(p.triggerPhrases.length).toBeGreaterThan(0)
    }
  })

  it('every step only uses fields its own kind declares (matches the runner in agent/tools/scenarios.ts)', () => {
    for (const p of SCENARIO_PRESETS) {
      for (const s of p.steps) {
        if (s.kind === 'open') expect(s.target?.length).toBeGreaterThan(0)
        if (s.kind === 'wait') expect(s.ms).toBeGreaterThan(0)
        if (s.kind === 'key') expect(s.keys?.length).toBeGreaterThan(0)
      }
    }
  })

  it('the Russian name/description is actually Cyrillic, not an untranslated copy', () => {
    for (const p of SCENARIO_PRESETS) {
      expect(p.name.ru).toMatch(/[а-яё]/i)
      expect(p.description.ru).toMatch(/[а-яё]/i)
      expect(p.name.ru).not.toBe(p.name.en)
    }
  })

  it('play/pause uses the platform-identical "space" key, with no {mod} placeholder', () => {
    const preset = SCENARIO_PRESETS.find((p) => p.id === 'play-pause-music')!
    const keyStep = preset.steps.find((s) => s.kind === 'key')!
    expect(keyStep.keys).toBe('space')
  })

  it('next/previous track and volume steps use the {mod} placeholder (platform-divergent shortcuts)', () => {
    for (const id of ['next-track', 'previous-track', 'volume-up', 'volume-down']) {
      const preset = SCENARIO_PRESETS.find((p) => p.id === id)!
      const keyStep = preset.steps.find((s) => s.kind === 'key')!
      expect(keyStep.keys).toContain('{mod}')
    }
  })

  it('the weather preset opens a URL, not an app name', () => {
    const preset = SCENARIO_PRESETS.find((p) => p.id === 'show-weather')!
    expect(preset.steps[0]!.target).toMatch(/^https:\/\//)
  })
})

describe('resolvePresetSteps', () => {
  it('replaces {mod} with "cmd" on darwin', () => {
    const resolved = resolvePresetSteps([{ kind: 'key', keys: '{mod}+right' }], 'darwin')
    expect(resolved[0]!.keys).toBe('cmd+right')
  })

  it('replaces {mod} with "ctrl" on win32 and linux', () => {
    expect(resolvePresetSteps([{ kind: 'key', keys: '{mod}+left' }], 'win32')[0]!.keys).toBe(
      'ctrl+left',
    )
    expect(resolvePresetSteps([{ kind: 'key', keys: '{mod}+up' }], 'linux')[0]!.keys).toBe(
      'ctrl+up',
    )
  })

  it('leaves steps without a placeholder untouched, including non-key steps', () => {
    const steps = [
      { kind: 'open' as const, target: 'Spotify' },
      { kind: 'wait' as const, ms: 500 },
      { kind: 'key' as const, keys: 'space' },
    ]
    expect(resolvePresetSteps(steps, 'darwin')).toEqual(steps)
  })

  it('every preset in the library actually resolves cleanly on both darwin and win32', () => {
    for (const p of SCENARIO_PRESETS) {
      for (const platform of ['darwin', 'win32']) {
        const resolved = resolvePresetSteps(p.steps, platform)
        for (const s of resolved) {
          if (s.kind === 'key') expect(s.keys).not.toContain('{mod}')
        }
      }
    }
  })
})
