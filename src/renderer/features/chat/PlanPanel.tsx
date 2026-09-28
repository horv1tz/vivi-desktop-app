import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { CheckCircle2, ChevronDown, ChevronUp, Circle, CircleDot, ListTodo } from 'lucide-react'
import type { PlanEntryUi } from '@shared/events'
import { useChatStore } from '../../stores/chat'
import { cn } from '../../lib/cn'

const STATUS_ICON: Record<PlanEntryUi['status'], typeof Circle> = {
  pending: Circle,
  in_progress: CircleDot,
  completed: CheckCircle2,
}

/** ACP-03: the agent's own execution plan (ACP `plan` session updates) — a live TODO list the
 * agent reports for complex tasks, not something Vivi derives itself. */
export function PlanPanel() {
  const { t } = useTranslation()
  const plan = useChatStore((s) => s.plan)
  const [collapsed, setCollapsed] = useState(false)
  if (!plan || plan.length === 0) return null
  const done = plan.filter((e) => e.status === 'completed').length

  return (
    <div className="border-b border-line bg-elev/60 px-4 py-2">
      <button
        className="flex w-full items-center gap-2 text-left text-xs font-medium text-muted"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
      >
        <ListTodo size={14} className="shrink-0 text-accent" />
        <span>
          {t('chat.plan')} · {done}/{plan.length}
        </span>
        {collapsed ? (
          <ChevronDown size={14} className="ml-auto shrink-0" />
        ) : (
          <ChevronUp size={14} className="ml-auto shrink-0" />
        )}
      </button>
      <AnimatePresence initial={false}>
        {!collapsed ? (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="mt-1.5 overflow-hidden"
          >
            {plan.map((entry, i) => {
              const Icon = STATUS_ICON[entry.status]
              return (
                <li
                  key={i}
                  className={cn(
                    'flex items-center gap-2 py-0.5 text-[13px]',
                    entry.status === 'completed' ? 'text-faint line-through' : 'text-fg',
                  )}
                >
                  <Icon
                    size={13}
                    className={cn(
                      'shrink-0',
                      entry.status === 'completed'
                        ? 'text-success'
                        : entry.status === 'in_progress'
                          ? 'text-accent'
                          : 'text-faint',
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{entry.content}</span>
                </li>
              )
            })}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
