import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { Maximize2, X } from 'lucide-react'
import { useChatStore } from '../../stores/chat'
import { useVoiceStore } from '../../stores/voice'
import { invoke, useViviEvent } from '../../lib/bridge'
import { Orb } from '../../components/motion/Orb'
import { Composer } from '../chat/Composer'
import { Markdown } from '../chat/Markdown'

export function OverlayView() {
  const { t } = useTranslation()
  const messages = useChatStore((s) => s.messages)
  const sessionState = useChatStore((s) => s.sessionState)
  const voice = useVoiceStore()
  const last = [...messages].reverse().find((m) => m.role === 'assistant')
  const lastText = last?.blocks.filter((b) => b.type === 'text').map((b) => (b.type === 'text' ? b.text : '')).join('\n') ?? ''
  const running = sessionState === 'running'
  const orbState = voice.state === 'listening' || voice.state === 'speaking' ? voice.state : running ? 'thinking' : voice.state === 'off' ? 'idle' : voice.state

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') void invoke('window:hideOverlay')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useViviEvent(
    'overlay:visibility',
    useCallback((visible: boolean) => {
      if (visible) document.querySelector<HTMLTextAreaElement>('textarea')?.focus()
    }, []),
  )

  const caption = voice.state === 'listening' ? t('overlay.listening') : running ? t('overlay.thinking') : voice.state === 'speaking' ? t('overlay.speaking') : t('overlay.idle')

  return (
    <div className="flex h-screen w-screen items-start justify-center p-3">
      <motion.div initial={{ opacity: 0, y: -12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 320, damping: 26 }} className="glass drag-region flex w-full flex-col gap-3 rounded-3xl p-4">
        <div className="flex items-center gap-4">
          <Orb state={orbState} level={voice.level} size={72} />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-muted">{caption}</div>
            <AnimatePresence mode="wait">
              {voice.transcript && !voice.transcriptFinal ? (
                <motion.div key="t" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="truncate text-lg text-fg">{voice.transcript}</motion.div>
              ) : null}
            </AnimatePresence>
          </div>
          <div className="no-drag flex items-center gap-1">
            <button className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-line/60 hover:text-fg" title={t('overlay.expand')} onClick={async () => { await invoke('window:showMain'); await invoke('window:hideOverlay') }}><Maximize2 size={15} /></button>
            <button className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-line/60 hover:text-fg" title={t('overlay.close')} onClick={() => invoke('window:hideOverlay')}><X size={16} /></button>
          </div>
        </div>
        <div className="no-drag">
          <Composer compact autoFocus />
        </div>
        <AnimatePresence>
          {lastText ? (
            <motion.div key={last?.id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="no-drag max-h-52 overflow-y-auto rounded-2xl bg-sunken/70 px-4 py-3 text-[14px]">
              <Markdown text={lastText} />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
