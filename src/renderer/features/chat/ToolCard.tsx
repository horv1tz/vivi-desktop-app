import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { CheckCircle2, ChevronDown, CircleAlert, Loader2, Wrench } from 'lucide-react'
import type { UiToolUseBlock } from '@shared/events'
import { cn } from '../../lib/cn'

function summarize(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const i = input as Record<string, unknown>
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = i[k]
      if (typeof v === 'string' && v.trim()) return v
    }
    return ''
  }
  switch (name) {
    case 'Bash':
    case 'PowerShell':
      return pick('command')
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return pick('file_path', 'notebook_path', 'path')
    case 'Glob':
    case 'Grep':
      return pick('pattern')
    case 'WebSearch':
      return pick('query')
    case 'WebFetch':
      return pick('url')
    case 'Agent':
      return pick('description', 'prompt')
    case 'mcp__vivi__open':
      return pick('target')
    case 'mcp__vivi__keyboard':
      return pick('text', 'keys')
    case 'mcp__vivi__speak':
      return pick('text')
    default: {
      const first = Object.values(i).find((v) => typeof v === 'string') as string | undefined
      return first ?? ''
    }
  }
}

export function ToolCard({ block }: { block: UiToolUseBlock }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const done = !!block.result
  const error = block.result?.isError
  const label = t(`tools.${block.name}`, { defaultValue: '' }) || `${t('tools.generic')} ${block.name.replace(/^mcp__vivi__/, '')}`
  const summary = summarize(block.name, block.input)

  return (
    <motion.div layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className={cn('my-1.5 overflow-hidden rounded-xl border bg-sunken/70 text-[13px]', error ? 'border-danger/40' : 'border-line')}>
      <button className="flex w-full items-center gap-2 px-3 py-2 text-left" onClick={() => setOpen((v) => !v)}>
        <span className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-md', error ? 'text-danger' : done ? 'text-success' : 'text-accent')}>
          {!done ? <Loader2 size={15} className="animate-spin" /> : error ? <CircleAlert size={15} /> : <CheckCircle2 size={15} />}
        </span>
        <span className="shrink-0 font-medium text-fg">{label}</span>
        {summary ? <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted">{summary}</span> : <span className="flex-1" />}
        {block.result?.durationMs ? <span className="text-[11px] text-faint">{(block.result.durationMs / 1000).toFixed(1)}s</span> : null}
        <ChevronDown size={14} className={cn('shrink-0 text-faint transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
            <div className="border-t border-line px-3 py-2">
              <div className="mb-1 flex items-center gap-1 text-[11px] uppercase tracking-wide text-faint"><Wrench size={11} /> input</div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-bg p-2 font-mono text-[12px] selectable">{JSON.stringify(block.input, null, 2)}</pre>
              {block.result ? (
                <>
                  <div className="mb-1 mt-2 text-[11px] uppercase tracking-wide text-faint">{error ? t('chat.toolError') : t('chat.toolDone')}</div>
                  <pre className={cn('max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-bg p-2 font-mono text-[12px] selectable', error && 'text-danger')}>{block.result.content || '—'}</pre>
                  {block.result.images?.map((img, i) => (
                    <img key={i} src={`data:${img.mimeType};base64,${img.data}`} alt="tool output" className="mt-2 max-h-72 rounded-lg border border-line" />
                  ))}
                </>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  )
}
