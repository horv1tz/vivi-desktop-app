import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2 } from 'lucide-react'
import type { MemoryEntry } from '@shared/events'
import { invoke } from '../../../lib/bridge'
import { Section } from '../../../components/ui/Field'
import { Button } from '../../../components/ui/Button'
import { relativeTime } from '../../../lib/format'
import { useSettingsStore } from '../../../stores/settings'

export function MemorySection() {
  const { t } = useTranslation()
  const lang = useSettingsStore((s) => s.settings.appearance.language)
  const [entries, setEntries] = useState<MemoryEntry[]>([])

  const refresh = useCallback(() => {
    invoke('memory:list')
      .then(setEntries)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <Section title={t('settings.memory.title')} description={t('settings.memory.description')}>
      {entries.length > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={async () => {
            await invoke('memory:clear')
            refresh()
          }}
        >
          <Trash2 size={14} /> {t('settings.memory.clearAll')}
        </Button>
      ) : null}
      {entries.length === 0 ? (
        <p className="px-1 py-2 text-sm text-faint">{t('settings.memory.empty')}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="flex items-start gap-2 rounded-lg bg-sunken px-3 py-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                <span className="mr-1.5 rounded bg-line/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                  {t(`settings.memory.types.${entry.type}`)}
                </span>
                <span className="text-fg">{entry.text}</span>
                <div className="text-[11px] text-faint">{relativeTime(entry.createdAt, lang)}</div>
              </div>
              <button
                className="shrink-0 rounded-md p-1 text-faint hover:bg-danger/15 hover:text-danger"
                title={t('settings.memory.delete')}
                onClick={async () => {
                  await invoke('memory:delete', entry.id)
                  refresh()
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}
