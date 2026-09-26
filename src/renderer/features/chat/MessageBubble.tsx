import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Brain, ChevronDown, Copy } from 'lucide-react'
import type { UiMessage } from '@shared/events'
import { cn } from '../../lib/cn'
import { Markdown } from './Markdown'
import { ToolCard } from './ToolCard'
import { TypingDots } from '../../components/motion/Pulse'

export const MessageBubble = memo(function MessageBubble({ message }: { message: UiMessage }) {
  const { t } = useTranslation()
  const isUser = message.role === 'user'
  const [copied, setCopied] = useState(false)
  const text = message.blocks
    .filter((b) => b.type === 'text')
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('\n')

  if (isUser) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex justify-end"
      >
        <div className="max-w-[78%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-[14.5px] leading-relaxed text-accent-fg shadow-[0_8px_24px_-12px_var(--accent)] selectable whitespace-pre-wrap">
          {message.blocks.map((b, i) =>
            b.type === 'text' ? (
              <span key={i}>{b.text}</span>
            ) : b.type === 'image' ? (
              <img
                key={i}
                src={`data:${b.mimeType};base64,${b.data}`}
                alt=""
                className="mt-2 max-h-56 rounded-lg"
              />
            ) : null,
          )}
        </div>
      </motion.div>
    )
  }

  const empty = message.blocks.length === 0
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'group flex gap-3',
        message.parentToolUseId && 'ml-6 border-l-2 border-line pl-3',
      )}
    >
      <div
        className="mt-1 h-7 w-7 shrink-0 rounded-full"
        style={{
          background:
            'radial-gradient(circle at 32% 28%, #fff 0%, var(--accent-2) 22%, var(--accent) 70%)',
        }}
      />
      <div className="min-w-0 flex-1 text-[14.5px]">
        {empty && message.streaming ? (
          <div className="py-2">
            <TypingDots />
          </div>
        ) : null}
        {message.blocks.map((b, i) => {
          if (b.type === 'text') return b.text ? <Markdown key={i} text={b.text} /> : null
          if (b.type === 'tool_use') return <ToolCard key={b.toolUseId} block={b} />
          if (b.type === 'thinking') return <ThinkingBlock key={i} text={b.text} />
          if (b.type === 'image')
            return (
              <img
                key={i}
                src={`data:${b.mimeType};base64,${b.data}`}
                alt=""
                className="my-2 max-h-72 rounded-lg border border-line"
              />
            )
          return null
        })}
        {!message.streaming && text ? (
          <button
            className="mt-1 hidden items-center gap-1 text-[11px] text-faint hover:text-fg group-hover:inline-flex"
            onClick={async () => {
              await navigator.clipboard.writeText(text)
              setCopied(true)
              setTimeout(() => setCopied(false), 1200)
            }}
          >
            <Copy size={12} /> {copied ? t('chat.copied') : t('chat.copy')}
          </button>
        ) : null}
      </div>
    </motion.div>
  )
})

function ThinkingBlock({ text }: { text: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  if (!text.trim()) return null
  return (
    <div className="my-1 text-[13px]">
      <button
        className="inline-flex items-center gap-1 text-faint hover:text-muted"
        onClick={() => setOpen((v) => !v)}
      >
        <Brain size={13} /> {t('chat.thinking')}{' '}
        <ChevronDown size={12} className={cn('transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div className="mt-1 whitespace-pre-wrap rounded-lg border border-line bg-sunken/60 p-2 text-muted selectable">
          {text}
        </div>
      ) : null}
    </div>
  )
}
