import { useTranslation } from 'react-i18next'
import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { usePermissionStore } from '../../stores/permissions'
import { useSettingsStore } from '../../stores/settings'
import { Modal } from '../../components/ui/Dialog'
import { Button } from '../../components/ui/Button'
import { cn } from '../../lib/cn'

export function PermissionDialog() {
  const { t } = useTranslation()
  const pending = usePermissionStore((s) => s.pending)
  const respond = usePermissionStore((s) => s.respond)
  const killHotkey = useSettingsStore((s) => s.settings.appearance.killSwitchHotkey)
  const req = pending[0]
  if (!req) return null

  const inputText = typeof req.input === 'object' && req.input ? JSON.stringify(req.input, null, 2) : String(req.input ?? '')
  const command = typeof req.input === 'object' && req.input && 'command' in (req.input as Record<string, unknown>) ? String((req.input as Record<string, unknown>).command) : null

  return (
    <Modal open title={req.title ?? t('permission.title')} description={req.description} dismissable={false}>
      <div className="flex flex-col gap-3">
        <div className={cn('flex items-center gap-2 rounded-xl px-3 py-2 text-sm', req.dangerous ? 'bg-danger/10 text-danger' : 'bg-sunken text-muted')}>
          {req.dangerous ? <ShieldAlert size={16} /> : <ShieldCheck size={16} />}
          <span>{t(`permission.category.${req.category}`)} · {req.displayName ?? req.toolName}</span>
        </div>
        {req.dangerous ? (
          <div className="text-sm text-danger">
            {t('permission.dangerous')}
            {req.dangerReasons.length ? <ul className="mt-1 list-disc pl-5 text-xs">{req.dangerReasons.map((r) => <li key={r}>{r}</li>)}</ul> : null}
          </div>
        ) : null}
        {req.category === 'input' ? <p className="text-xs text-muted">{t('permission.inputHint', { hotkey: killHotkey.replace('CommandOrControl', 'Ctrl') })}</p> : null}
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-sunken p-3 font-mono text-[12px] selectable">{command ?? inputText}</pre>
        {req.reason ? <p className="text-xs text-faint">{req.reason}</p> : null}
        <div className="mt-1 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => void respond(req.requestId, 'deny')}>{t('permission.deny')}</Button>
          {req.category === 'input' ? <Button variant="outline" onClick={() => void respond(req.requestId, 'allow-session')}>{t('permission.allowSession')}</Button> : null}
          {req.canAlwaysAllow && !req.dangerous ? <Button variant="outline" onClick={() => void respond(req.requestId, 'allow-always')}>{t('permission.allowAlways')}</Button> : null}
          <Button variant={req.dangerous ? 'danger' : 'primary'} onClick={() => void respond(req.requestId, 'allow')}>{t('permission.allow')}</Button>
        </div>
      </div>
    </Modal>
  )
}
