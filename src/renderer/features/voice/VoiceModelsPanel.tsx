import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Download, Loader2, Trash2 } from 'lucide-react'
import type { ModelDownloadProgress } from '@shared/events'
import type { VoiceModelInfo } from '@shared/ipc'
import { invoke, useViviEvent } from '../../lib/bridge'
import { useSettingsStore } from '../../stores/settings'
import { Button } from '../../components/ui/Button'
import { formatBytes } from '../../lib/format'
import { cn } from '../../lib/cn'

const KIND_ORDER: VoiceModelInfo['kind'][] = ['vad', 'stt', 'tts', 'kws']

export function VoiceModelsPanel({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const [models, setModels] = useState<VoiceModelInfo[]>([])
  const [progress, setProgress] = useState<Record<string, ModelDownloadProgress>>({})
  const voice = useSettingsStore((s) => s.settings.voice)

  const refresh = useCallback(async () => {
    try {
      setModels(await invoke('voice:listModels'))
    } catch {
      setModels([])
    }
  }, [])

  useEffect(() => {
    let alive = true
    invoke('voice:listModels')
      .then((m) => alive && setModels(m))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  useViviEvent(
    'voice:modelProgress',
    useCallback(
      (p: ModelDownloadProgress) => {
        setProgress((prev) => ({ ...prev, [p.modelId]: p }))
        if (p.status === 'done' || p.status === 'error') void refresh()
      },
      [refresh],
    ),
  )

  const required = new Set(['vad-silero-v5', voice.sttModel, voice.ttsVoice, ...(voice.wakeWordEnabled && voice.wakeWordStrategy === 'kws' ? ['kws-zipformer-en'] : [])])
  const visible = compact ? models.filter((m) => required.has(m.id)) : models
  const missingRequired = models.filter((m) => required.has(m.id) && !m.installed)

  return (
    <div className="flex flex-col gap-2">
      {missingRequired.length ? (
        <Button
          variant="primary"
          className="self-start"
          onClick={() => {
            for (const m of missingRequired) void invoke('voice:downloadModel', m.id).catch(() => undefined)
          }}
        >
          <Download size={16} /> {t('voice.downloadRequired', { count: missingRequired.length, size: Math.round(missingRequired.reduce((s, m) => s + m.sizeMb, 0)) })}
        </Button>
      ) : null}
      {KIND_ORDER.map((kind) => {
        const list = visible.filter((m) => m.kind === kind)
        if (!list.length) return null
        return (
          <div key={kind} className="flex flex-col gap-1.5">
            <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-faint">{t(`voice.kinds.${kind}`)}</div>
            {list.map((m) => {
              const p = progress[m.id]
              const busy = p && (p.status === 'downloading' || p.status === 'extracting')
              const pct = p && p.totalBytes ? Math.min(100, Math.round((p.receivedBytes / p.totalBytes) * 100)) : 0
              return (
                <div key={m.id} className={cn('flex items-center gap-3 rounded-xl border px-3 py-2', required.has(m.id) ? 'border-accent/40 bg-accent/5' : 'border-line bg-elev')}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium">{m.name}</span>
                      <span className="rounded-md bg-sunken px-1.5 text-[10px] uppercase text-faint">{m.language}</span>
                      <span className="text-[11px] text-faint">{m.sizeMb} MB</span>
                    </div>
                    {m.description ? <div className="text-xs text-muted">{m.description}</div> : null}
                    {busy ? (
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-sunken">
                        <div className="h-full bg-accent transition-[width]" style={{ width: `${p.status === 'extracting' ? 100 : pct}%` }} />
                      </div>
                    ) : null}
                    {busy ? <div className="mt-0.5 text-[11px] text-faint">{p.status === 'extracting' ? t('voice.extracting') : `${formatBytes(p.receivedBytes)} / ${formatBytes(p.totalBytes)}`}</div> : null}
                    {p?.status === 'error' ? <div className="text-[11px] text-danger">{p.error}</div> : null}
                  </div>
                  {m.installed ? (
                    <>
                      <span className="inline-flex items-center gap-1 text-xs text-success"><Check size={14} /> {t('voice.installed')}</span>
                      {!compact ? <button className="text-faint hover:text-danger" title={t('common.remove')} onClick={async () => { await invoke('voice:deleteModel', m.id); void refresh() }}><Trash2 size={14} /></button> : null}
                    </>
                  ) : busy ? (
                    <Loader2 size={16} className="animate-spin text-accent" />
                  ) : (
                    <Button size="sm" onClick={() => void invoke('voice:downloadModel', m.id).catch(() => undefined)}><Download size={14} /> {t('voice.download')}</Button>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
