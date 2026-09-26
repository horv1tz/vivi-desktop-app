import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppInfo, UpdateStatus } from '@shared/events'
import { invoke, useViviEvent } from '../../../lib/bridge'
import { useSettingsStore } from '../../../stores/settings'
import { Field, Section } from '../../../components/ui/Field'
import { Switch } from '../../../components/ui/Switch'
import { Button } from '../../../components/ui/Button'

export function AboutSection() {
  const { t } = useTranslation()
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [diagnosticsPath, setDiagnosticsPath] = useState<string | null>(null)
  const load = useSettingsStore((s) => s.load)
  const update = useSettingsStore((s) => s.update)
  const autoUpdateEnabled = useSettingsStore((s) => s.settings.features.autoUpdate)
  useEffect(() => {
    invoke('app:getInfo')
      .then(setInfo)
      .catch(() => null)
  }, [])
  useViviEvent(
    'update:status',
    useCallback((status: UpdateStatus) => setUpdateStatus(status), []),
  )
  const updateBusy = updateStatus?.type === 'checking' || updateStatus?.type === 'downloading'
  const updateStatusLabel = (status: UpdateStatus): string => {
    switch (status.type) {
      case 'checking':
        return t('settings.about.update.checking')
      case 'available':
        return t('settings.about.update.available', { version: status.version })
      case 'not-available':
        return t('settings.about.update.upToDate')
      case 'downloading':
        return t('settings.about.update.downloading', { percent: status.percent })
      case 'downloaded':
        return t('settings.about.update.downloaded', { version: status.version })
      case 'error':
        return t('settings.about.update.error', { message: status.message })
    }
  }
  const updateLabel = !autoUpdateEnabled
    ? t('settings.about.update.disabledHint')
    : updateStatus
      ? updateStatusLabel(updateStatus)
      : null
  const row = (label: string, value: string | null | undefined) => (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-muted">{label}</span>
      <span className="min-w-0 truncate font-mono text-[12px] selectable" title={value ?? ''}>
        {value ?? '—'}
      </span>
    </div>
  )
  return (
    <>
      <Section title="Vivi">
        {row(
          t('settings.about.version'),
          info
            ? `${info.version} (${info.platform}/${info.arch}${info.isPackaged ? '' : ', dev'})`
            : null,
        )}
        {row(
          t('settings.about.backend'),
          info ? t(`settings.about.backends.${info.backend}`) : null,
        )}
        {row(t('settings.about.sdk'), info?.sdkVersion)}
        {row(t('settings.about.acp'), info?.acpAdapterVersion)}
        {row(t('settings.about.binary'), info?.claudeBinary ?? 'auto')}
        {row(t('settings.about.userData'), info?.userDataPath)}
        <div className="flex gap-2">
          <Button onClick={() => invoke('app:openLogs')}>{t('settings.about.logs')}</Button>
          <Button onClick={async () => setDiagnosticsPath(await invoke('diagnostics:export'))}>
            {t('settings.about.diagnostics')}
          </Button>
          <Button
            variant="ghost"
            onClick={async () => {
              await invoke('settings:reset')
              await load()
            }}
          >
            {t('settings.about.reset')}
          </Button>
        </div>
        {diagnosticsPath ? (
          <p className="text-xs text-muted">
            {t('settings.about.diagnosticsSaved', { path: diagnosticsPath })}
          </p>
        ) : null}
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <Field label={t('settings.about.update.enable')} inline>
            <Switch
              checked={autoUpdateEnabled}
              onCheckedChange={(v) => update({ features: { autoUpdate: v } })}
            />
          </Field>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              disabled={!autoUpdateEnabled || updateBusy}
              onClick={() => invoke('update:check')}
            >
              {t('settings.about.update.check')}
            </Button>
            {updateStatus?.type === 'downloaded' ? (
              <Button variant="primary" onClick={() => invoke('update:install')}>
                {t('settings.about.update.restart')}
              </Button>
            ) : null}
          </div>
          {updateLabel ? <p className="text-xs text-muted">{updateLabel}</p> : null}
        </div>
      </Section>
      <Section title="Claude">
        <p className="text-xs text-muted">{t('settings.about.notice')}</p>
      </Section>
    </>
  )
}
