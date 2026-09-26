import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, ExternalLink, KeyRound, LogOut, ShieldCheck, UserRound } from 'lucide-react'
import { useAuthStore } from '../../../stores/auth'
import { invoke } from '../../../lib/bridge'
import { Section, Input } from '../../../components/ui/Field'
import { Button } from '../../../components/ui/Button'
import { cn } from '../../../lib/cn'

export function AccountSection({ compact = false, onDone }: { compact?: boolean; onDone?: () => void }) {
  const { t } = useTranslation()
  const { status, login, refresh, startClaudeLogin, submitCode, cancelLogin, setOauthToken, setApiKey, useExistingClaude, logout } = useAuthStore()
  const [tab, setTab] = useState<'claude' | 'token' | 'apikey'>('claude')
  const [code, setCode] = useState('')
  const [token, setToken] = useState('')
  const [apiKey, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void refresh()
  }, [refresh])

  const guard = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onDone?.()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const loggedIn = status?.loggedIn && status.mode !== 'none'

  return (
    <>
      {loggedIn ? (
        <Section title={t('account.connected')}>
          <div className="flex items-center gap-3 rounded-xl bg-success/10 px-4 py-3 text-sm">
            <CheckCircle2 className="text-success" size={18} />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{t(`account.modes.${status!.mode}`)}</div>
              <div className="text-xs text-muted">{[status?.email, status?.organization, status?.subscriptionType, status?.authMethod].filter(Boolean).join(' · ') || t('account.ready')}</div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => guard(logout)}><LogOut size={14} /> {t('account.logout')}</Button>
          </div>
          {onDone ? <Button variant="primary" className="self-end" onClick={onDone}>{t('common.next')}</Button> : null}
        </Section>
      ) : null}

      <Section title={loggedIn ? t('account.switch') : t('account.connect')} description={t('account.notice')}>
        <div className="flex gap-1 rounded-xl bg-sunken p-1">
          {(['claude', 'token', 'apikey'] as const).map((k) => (
            <button key={k} onClick={() => setTab(k)} className={cn('flex-1 rounded-lg px-3 py-1.5 text-sm transition-colors', tab === k ? 'bg-elev text-fg shadow' : 'text-muted hover:text-fg')}>
              {t(`account.tabs.${k}`)}
            </button>
          ))}
        </div>

        {tab === 'claude' ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">{t('account.claude.desc')}</p>
            {!login ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" disabled={busy} onClick={() => guard(() => startClaudeLogin('claudeai'))}><UserRound size={16} /> {t('account.claude.login')}</Button>
                <Button disabled={busy} onClick={() => guard(() => startClaudeLogin('console'))}>{t('account.claude.loginConsole')}</Button>
                <Button variant="ghost" disabled={busy} onClick={() => guard(useExistingClaude)}><ShieldCheck size={16} /> {t('account.claude.useExisting')}</Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2 rounded-xl border border-line bg-sunken p-3">
                <div className="text-sm">
                  {login.phase === 'starting' ? t('account.claude.starting') : null}
                  {login.phase === 'url' || login.phase === 'waiting-code' ? t('account.claude.pasteCode') : null}
                  {login.phase === 'error' ? <span className="text-danger">{login.message}</span> : null}
                </div>
                {login.url ? (
                  <button className="inline-flex items-center gap-1 text-xs text-accent underline" onClick={() => invoke('shell:openExternal', login.url!)}>
                    <ExternalLink size={12} /> {t('account.claude.openAgain')}
                  </button>
                ) : null}
                <div className="flex gap-2">
                  <Input placeholder={t('account.claude.codePlaceholder')} value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && code.trim() && guard(() => submitCode(code))} />
                  <Button variant="primary" disabled={!code.trim() || busy} onClick={() => guard(() => submitCode(code))}>{t('account.claude.submit')}</Button>
                  <Button variant="ghost" onClick={() => guard(cancelLogin)}>{t('common.cancel')}</Button>
                </div>
              </div>
            )}
          </div>
        ) : null}

        {tab === 'token' ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">{t('account.token.desc')}</p>
            <pre className="rounded-lg bg-sunken px-3 py-2 font-mono text-[12px] selectable">claude setup-token</pre>
            <div className="flex gap-2">
              <Input type="password" placeholder="sk-ant-oat01-…" value={token} onChange={(e) => setToken(e.target.value)} />
              <Button variant="primary" disabled={!token.trim() || busy} onClick={() => guard(() => setOauthToken(token).then(() => setToken('')))}><KeyRound size={16} /> {t('common.done')}</Button>
            </div>
          </div>
        ) : null}

        {tab === 'apikey' ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">{t('account.apikey.desc')}</p>
            <button className="self-start text-xs text-accent underline" onClick={() => invoke('shell:openExternal', 'https://platform.claude.com/settings/keys')}>platform.claude.com/settings/keys</button>
            <div className="flex gap-2">
              <Input type="password" placeholder="sk-ant-api03-…" value={apiKey} onChange={(e) => setKey(e.target.value)} />
              <Button variant="primary" disabled={!apiKey.trim() || busy} onClick={() => guard(() => setApiKey(apiKey).then(() => setKey('')))}><KeyRound size={16} /> {t('common.done')}</Button>
            </div>
          </div>
        ) : null}

        {error ? <p className="text-sm text-danger">{error}</p> : null}
        {status?.error ? <p className="text-xs text-danger">{status.error}</p> : null}
        {compact ? null : <p className="text-xs text-faint">{t('account.security')}</p>}
      </Section>
    </>
  )
}
