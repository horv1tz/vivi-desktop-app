import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, CircleAlert, FolderOpen, Loader2 } from 'lucide-react'
import type { ProxyTestResult } from '@shared/ipc'
import { useSettingsStore } from '../../../stores/settings'
import { invoke } from '../../../lib/bridge'
import { Field, Input, Section, Select } from '../../../components/ui/Field'
import { Button } from '../../../components/ui/Button'

export function ProxySection() {
  const { t } = useTranslation()
  const s = useSettingsStore((x) => x.settings.proxy)
  const update = useSettingsStore((x) => x.update)
  const set = (patch: Partial<typeof s>): void => void update({ proxy: patch })
  const [password, setPassword] = useState('')
  const [result, setResult] = useState<ProxyTestResult | null>(null)
  const [testing, setTesting] = useState(false)

  const runTest = async (): Promise<void> => {
    setTesting(true)
    try {
      setResult(await invoke('proxy:test'))
    } finally {
      setTesting(false)
    }
  }

  return (
    <>
      <Section title={t('proxy.title')} description={t('proxy.hint')}>
        <Field label={t('proxy.mode')} inline>
          <Select value={s.mode} onChange={(e) => set({ mode: e.target.value as typeof s.mode })}>
            <option value="none">{t('proxy.modes.none')}</option>
            <option value="system">{t('proxy.modes.system')}</option>
            <option value="manual">{t('proxy.modes.manual')}</option>
          </Select>
        </Field>
        {s.mode === 'manual' ? (
          <>
            <div className="grid grid-cols-[110px_1fr_110px] gap-2">
              <Field label={t('proxy.scheme')}>
                <Select value={s.scheme} onChange={(e) => set({ scheme: e.target.value as typeof s.scheme })}>
                  <option value="http">HTTP</option>
                  <option value="https">HTTPS</option>
                  <option value="socks5">SOCKS5</option>
                </Select>
              </Field>
              <Field label={t('proxy.host')}>
                <Input key={s.host} defaultValue={s.host} placeholder="proxy.example.com" onBlur={(e) => { const v = e.target.value.trim(); if (v !== s.host) set({ host: v }) }} />
              </Field>
              <Field label={t('proxy.port')}>
                <Input type="number" min={1} max={65535} key={s.port} defaultValue={s.port || ''} onBlur={(e) => { const v = Number(e.target.value) || 0; if (v !== s.port) set({ port: v }) }} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t('proxy.username')}>
                <Input key={s.username} defaultValue={s.username} autoComplete="off" onBlur={(e) => e.target.value !== s.username && set({ username: e.target.value })} />
              </Field>
              <Field label={t('proxy.password')} hint={s.hasPassword ? t('proxy.passwordSaved') : undefined}>
                <div className="flex gap-2">
                  <Input type="password" value={password} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} />
                  <Button size="sm" disabled={!password && !s.hasPassword} onClick={async () => { await invoke('proxy:setPassword', password); setPassword('') }}>{password ? t('settings.save') : t('common.remove')}</Button>
                </div>
              </Field>
            </div>
            <Field label={t('proxy.bypass')} hint={t('proxy.bypassHint')}>
              <Input key={s.bypass} defaultValue={s.bypass} onBlur={(e) => e.target.value !== s.bypass && set({ bypass: e.target.value })} />
            </Field>
            {s.scheme === 'socks5' || s.username ? <p className="text-xs text-faint">{t('proxy.bridgeNote')}</p> : null}
          </>
        ) : null}
        <Field label={t('proxy.caCert')} hint={t('proxy.caCertHint')}>
          <div className="flex gap-2">
            <Input key={s.caCertPath} defaultValue={s.caCertPath} placeholder="/path/to/ca.pem" onBlur={(e) => e.target.value !== s.caCertPath && set({ caCertPath: e.target.value })} />
            <Button onClick={async () => { const f = await invoke('settings:pickFile', undefined); if (f) set({ caCertPath: f }) }}><FolderOpen size={16} /></Button>
          </div>
        </Field>
      </Section>
      <Section title={t('proxy.testTitle')}>
        <div className="flex items-center gap-3">
          <Button variant="primary" disabled={testing} onClick={() => void runTest()}>{testing ? <Loader2 size={16} className="animate-spin" /> : null} {t('common.test')}</Button>
          {result ? (
            <span className={`inline-flex items-center gap-1.5 text-sm ${result.ok ? 'text-success' : 'text-danger'}`}>
              {result.ok ? <CheckCircle2 size={16} /> : <CircleAlert size={16} />}
              {result.ok ? `${t('proxy.ok')} (${result.status}, ${result.latencyMs} ms)` : result.error ?? `HTTP ${result.status}`}
              <span className="text-faint">· {result.via}</span>
            </span>
          ) : null}
        </div>
      </Section>
    </>
  )
}
