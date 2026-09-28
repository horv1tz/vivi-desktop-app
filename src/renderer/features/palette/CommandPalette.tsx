import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog as RadixDialog } from 'radix-ui'
import { AnimatePresence, motion } from 'motion/react'
import {
  Activity,
  Bot,
  Cable,
  Database,
  Gauge,
  Globe,
  Info,
  MessageSquare,
  MessageSquarePlus,
  Mic,
  MicOff,
  PictureInPicture2,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Stethoscope,
  User,
  Wand2,
  type LucideIcon,
} from 'lucide-react'
import type { SettingsSection } from '../../stores/ui'
import { SETTINGS_SECTIONS, useUiStore } from '../../stores/ui'
import { useChatStore } from '../../stores/chat'
import { useSettingsStore } from '../../stores/settings'
import { usePaletteStore } from '../../stores/palette'
import { invoke } from '../../lib/bridge'
import { cn } from '../../lib/cn'

interface PaletteAction {
  id: string
  label: string
  hint?: string
  icon: LucideIcon
  run: () => void
}

const SETTINGS_SECTION_ICONS: Record<SettingsSection, LucideIcon> = {
  general: SlidersHorizontal,
  account: User,
  agent: Bot,
  memory: Database,
  voice: Mic,
  proxy: Globe,
  permissions: ShieldCheck,
  usage: Gauge,
  diagnostics: Stethoscope,
  about: Info,
}

export function CommandPalette() {
  const open = usePaletteStore((s) => s.open)
  const setOpen = usePaletteStore((s) => s.setOpen)

  // UX-05: Ctrl/Cmd+K opens the palette from anywhere in the main window, regardless of which
  // element currently has DOM focus (chat composer, a settings field, …).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setOpen])

  return (
    <RadixDialog.Root open={open} onOpenChange={setOpen}>
      <AnimatePresence>
        {open ? <PaletteContent onClose={() => setOpen(false)} /> : null}
      </AnimatePresence>
    </RadixDialog.Root>
  )
}

/** Mounted fresh each time the palette opens, so `query`/`activeIndex` start clean with no reset effect needed. */
function PaletteContent({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const view = useUiStore((s) => s.view)
  const setView = useUiStore((s) => s.setView)
  const openSettings = useUiStore((s) => s.openSettings)
  const newSession = useChatStore((s) => s.newSession)
  const backend = useSettingsStore((s) => s.settings.agent.backend)
  const voiceEnabled = useSettingsStore((s) => s.settings.voice.enabled)
  const update = useSettingsStore((s) => s.update)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const actions = useMemo((): PaletteAction[] => {
    const list: PaletteAction[] = [
      {
        id: 'new-chat',
        label: t('palette.newChat'),
        icon: MessageSquarePlus,
        run: () => {
          void newSession()
          setView('chat')
        },
      },
    ]
    if (view !== 'chat')
      list.push({
        id: 'go-chat',
        label: t('palette.goChat'),
        icon: MessageSquare,
        run: () => setView('chat'),
      })
    if (view !== 'journal')
      list.push({
        id: 'go-journal',
        label: t('palette.goJournal'),
        icon: Activity,
        run: () => setView('journal'),
      })
    if (view !== 'workshop')
      list.push({
        id: 'go-workshop',
        label: t('palette.goWorkshop'),
        icon: Wand2,
        run: () => setView('workshop'),
      })
    for (const section of SETTINGS_SECTIONS)
      list.push({
        id: `settings-${section}`,
        label: t('palette.openSettingsSection', { section: t(`settings.sections.${section}`) }),
        icon: SETTINGS_SECTION_ICONS[section],
        run: () => openSettings(section),
      })
    const otherBackend = backend === 'sdk' ? 'acp' : 'sdk'
    list.push({
      id: 'switch-backend',
      label: t('palette.switchBackend', { backend: t(`settings.agent.backends.${otherBackend}`) }),
      icon: Cable,
      run: () => void update({ agent: { backend: otherBackend } }),
    })
    list.push({
      id: 'toggle-voice',
      label: voiceEnabled ? t('palette.voiceOff') : t('palette.voiceOn'),
      icon: voiceEnabled ? MicOff : Mic,
      run: () => void update({ voice: { enabled: !voiceEnabled } }),
    })
    list.push({
      id: 'toggle-overlay',
      label: t('palette.toggleOverlay'),
      icon: PictureInPicture2,
      run: () => void invoke('window:toggleOverlay'),
    })
    list.push({
      id: 'open-settings',
      label: t('palette.openSettings'),
      icon: Settings,
      run: () => openSettings(),
    })
    return list
  }, [t, view, backend, voiceEnabled, newSession, setView, openSettings, update])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return actions
    return actions.filter((a) => a.label.toLowerCase().includes(q))
  }, [actions, query])

  const runAndClose = (action: PaletteAction): void => {
    action.run()
    onClose()
  }

  return (
    <RadixDialog.Portal forceMount>
      <RadixDialog.Overlay asChild>
        <motion.div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        />
      </RadixDialog.Overlay>
      <RadixDialog.Content asChild aria-describedby={undefined}>
        <motion.div
          className="fixed left-1/2 top-[14vh] z-50 w-[min(92vw,560px)] -translate-x-1/2 overflow-hidden rounded-2xl border border-line bg-elev shadow-[var(--shadow)]"
          initial={{ opacity: 0, scale: 0.97, y: -6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.98, y: -4 }}
          transition={{ type: 'spring', stiffness: 420, damping: 32 }}
        >
          <RadixDialog.Title className="sr-only">{t('palette.title')}</RadixDialog.Title>
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <Search size={16} className="shrink-0 text-faint" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActiveIndex(0)
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setActiveIndex((i) => (filtered.length ? (i + 1) % filtered.length : 0))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setActiveIndex((i) =>
                    filtered.length ? (i - 1 + filtered.length) % filtered.length : 0,
                  )
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  const action = filtered[activeIndex]
                  if (action) runAndClose(action)
                }
              }}
              placeholder={t('palette.placeholder')}
              aria-label={t('palette.title')}
              role="combobox"
              aria-expanded="true"
              aria-controls="palette-listbox"
              aria-activedescendant={
                filtered[activeIndex] ? `palette-option-${filtered[activeIndex].id}` : undefined
              }
              className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-faint"
            />
          </div>
          <div id="palette-listbox" role="listbox" className="max-h-[50vh] overflow-y-auto p-1.5">
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-center text-sm text-faint">{t('palette.noResults')}</p>
            ) : (
              filtered.map((action, i) => (
                <button
                  key={action.id}
                  id={`palette-option-${action.id}`}
                  role="option"
                  aria-selected={i === activeIndex}
                  tabIndex={-1}
                  onClick={() => runAndClose(action)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-fg',
                    i === activeIndex ? 'bg-line/70' : 'hover:bg-line/40',
                  )}
                >
                  <action.icon size={16} className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate">{action.label}</span>
                </button>
              ))
            )}
          </div>
        </motion.div>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  )
}
