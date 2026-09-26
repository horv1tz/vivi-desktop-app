import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { AlertTriangle, Sparkles } from 'lucide-react'
import { useChatStore } from '../../stores/chat'
import { useSettingsStore } from '../../stores/settings'
import { useUiStore } from '../../stores/ui'
import { MessageBubble } from './MessageBubble'
import { Composer } from './Composer'
import { Button } from '../../components/ui/Button'
import { formatTokens, formatUsd } from '../../lib/format'

export function ChatView({ mockAgent }: { mockAgent: boolean }) {
  const { t } = useTranslation()
  const messages = useChatStore((s) => s.messages)
  const error = useChatStore((s) => s.error)
  const clearError = useChatStore((s) => s.clearError)
  const lastResult = useChatStore((s) => s.lastResult)
  const totalCost = useChatStore((s) => s.totalCostUsd)
  const rateLimit = useChatStore((s) => s.rateLimit)
  const send = useChatStore((s) => s.send)
  const hotkey = useSettingsStore((s) => s.settings.appearance.overlayHotkey)
  const openSettings = useUiStore((s) => s.openSettings)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  useEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [messages])

  const suggestions = t('chat.suggestions', { returnObjects: true }) as string[]

  return (
    <div className="flex h-full min-h-0 flex-col">
      {mockAgent ? (
        <div className="flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-1.5 text-xs text-fg">
          <AlertTriangle size={14} className="text-warning" /> {t('chat.mockBanner')}
          <button className="ml-auto underline" onClick={() => openSettings('account')}>{t('errors.openSettings')}</button>
        </div>
      ) : null}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-6 py-5"
        onScroll={(e) => {
          const el = e.currentTarget
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          {messages.length === 0 ? (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-[12vh] flex flex-col items-center text-center">
              <div className="mb-4 h-20 w-20 rounded-full" style={{ background: 'radial-gradient(circle at 32% 28%, #fff 0%, var(--accent-2) 22%, var(--accent) 70%, #2a1f7a 100%)', boxShadow: '0 20px 50px -20px var(--accent)' }} />
              <h1 className="text-2xl font-semibold">{t('chat.empty')}</h1>
              <p className="mt-2 max-w-md text-sm text-muted">{t('chat.emptyHint', { hotkey: hotkey.replace('CommandOrControl', 'Ctrl') })}</p>
              <div className="mt-6 grid w-full max-w-lg grid-cols-1 gap-2 sm:grid-cols-2">
                {suggestions.map((s) => (
                  <button key={s} className="flex items-start gap-2 rounded-xl border border-line bg-elev px-3 py-2.5 text-left text-[13px] text-muted hover:border-accent/50 hover:text-fg" onClick={() => void send({ text: s })}>
                    <Sparkles size={14} className="mt-0.5 shrink-0 text-accent" /> {s}
                  </button>
                ))}
              </div>
            </motion.div>
          ) : null}
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          <AnimatePresence>
            {error ? (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-3 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm">
                <AlertTriangle size={16} className="shrink-0 text-danger" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{t(`errors.${error.code}`, { defaultValue: t('errors.unknown') })}</div>
                  <div className="truncate text-xs text-muted selectable" title={error.message}>{error.message}</div>
                </div>
                {error.code === 'authentication_failed' ? <Button size="sm" onClick={() => openSettings('account')}>{t('errors.openSettings')}</Button> : null}
                <Button size="sm" variant="ghost" onClick={clearError}>{t('common.close')}</Button>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
      <div className="shrink-0 px-6 pb-4 pt-2">
        <div className="mx-auto max-w-3xl">
          <Composer />
          <div className="mt-1.5 flex items-center gap-3 px-1 text-[11px] text-faint">
            {lastResult ? (
              <>
                {lastResult.totalCostUsd !== undefined ? (
                  <span>{t('chat.cost')}: {formatUsd(lastResult.costUsd ?? 0)} {t('chat.turnCost')} · {formatUsd(totalCost ?? 0)} {t('chat.total')}</span>
                ) : null}
                <span>{t('chat.tokens')}: {formatTokens(lastResult.inputTokens)} in / {formatTokens(lastResult.outputTokens)} out{lastResult.cacheReadTokens ? ` · cache ${formatTokens(lastResult.cacheReadTokens)}` : ''}</span>
              </>
            ) : null}
            {rateLimit && rateLimit.utilization !== undefined ? (
              <span className={rateLimit.status === 'rejected' ? 'text-danger' : rateLimit.status === 'allowed_warning' ? 'text-warning' : ''}>
                limit {rateLimit.rateLimitType ?? ''}: {Math.round(rateLimit.utilization * 100)}%{rateLimit.resetsAt ? ` · reset ${new Date(rateLimit.resetsAt * 1000).toLocaleTimeString()}` : ''}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
