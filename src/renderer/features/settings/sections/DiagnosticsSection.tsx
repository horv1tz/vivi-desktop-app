import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { InputDriverInfo } from '@shared/events'
import { useVoiceStore } from '../../../stores/voice'
import { useSettingsStore } from '../../../stores/settings'
import { invoke } from '../../../lib/bridge'
import { Section } from '../../../components/ui/Field'
import { Orb } from '../../../components/motion/Orb'

/** OBS-01: live voice state/devices and which InputDriver is active, and why — for support requests. */
export function DiagnosticsSection() {
  const { t } = useTranslation()
  const voice = useVoiceStore()
  const inputDeviceId = useSettingsStore((s) => s.settings.voice.inputDeviceId)
  const outputDeviceId = useSettingsStore((s) => s.settings.voice.outputDeviceId)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [driverInfo, setDriverInfo] = useState<InputDriverInfo | null>(null)

  useEffect(() => {
    navigator.mediaDevices
      .enumerateDevices()
      .then(setDevices)
      .catch(() => setDevices([]))
    invoke('diagnostics:getInputDriver')
      .then(setDriverInfo)
      .catch(() => undefined)
  }, [])

  const inputLabel = devices.find(
    (d) => d.kind === 'audioinput' && d.deviceId === inputDeviceId,
  )?.label
  const outputLabel = devices.find(
    (d) => d.kind === 'audiooutput' && d.deviceId === outputDeviceId,
  )?.label

  return (
    <>
      <Section title={t('settings.diagnostics.voiceTitle')}>
        <div className="flex items-center gap-4">
          <Orb state={voice.state === 'off' ? 'idle' : voice.state} level={voice.level} size={56} />
          <div className="flex-1 text-sm">
            <div className="font-medium">{t(`voice.states.${voice.state}`)}</div>
            {voice.detail ? <div className="text-xs text-muted">{voice.detail}</div> : null}
            {voice.transcript ? (
              <div className="text-xs text-faint">«{voice.transcript}»</div>
            ) : null}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-lg bg-sunken px-3 py-2">
            <div className="text-[11px] text-faint">{t('voice.inputDevice')}</div>
            <div className="truncate">{inputLabel || t('voice.defaultDevice')}</div>
          </div>
          <div className="rounded-lg bg-sunken px-3 py-2">
            <div className="text-[11px] text-faint">{t('voice.outputDevice')}</div>
            <div className="truncate">{outputLabel || t('voice.defaultDevice')}</div>
          </div>
        </div>
      </Section>
      <Section title={t('settings.diagnostics.driverTitle')}>
        {driverInfo ? (
          <>
            <p className="text-sm">
              {driverInfo.active ? (
                t('settings.diagnostics.driverActive', { name: driverInfo.active })
              ) : (
                <span className="text-danger">{t('settings.diagnostics.driverNone')}</span>
              )}
            </p>
            <div className="flex flex-col gap-1">
              {driverInfo.attempts.map((a) => (
                <div
                  key={a.name}
                  className="flex items-center justify-between gap-3 rounded-lg bg-sunken px-3 py-1.5 text-xs"
                >
                  <span className="shrink-0 font-medium">{a.name}</span>
                  <span
                    className={`truncate text-right ${a.ok ? 'text-success' : 'text-muted'}`}
                    title={a.reason}
                  >
                    {a.ok
                      ? t('settings.diagnostics.driverOk')
                      : (a.reason ?? t('settings.diagnostics.driverSkipped'))}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm text-faint">…</p>
        )}
      </Section>
    </>
  )
}
