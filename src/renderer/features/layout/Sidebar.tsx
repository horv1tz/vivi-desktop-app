import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { Activity, MessageSquarePlus, Pencil, Search, Settings, Trash2, Wand2 } from 'lucide-react'
import type { SessionSummary } from '@shared/events'
import { invoke, useViviEvent } from '../../lib/bridge'
import { useUiStore } from '../../stores/ui'
import { useChatStore } from '../../stores/chat'
import { useSettingsStore } from '../../stores/settings'
import { relativeTime } from '../../lib/format'
import { cn } from '../../lib/cn'
import { Button } from '../../components/ui/Button'

export function Sidebar() {
  const { t } = useTranslation()
  const open = useUiStore((s) => s.sidebarOpen)
  const view = useUiStore((s) => s.view)
  const setView = useUiStore((s) => s.setView)
  const openSettings = useUiStore((s) => s.openSettings)
  const sessionId = useChatStore((s) => s.sessionId)
  const newSession = useChatStore((s) => s.newSession)
  const resume = useChatStore((s) => s.resume)
  const lang = useSettingsStore((s) => s.settings.appearance.language)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    try {
      setSessions(await invoke('agent:listSessions'))
    } catch {
      /* backend not ready yet */
    }
  }, [])

  useEffect(() => {
    let alive = true
    invoke('agent:listSessions')
      .then((list) => alive && setSessions(list))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])
  useViviEvent(
    'agent:event',
    useCallback(
      (e) => {
        if (e.type === 'result' || e.type === 'session') void refresh()
      },
      [refresh],
    ),
  )

  const startRename = (s: SessionSummary): void => {
    setEditingId(s.sessionId)
    setEditValue(s.title || s.firstPrompt || '')
    requestAnimationFrame(() => editInputRef.current?.select())
  }

  const commitRename = async (id: string): Promise<void> => {
    const title = editValue.trim()
    setEditingId(null)
    if (!title) return
    await invoke('agent:renameSession', id, title)
    void refresh()
  }

  // AG-09: client-side filter over the already-fetched summaries — no new search index or IPC,
  // just narrowing the visible list by title/first message.
  const filtered = sessions.filter((s) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return (
      (s.title ?? '').toLowerCase().includes(q) || (s.firstPrompt ?? '').toLowerCase().includes(q)
    )
  })

  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.aside
          key="sidebar"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 260, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 32 }}
          className="flex h-full shrink-0 flex-col overflow-hidden border-r border-line bg-sunken/60"
        >
          <div className="flex w-[260px] flex-col gap-2 p-3">
            <Button
              variant="primary"
              className="w-full justify-start"
              onClick={() => {
                void newSession()
                setView('chat')
              }}
            >
              <MessageSquarePlus size={16} /> {t('nav.newChat')}
            </Button>
          </div>
          <div className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-faint">
            {t('sessions.title')}
          </div>
          {sessions.length > 0 ? (
            <div className="px-3 pb-2">
              <div className="flex items-center gap-1.5 rounded-lg bg-sunken px-2 py-1">
                <Search size={13} className="shrink-0 text-faint" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('sessions.search')}
                  className="w-full bg-transparent text-xs text-fg outline-none placeholder:text-faint"
                />
              </div>
            </div>
          ) : null}
          <div className="min-h-0 w-[260px] flex-1 overflow-y-auto px-2">
            {sessions.length === 0 ? (
              <p className="px-2 py-3 text-xs text-faint">{t('sessions.empty')}</p>
            ) : null}
            {sessions.length > 0 && filtered.length === 0 ? (
              <p className="px-2 py-3 text-xs text-faint">{t('sessions.noMatches')}</p>
            ) : null}
            {filtered.map((s) => (
              <div
                key={s.sessionId}
                className={cn(
                  'group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm hover:bg-line/50',
                  s.sessionId === sessionId && view === 'chat' && 'bg-line/70',
                )}
              >
                {editingId === s.sessionId ? (
                  <input
                    ref={editInputRef}
                    aria-label={t('sessions.rename')}
                    value={editValue}
                    autoFocus
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => void commitRename(s.sessionId)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitRename(s.sessionId)
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    className="min-w-0 flex-1 rounded-md bg-sunken px-1.5 py-0.5 text-sm text-fg outline-none ring-1 ring-accent/60"
                  />
                ) : (
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      void resume(s.sessionId)
                      setView('chat')
                    }}
                    title={s.firstPrompt ?? s.title}
                  >
                    <div className="truncate text-fg">
                      {s.title || s.firstPrompt || s.sessionId.slice(0, 8)}
                    </div>
                    <div className="text-[11px] text-faint">
                      {relativeTime(s.lastModified, lang)}
                      {s.sessionId === sessionId ? ` · ${t('sessions.current')}` : ''}
                    </div>
                  </button>
                )}
                {editingId === s.sessionId ? null : (
                  <>
                    <button
                      className="hidden h-7 w-7 shrink-0 place-items-center rounded-md text-faint hover:bg-line/70 hover:text-fg group-hover:grid"
                      title={t('sessions.rename')}
                      onClick={() => startRename(s)}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      className="hidden h-7 w-7 shrink-0 place-items-center rounded-md text-faint hover:bg-danger/15 hover:text-danger group-hover:grid"
                      title={t('sessions.delete')}
                      onClick={async () => {
                        await invoke('agent:deleteSession', s.sessionId)
                        void refresh()
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
          <div className="flex w-[260px] flex-col gap-1 border-t border-line p-2">
            <Button
              variant="ghost"
              className={cn('w-full justify-start', view === 'journal' && 'bg-line/70 text-fg')}
              onClick={() => setView('journal')}
            >
              <Activity size={16} /> {t('nav.activity')}
            </Button>
            <Button
              variant="ghost"
              className={cn('w-full justify-start', view === 'workshop' && 'bg-line/70 text-fg')}
              onClick={() => setView('workshop')}
            >
              <Wand2 size={16} /> {t('nav.workshop')}
            </Button>
            <Button
              variant="ghost"
              className={cn('w-full justify-start', view === 'settings' && 'bg-line/70 text-fg')}
              onClick={() => openSettings()}
            >
              <Settings size={16} /> {t('nav.settings')}
            </Button>
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  )
}
