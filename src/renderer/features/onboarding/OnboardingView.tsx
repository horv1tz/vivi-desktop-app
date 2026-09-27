import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, Check, Mic, MonitorUp, Accessibility, Cog, TriangleAlert } from 'lucide-react'
import type { OsPermissionStatus } from '@shared/events'
import { useSettingsStore } from '../../stores/settings'
import { useAuthStore } from '../../stores/auth'
import { useUiStore } from '../../stores/ui'
import { invoke, isMac } from '../../lib/bridge'
import { Button } from '../../components/ui/Button'
import { Field, Select } from '../../components/ui/Field'
import { AccountSection } from '../settings/sections/AccountSection'
import { VoiceModelsPanel } from '../voice/VoiceModelsPanel'
import { VoiceStatusPanel } from '../voice/VoiceStatusPanel'
import { cn } from '../../lib/cn'

const steps = ['language', 'account', 'permissions', 'voice', 'done'] as const
type Step = (typeof steps)[number]

export function OnboardingView() {
  const { t } = useTranslation()
  const update = useSettingsStore((s) => s.update)
  const lang = useSettingsStore((s) => s.settings.appearance.language)
  const voiceLanguage = useSettingsStore((s) => s.settings.voice.language)
  const setView = useUiStore((s) => s.setView)
  const authStatus = useAuthStore((s) => s.status)
  const refreshAuth = useAuthStore((s) => s.refresh)
  const [step, setStep] = useState<Step>('language')
  const [perms, setPerms] = useState<OsPermissionStatus | null>(null)
  // UX-06: finishing without a working authorization is allowed, but only as an explicit,
  // acknowledged choice — not the silent default a plain "skip" button would give.
  const [acceptNoAuth, setAcceptNoAuth] = useState(false)

  useEffect(() => {
    void refreshAuth()
  }, [refreshAuth])

  useEffect(() => {
    if (step === 'permissions')
      invoke('app:getOsPermissions')
        .then(setPerms)
        .catch(() => null)
  }, [step])

  const loggedIn = !!authStatus?.loggedIn && authStatus.mode !== 'none'
  const canFinish = loggedIn || acceptNoAuth

  const next = (): void => setStep(steps[Math.min(steps.indexOf(step) + 1, steps.length - 1)]!)
  const finish = async (): Promise<void> => {
    if (!canFinish) return
    await update({ onboardingCompleted: true })
    setView('chat')
  }

  return (
    <div className="flex h-full flex-col items-center overflow-y-auto px-6 py-10">
      <div className="mb-6 flex items-center gap-2">
        {steps.map((s, i) => (
          <div
            key={s}
            className={cn(
              'h-1.5 rounded-full transition-all',
              i <= steps.indexOf(step) ? 'w-8 bg-accent' : 'w-4 bg-line-strong',
            )}
          />
        ))}
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.2 }}
          className="flex w-full max-w-2xl flex-col gap-4"
        >
          {step === 'language' ? (
            <>
              <div className="mb-2 flex flex-col items-center text-center">
                <div
                  className="mb-4 h-24 w-24 rounded-full"
                  style={{
                    background:
                      'radial-gradient(circle at 32% 28%, #fff 0%, var(--accent-2) 22%, var(--accent) 70%, #2a1f7a 100%)',
                    boxShadow: '0 20px 60px -20px var(--accent)',
                  }}
                />
                <h1 className="text-3xl font-semibold">{t('onboarding.welcome')}</h1>
                <p className="mt-2 max-w-md text-muted">{t('onboarding.welcomeHint')}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {(['ru', 'en'] as const).map((l) => (
                  <button
                    key={l}
                    onClick={() => update({ appearance: { language: l } })}
                    className={cn(
                      'rounded-2xl border p-4 text-left transition-colors',
                      lang === l
                        ? 'border-accent bg-accent/10'
                        : 'border-line bg-elev hover:border-accent/40',
                    )}
                  >
                    <div className="text-lg font-medium">{l === 'ru' ? 'Русский' : 'English'}</div>
                    <div className="text-xs text-muted">
                      {l === 'ru'
                        ? 'Интерфейс и голос на русском'
                        : 'Interface and voice in English'}
                    </div>
                  </button>
                ))}
              </div>
              <Button variant="primary" size="lg" className="self-end" onClick={next}>
                {t('common.next')} <ArrowRight size={16} />
              </Button>
            </>
          ) : null}

          {step === 'account' ? (
            <>
              <h2 className="text-2xl font-semibold">{t('onboarding.accountTitle')}</h2>
              <AccountSection compact onDone={next} />
              <Button variant="ghost" className="self-end" onClick={next}>
                {t('onboarding.skip')}
              </Button>
            </>
          ) : null}

          {step === 'permissions' ? (
            <>
              <h2 className="text-2xl font-semibold">{t('onboarding.permissionsTitle')}</h2>
              <p className="text-sm text-muted">{t('onboarding.permissionsHint')}</p>
              <PermissionRow
                icon={<Mic size={18} />}
                label={t('onboarding.perm.microphone')}
                status={perms?.microphone}
                onRequest={async () => {
                  await invoke('app:requestOsPermission', 'microphone')
                  setPerms(await invoke('app:getOsPermissions'))
                }}
              />
              <PermissionRow
                icon={<MonitorUp size={18} />}
                label={t('onboarding.perm.screen')}
                status={perms?.screen}
                onRequest={async () => {
                  await invoke('app:requestOsPermission', 'screen')
                  setPerms(await invoke('app:getOsPermissions'))
                }}
              />
              {isMac ? (
                <PermissionRow
                  icon={<Accessibility size={18} />}
                  label={t('onboarding.perm.accessibility')}
                  status={perms?.accessibility}
                  onRequest={async () => {
                    await invoke('app:requestOsPermission', 'accessibility')
                    setPerms(await invoke('app:getOsPermissions'))
                  }}
                />
              ) : null}
              {isMac ? (
                <PermissionRow
                  icon={<Cog size={18} />}
                  label={t('onboarding.perm.automation')}
                  status={perms?.automation}
                  onRequest={async () => {
                    await invoke('app:requestOsPermission', 'automation')
                    setPerms(await invoke('app:getOsPermissions'))
                  }}
                />
              ) : null}
              {!isMac ? (
                <p className="text-xs text-faint">{t('onboarding.perm.linuxNote')}</p>
              ) : null}
              <Button variant="primary" size="lg" className="self-end" onClick={next}>
                {t('common.next')} <ArrowRight size={16} />
              </Button>
            </>
          ) : null}

          {step === 'voice' ? (
            <>
              <h2 className="text-2xl font-semibold">{t('onboarding.voiceTitle')}</h2>
              <p className="text-sm text-muted">{t('onboarding.voiceHint')}</p>
              <Field label={t('onboarding.voiceLanguage')} inline>
                <Select
                  value={voiceLanguage}
                  onChange={(e) =>
                    update({ voice: { language: e.target.value as typeof voiceLanguage } })
                  }
                >
                  <option value="ru">Русский</option>
                  <option value="en">English</option>
                  <option value="auto">{t('voice.auto')}</option>
                </Select>
              </Field>
              <VoiceModelsPanel />
              <div className="rounded-xl border border-line bg-elev p-4">
                <p className="mb-3 text-xs text-muted">{t('onboarding.voiceTestHint')}</p>
                <VoiceStatusPanel />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={next}>
                  {t('onboarding.skip')}
                </Button>
                <Button variant="primary" size="lg" onClick={next}>
                  {t('common.next')} <ArrowRight size={16} />
                </Button>
              </div>
            </>
          ) : null}

          {step === 'done' ? (
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="grid h-16 w-16 place-items-center rounded-full bg-success/15 text-success">
                <Check size={32} />
              </div>
              <h2 className="text-2xl font-semibold">{t('onboarding.doneTitle')}</h2>
              <p className="max-w-md text-sm text-muted">{t('onboarding.doneHint')}</p>
              {!loggedIn ? (
                <div className="flex max-w-md flex-col gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4 text-left">
                  <div className="flex items-start gap-2">
                    <TriangleAlert className="mt-0.5 shrink-0 text-warning" size={18} />
                    <div className="text-sm">
                      <div className="font-medium text-warning">
                        {t('onboarding.noAuthWarningTitle')}
                      </div>
                      <p className="text-xs text-muted">{t('onboarding.noAuthWarningBody')}</p>
                    </div>
                  </div>
                  <label className="flex items-start gap-2 text-xs text-muted">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={acceptNoAuth}
                      onChange={(e) => setAcceptNoAuth(e.target.checked)}
                    />
                    {t('onboarding.noAuthWarningAck')}
                  </label>
                </div>
              ) : null}
              <Button variant="primary" size="lg" disabled={!canFinish} onClick={finish}>
                {t('onboarding.start')}
              </Button>
            </div>
          ) : null}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function PermissionRow({
  icon,
  label,
  status,
  onRequest,
}: {
  icon: React.ReactNode
  label: string
  status?: string
  onRequest: () => Promise<void>
}) {
  const { t } = useTranslation()
  const granted = status === 'granted'
  const na = status === 'n/a'
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-elev px-4 py-3">
      <span
        className={cn(
          'grid h-9 w-9 place-items-center rounded-lg',
          granted ? 'bg-success/15 text-success' : 'bg-sunken text-muted',
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-faint">
          {na
            ? t('onboarding.perm.notNeeded')
            : status
              ? t(`onboarding.perm.status.${status}`, { defaultValue: status })
              : '…'}
        </div>
      </div>
      {!granted && !na ? (
        <Button size="sm" onClick={() => void onRequest()}>
          {t('onboarding.perm.grant')}
        </Button>
      ) : null}
    </div>
  )
}
