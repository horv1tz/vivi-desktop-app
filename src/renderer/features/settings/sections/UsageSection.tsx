import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Trash2 } from 'lucide-react'
import type { MetricsSummary } from '@shared/events'
import { invoke } from '../../../lib/bridge'
import { Section } from '../../../components/ui/Field'
import { Button } from '../../../components/ui/Button'
import { formatTokens, formatUsd } from '../../../lib/format'

const RECENT_DAYS = 14

export function UsageSection() {
  const { t } = useTranslation()
  const [summary, setSummary] = useState<MetricsSummary | null>(null)

  const refresh = useCallback(() => {
    invoke('metrics:summary')
      .then(setSummary)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const recentDays = summary?.daily.slice(-RECENT_DAYS).reverse() ?? []

  return (
    <Section title={t('settings.usage.title')} description={t('settings.usage.description')}>
      <div className="flex gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            await invoke('metrics:exportCsv')
          }}
        >
          <Download size={14} /> {t('settings.usage.exportCsv')}
        </Button>
        {summary && summary.totalTurns > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await invoke('metrics:clear')
              refresh()
            }}
          >
            <Trash2 size={14} /> {t('settings.usage.clearAll')}
          </Button>
        ) : null}
      </div>
      {!summary || summary.totalTurns === 0 ? (
        <p className="px-1 py-2 text-sm text-faint">{t('settings.usage.empty')}</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-sunken px-3 py-2">
              <div className="text-[11px] text-faint">{t('settings.usage.totalCost')}</div>
              <div className="text-lg font-medium">{formatUsd(summary.totalCostUsd)}</div>
            </div>
            <div className="rounded-lg bg-sunken px-3 py-2">
              <div className="text-[11px] text-faint">{t('settings.usage.totalTokens')}</div>
              <div className="text-lg font-medium">
                {formatTokens(summary.totalInputTokens + summary.totalOutputTokens)}
              </div>
            </div>
            <div className="rounded-lg bg-sunken px-3 py-2">
              <div className="text-[11px] text-faint">{t('settings.usage.totalTurns')}</div>
              <div className="text-lg font-medium">{summary.totalTurns}</div>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <div className="px-1 text-[11px] font-medium uppercase tracking-wide text-faint">
              {t('settings.usage.byDay')}
            </div>
            <div className="flex flex-col gap-1">
              {recentDays.map((d) => (
                <div
                  key={d.date}
                  className="flex items-center justify-between rounded-lg bg-sunken px-3 py-1.5 text-sm"
                >
                  <span className="text-muted">{d.date}</span>
                  <span className="text-faint">
                    {t('settings.usage.turnsCount', { count: d.turns })}
                  </span>
                  <span className="font-medium">{formatUsd(d.costUsd)}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </Section>
  )
}
