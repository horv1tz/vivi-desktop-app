import { describe, expect, it } from 'vitest'
import { SKILL_PRESETS } from '../../../src/shared/skill-presets'

describe('SKILL_PRESETS', () => {
  it('has unique ids and non-empty name/description', () => {
    const ids = SKILL_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of SKILL_PRESETS) {
      expect(p.id.length).toBeGreaterThan(0)
      expect(p.name.length).toBeGreaterThan(0)
      expect(p.description.length).toBeGreaterThan(0)
    }
  })

  it('every body is non-empty in both languages and fits the skill body length limit (8000 chars)', () => {
    for (const p of SKILL_PRESETS) {
      expect(p.body.en.trim().length).toBeGreaterThan(0)
      expect(p.body.ru.trim().length).toBeGreaterThan(0)
      expect(p.body.en.length).toBeLessThan(8_000)
      expect(p.body.ru.length).toBeLessThan(8_000)
    }
  })

  it('the Russian body is actually Cyrillic (not an untranslated copy of the English one)', () => {
    for (const p of SKILL_PRESETS) {
      expect(p.body.ru).toMatch(/[а-яё]/i)
      expect(p.body.ru).not.toBe(p.body.en)
    }
  })
})
