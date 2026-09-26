import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppInfo } from '@shared/events'
import { invoke } from '../../../lib/bridge'
import { useSettingsStore } from '../../../stores/settings'
import { Section } from '../../../components/ui/Field'
import { Button } from '../../../components/ui/Button'

export function AboutSection() {
  const { t } = useTranslation()
  const [info, setInfo] = useState<AppInfo | null>(null)
  const load = useSettingsStore((s) => s.load)
  useEffect(() => {
    invoke('app:getInfo').then(setInfo).catch(() => null)
  }, [])
  const row = (label: string, value: string | null | undefined) => (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-muted">{label}</span>
      <span className="min-w-0 truncate font-mono text-[12px] selectable" title={value ?? ''}>{value ?? '—'}</span>
    </div>
  )
  return (
    <>
      <Section title="Vivi">
        {row(t('settings.about.version'), info ? `${info.version} (${info.platform}/${info.arch}${info.isPackaged ? '' : ', dev'})` : null)}
        {row(t('settings.about.backend'), info ? t(`settings.about.backends.${info.backend}`) : null)}
        {row(t('settings.about.sdk'), info?.sdkVersion)}
        {row(t('settings.about.acp'), info?.acpAdapterVersion)}
        {row(t('settings.about.binary'), info?.claudeBinary ?? 'auto')}
        {row(t('settings.about.userData'), info?.userDataPath)}
        <div className="flex gap-2">
          <Button onClick={() => invoke('app:openLogs')}>{t('settings.about.logs')}</Button>
          <Button variant="ghost" onClick={async () => { await invoke('settings:reset'); await load() }}>{t('settings.about.reset')}</Button>
        </div>
      </Section>
      <Section title="Claude">
        <p className="text-xs text-muted">{t('settings.about.notice')}</p>
      </Section>
    </>
  )
}
