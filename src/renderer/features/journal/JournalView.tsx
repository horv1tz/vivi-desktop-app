import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { ArrowLeft, Download, Trash2 } from 'lucide-react'
import type { JournalEntry } from '@shared/events'
import { invoke, useViviEvent } from '../../lib/bridge'
import { useUiStore } from '../../stores/ui'
import { useSettingsStore } from '../../stores/settings'
import { relativeTime } from '../../lib/format'
import { Button } from '../../components/ui/Button'

export function JournalView() {
  const { t } = useTranslation()
  const setView = useUiStore((s) => s.setView)
  const lang = useSettingsStore((s) => s.settings.appearance.language)
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [exportedPath, setExportedPath] = useState<string | null>(null)

  const refresh = useCallback(() => {
    invoke('journal:list')
      .then(setEntries)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useViviEvent(
    'agent:event',
    useCallback(
      (e) => {
        if (e.type === 'tool-use' || e.type === 'tool-result') refresh()
      },
      [refresh],
    ),
  )

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => setView('chat')}>
          <ArrowLeft size={16} /> {t('nav.chat')}
        </Button>
        <h2 className="text-xl font-semibold">{t('journal.title')}</h2>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={entries.length === 0}
            onClick={async () => setExportedPath(await invoke('journal:export'))}
          >
            <Download size={14} /> {t('journal.export')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={entries.length === 0}
            onClick={async () => {
              await invoke('journal:clear')
              refresh()
            }}
          >
            <Trash2 size={14} /> {t('journal.clear')}
          </Button>
        </div>
      </div>
      {exportedPath ? (
        <p className="text-xs text-muted">{t('journal.exported', { path: exportedPath })}</p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <p className="px-2 py-3 text-sm text-faint">{t('journal.empty')}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {entries.map((entry) => (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-xl border border-line bg-sunken/60 px-3 py-2 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[12px] text-fg">{entry.name}</span>
                  <span className="shrink-0 text-[11px] text-faint">
                    {relativeTime(entry.timestamp, lang)}
                  </span>
                </div>
                <pre className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[11px] text-muted selectable">
                  {entry.input}
                </pre>
                {entry.result ? (
                  <p
                    className={
                      entry.result.isError
                        ? 'mt-1 text-[11px] text-danger'
                        : 'mt-1 text-[11px] text-muted'
                    }
                  >
                    {entry.result.content.length > 300
                      ? `${entry.result.content.slice(0, 300)}…`
                      : entry.result.content}
                  </p>
                ) : (
                  <p className="mt-1 text-[11px] text-faint">{t('journal.running')}</p>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
