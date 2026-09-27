import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '../../../stores/settings'
import { Field, Input, Section, Select } from '../../../components/ui/Field'
import { Switch } from '../../../components/ui/Switch'

export function GeneralSection() {
  const { t } = useTranslation()
  const s = useSettingsStore((x) => x.settings.appearance)
  const update = useSettingsStore((x) => x.update)
  const set = (patch: Partial<typeof s>): void => void update({ appearance: patch })

  return (
    <>
      <Section title={t('settings.sections.general')}>
        <Field label={t('settings.general.theme')} inline>
          <Select
            value={s.theme}
            onChange={(e) => set({ theme: e.target.value as typeof s.theme })}
          >
            <option value="system">{t('settings.general.themeSystem')}</option>
            <option value="dark">{t('settings.general.themeDark')}</option>
            <option value="light">{t('settings.general.themeLight')}</option>
          </Select>
        </Field>
        <Field label={t('settings.general.language')} inline>
          <Select
            value={s.language}
            onChange={(e) => set({ language: e.target.value as typeof s.language })}
          >
            <option value="ru">Русский</option>
            <option value="en">English</option>
          </Select>
        </Field>
        <Field label={t('settings.general.reduceMotion')} inline>
          <Switch checked={s.reduceMotion} onCheckedChange={(v) => set({ reduceMotion: v })} />
        </Field>
        <Field label={t('settings.general.launchAtLogin')} inline>
          <Switch checked={s.launchAtLogin} onCheckedChange={(v) => set({ launchAtLogin: v })} />
        </Field>
        <Field label={t('settings.general.startMinimized')} inline>
          <Switch checked={s.startMinimized} onCheckedChange={(v) => set({ startMinimized: v })} />
        </Field>
        <Field
          label={t('settings.general.launcherButton')}
          hint={t('settings.general.launcherButtonHint')}
          inline
        >
          <Switch
            checked={s.launcherButtonEnabled}
            onCheckedChange={(v) => set({ launcherButtonEnabled: v })}
          />
        </Field>
      </Section>
      <Section
        title={t('settings.general.overlayHotkey')}
        description={t('settings.general.hotkeyHint')}
      >
        <Field label={t('settings.general.overlayHotkey')}>
          <Input
            key={s.overlayHotkey}
            defaultValue={s.overlayHotkey}
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (v && v !== s.overlayHotkey) set({ overlayHotkey: v })
            }}
          />
        </Field>
        <Field label={t('settings.general.killSwitchHotkey')}>
          <Input
            key={s.killSwitchHotkey}
            defaultValue={s.killSwitchHotkey}
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (v && v !== s.killSwitchHotkey) set({ killSwitchHotkey: v })
            }}
          />
        </Field>
      </Section>
    </>
  )
}
