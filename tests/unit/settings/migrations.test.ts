import { describe, expect, it } from 'vitest'
import { migrateSettings } from '../../../src/main/settings/migrations'

describe('migrateSettings (UX-03)', () => {
  it('leaves a file already at the target version untouched', () => {
    const raw = { schemaVersion: 3, agent: { model: 'x' } }
    expect(migrateSettings(raw, {}, 3)).toEqual(raw)
  })

  it('treats a file with no schemaVersion as already current, not something to migrate', () => {
    const raw = { agent: { model: 'x' } }
    expect(migrateSettings(raw, { 1: (r) => ({ ...r, shouldNotRun: true }) }, 3)).toEqual({
      ...raw,
      schemaVersion: 3,
    })
  })

  it('applies migrations in order up to the target version', () => {
    const raw = { schemaVersion: 1, oldField: 'value' }
    const migrations = {
      1: (r: Record<string, unknown>) => {
        const { oldField, ...rest } = r
        return { ...rest, renamedField: oldField }
      },
      2: (r: Record<string, unknown>) => ({ ...r, addedByV3: true }),
    }
    expect(migrateSettings(raw, migrations, 3)).toEqual({
      renamedField: 'value',
      addedByV3: true,
      schemaVersion: 3,
    })
  })

  it('stops at the first version with no registered migration, leaving schema validation to fill the rest', () => {
    const raw = { schemaVersion: 1, field: 'value' }
    const migrations = { 1: (r: Record<string, unknown>) => ({ ...r, step1: true }) } // no step for version 2
    expect(migrateSettings(raw, migrations, 3)).toEqual({
      field: 'value',
      step1: true,
      schemaVersion: 2,
    })
  })
})
