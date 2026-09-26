import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUp, ImagePlus, Mic, Square, X } from 'lucide-react'
import { motion } from 'motion/react'
import { useChatStore } from '../../stores/chat'
import { useVoiceStore } from '../../stores/voice'
import { invoke } from '../../lib/bridge'
import { cn } from '../../lib/cn'

async function fileToBase64(file: File): Promise<{ mimeType: string; data: string }> {
  const buf = await file.arrayBuffer()
  let bin = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return { mimeType: file.type || 'image/png', data: btoa(bin) }
}

export function Composer({
  autoFocus = true,
  compact = false,
  onSent,
}: {
  autoFocus?: boolean
  compact?: boolean
  onSent?: () => void
}) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [images, setImages] = useState<{ mimeType: string; data: string; name: string }[]>([])
  const send = useChatStore((s) => s.send)
  const interrupt = useChatStore((s) => s.interrupt)
  const state = useChatStore((s) => s.sessionState)
  const voiceState = useVoiceStore((s) => s.state)
  const running =
    state === 'running' || state === 'awaiting_permission' || state === 'awaiting_question'
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, compact ? 120 : 220)}px`
  }, [text, compact])

  const submit = async (): Promise<void> => {
    const value = text.trim()
    if (!value && images.length === 0) return
    setText('')
    const imgs = images.map(({ mimeType, data }) => ({ mimeType, data }))
    setImages([])
    await send({ text: value, images: imgs.length ? imgs : undefined })
    onSent?.()
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit()
    }
  }

  const listening = voiceState === 'listening'

  return (
    <div
      className={cn(
        'no-drag rounded-2xl border border-line bg-elev shadow-[0_8px_30px_-18px_rgba(0,0,0,0.5)] focus-within:border-accent/60',
        compact ? 'p-1.5' : 'p-2',
      )}
    >
      {images.length ? (
        <div className="flex flex-wrap gap-2 px-2 pt-1">
          {images.map((img, i) => (
            <div key={i} className="relative">
              <img
                src={`data:${img.mimeType};base64,${img.data}`}
                alt={img.name}
                className="h-14 w-14 rounded-lg object-cover"
              />
              <button
                className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-danger text-white"
                onClick={() => setImages(images.filter((_, j) => j !== i))}
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex items-end gap-1.5">
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          className="hidden"
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? [])
            const converted = await Promise.all(
              files.map(async (f) => ({ ...(await fileToBase64(f)), name: f.name })),
            )
            setImages((prev) => [...prev, ...converted].slice(0, 6))
            e.target.value = ''
          }}
        />
        <button
          className="mb-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl text-muted hover:bg-line/60 hover:text-fg"
          title={t('composer.attach')}
          onClick={() => fileRef.current?.click()}
        >
          <ImagePlus size={18} />
        </button>
        <textarea
          ref={ref}
          value={text}
          rows={1}
          placeholder={listening ? t('overlay.listening') : t('composer.placeholder')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          onPaste={async (e) => {
            const items = Array.from(e.clipboardData.items).filter((i) =>
              i.type.startsWith('image/'),
            )
            if (!items.length) return
            e.preventDefault()
            const files = items.map((i) => i.getAsFile()).filter((f): f is File => !!f)
            const converted = await Promise.all(
              files.map(async (f) => ({ ...(await fileToBase64(f)), name: f.name })),
            )
            setImages((prev) => [...prev, ...converted].slice(0, 6))
          }}
          className="max-h-56 min-h-[36px] flex-1 resize-none bg-transparent px-2 py-2 text-[14.5px] leading-relaxed text-fg outline-none placeholder:text-faint selectable"
        />
        <motion.button
          whileTap={{ scale: 0.92 }}
          className={cn(
            'mb-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-colors',
            listening ? 'bg-danger text-white' : 'text-muted hover:bg-line/60 hover:text-fg',
          )}
          title={t('composer.mic')}
          onClick={() => invoke('voice:pushToTalk', !listening)}
        >
          <Mic size={18} />
        </motion.button>
        {running ? (
          <motion.button
            whileTap={{ scale: 0.92 }}
            className="mb-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-danger/15 text-danger hover:bg-danger/25"
            title={t('composer.stop')}
            onClick={() => void interrupt()}
          >
            <Square size={16} />
          </motion.button>
        ) : (
          <motion.button
            whileTap={{ scale: 0.92 }}
            disabled={!text.trim() && images.length === 0}
            className="mb-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent text-accent-fg shadow-[0_6px_18px_-8px_var(--accent)] disabled:opacity-40"
            title={t('composer.send')}
            onClick={() => void submit()}
          >
            <ArrowUp size={18} />
          </motion.button>
        )}
      </div>
      {!compact ? (
        <div className="px-3 pb-1 pt-0.5 text-[11px] text-faint">{t('composer.hint')}</div>
      ) : null}
    </div>
  )
}
