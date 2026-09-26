import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { useSettingsStore } from '../../../stores/settings'
import { Field, Section } from '../../../components/ui/Field'
import { Switch } from '../../../components/ui/Switch'

export function PermissionsSection() {
  const { t } = useTranslation()
  const s = useSettingsStore((x) => x.settings.permissions)
  const update = useSettingsStore((x) => x.update)
  const set = (patch: Partial<typeof s>): void => void update({ permissions: patch })

  return (
    <>
      <Section
        title={t('settings.permissionsUi.categories')}
        description={t('settings.permissionsUi.categoriesHint')}
      >
        <Field
          label={t('settings.permissionsUi.autoAllowReadOnly')}
          hint={t('settings.permissionsUi.readOnlyHint')}
          inline
        >
          <Switch
            checked={s.autoAllowReadOnly}
            onCheckedChange={(v) => set({ autoAllowReadOnly: v })}
          />
        </Field>
        <Field
          label={t('settings.permissionsUi.autoAllowScreenshot')}
          hint={t('settings.permissionsUi.autoAllowScreenshotHint')}
          inline
        >
          <Switch
            checked={s.autoAllowScreenshot}
            onCheckedChange={(v) => set({ autoAllowScreenshot: v })}
          />
        </Field>
        <Field
          label={t('settings.permissionsUi.autoAllowClipboardRead')}
          hint={t('settings.permissionsUi.autoAllowClipboardReadHint')}
          inline
        >
          <Switch
            checked={s.autoAllowClipboardRead}
            onCheckedChange={(v) => set({ autoAllowClipboardRead: v })}
          />
        </Field>
        <Field label={t('settings.permissionsUi.askForEdits')} inline>
          <Switch checked={s.askForEdits} onCheckedChange={(v) => set({ askForEdits: v })} />
        </Field>
        <Field label={t('settings.permissionsUi.askForExec')} inline>
          <Switch checked={s.askForExec} onCheckedChange={(v) => set({ askForExec: v })} />
        </Field>
        <Field label={t('settings.permissionsUi.askForInput')} inline>
          <Switch checked={s.askForInput} onCheckedChange={(v) => set({ askForInput: v })} />
        </Field>
        <Field label={t('settings.permissionsUi.askForSystem')} inline>
          <Switch checked={s.askForSystem} onCheckedChange={(v) => set({ askForSystem: v })} />
        </Field>
        <p className="text-xs text-faint">{t('settings.permissionsUi.dangerNote')}</p>
      </Section>
      <Section
        title={t('settings.permissionsUi.rules')}
        description={t('settings.permissionsUi.rulesHint')}
      >
        {s.alwaysAllowRules.length === 0 ? (
          <p className="text-sm text-faint">{t('settings.permissionsUi.noRules')}</p>
        ) : null}
        {s.alwaysAllowRules.map((r, i) => (
          <div
            key={`${r.toolName}-${r.ruleContent ?? ''}-${i}`}
            className="flex items-center gap-2 rounded-lg bg-sunken px-3 py-1.5 font-mono text-[12px]"
          >
            <span className="min-w-0 flex-1 truncate">
              {r.ruleContent ? `${r.toolName}(${r.ruleContent})` : r.toolName}
            </span>
            <button
              className="text-faint hover:text-danger"
              title={t('common.remove')}
              onClick={() =>
                set({ alwaysAllowRules: s.alwaysAllowRules.filter((_, j) => j !== i) })
              }
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </Section>
    </>
  )
}
