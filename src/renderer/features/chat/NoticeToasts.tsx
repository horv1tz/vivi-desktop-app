import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { AlertOctagon, AlertTriangle, Info, X } from 'lucide-react'
import type { AgentNotice } from '@shared/events'
import { useChatStore } from '../../stores/chat'
import { cn } from '../../lib/cn'

const SEVERITY_ICON: Record<string, typeof Info> = {
  info: Info,
  warning: AlertTriangle,
  error: AlertOctagon,
}

/**
 * ACP-03: renders ACP `notice` updates as toasts. Experimental on the wire (agents must not rely
 * on one being seen), so this is genuinely best-effort UI, not a channel anything critical should
 * depend on — real answers still belong in the transcript.
 */
export function NoticeToasts() {
  const notices = useChatStore((s) => s.notices)
  const dismiss = useChatStore((s) => s.dismissNotice)
  if (notices.length === 0) return null

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(92vw,360px)] flex-col gap-2">
      <AnimatePresence initial={false}>
        {notices.map((n) => (
          <ToastItem key={n.id} notice={n} onDismiss={() => dismiss(n.id)} />
        ))}
      </AnimatePresence>
    </div>
  )
}

function ToastItem({ notice, onDismiss }: { notice: AgentNotice; onDismiss: () => void }) {
  const { t } = useTranslation()
  const Icon = SEVERITY_ICON[notice.severity] ?? Info
  return (
    <motion.div
      role="status"
      initial={{ opacity: 0, x: 24, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 24, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 400, damping: 32 }}
      className={cn(
        'pointer-events-auto flex items-start gap-2.5 rounded-xl border bg-elev p-3 text-sm shadow-[var(--shadow)]',
        notice.severity === 'error'
          ? 'border-danger/40'
          : notice.severity === 'warning'
            ? 'border-warning/40'
            : 'border-line',
      )}
    >
      <Icon
        size={16}
        className={cn(
          'mt-0.5 shrink-0',
          notice.severity === 'error'
            ? 'text-danger'
            : notice.severity === 'warning'
              ? 'text-warning'
              : 'text-accent',
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-fg">{notice.title}</div>
        {notice.description ? (
          <div className="mt-0.5 text-xs text-muted">{notice.description}</div>
        ) : null}
      </div>
      <button
        onClick={onDismiss}
        aria-label={t('common.close')}
        className="shrink-0 rounded-md p-0.5 text-faint hover:bg-line/60 hover:text-fg"
      >
        <X size={14} />
      </button>
    </motion.div>
  )
}
