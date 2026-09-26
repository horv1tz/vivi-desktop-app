/**
 * UX-03: schema migrations for the settings file, keyed by the version being migrated FROM. Bump
 * `CURRENT_SCHEMA_VERSION` and add the step that turns that version's shape into the next one
 * whenever a settings field is renamed, restructured, or dropped in a way `SettingsSchema`'s own
 * defaults/prefaults can't paper over — a plain default (a new field appearing with its default
 * value) never needs a migration here.
 */
export const CURRENT_SCHEMA_VERSION = 1

export type SettingsMigration = (raw: Record<string, unknown>) => Record<string, unknown>

export const MIGRATIONS: Record<number, SettingsMigration> = {
  // 1: (raw) => ({ ...raw, renamedField: raw.oldField }),
}

/**
 * Applies every migration from the file's recorded `schemaVersion` up to `targetVersion`, in
 * order. A settings file with no `schemaVersion` at all is a fresh install or the very first
 * shipped version (1), not something to migrate. Stops early (leaving the rest to
 * `SettingsSchema`'s own validation/defaults) if a version in the chain has no registered step,
 * rather than throwing and taking down the whole settings load.
 */
export function migrateSettings(
  raw: Record<string, unknown>,
  migrations: Record<number, SettingsMigration> = MIGRATIONS,
  targetVersion = CURRENT_SCHEMA_VERSION,
): Record<string, unknown> {
  let version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : targetVersion
  let out = raw
  while (version < targetVersion) {
    const step = migrations[version]
    if (!step) break
    out = step(out)
    version += 1
  }
  return { ...out, schemaVersion: version }
}
