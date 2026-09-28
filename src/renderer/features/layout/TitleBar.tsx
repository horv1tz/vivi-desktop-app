import { useTranslation } from 'react-i18next'
import { Minus, Square, X, PanelLeft } from 'lucide-react'
import { invoke, isMac } from '../../lib/bridge'
import { useUiStore } from '../../stores/ui'
import { useChatStore } from '../../stores/chat'
import { cn } from '../../lib/cn'

export function TitleBar() {
  const { t } = useTranslation()
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const state = useChatStore((s) => s.sessionState)
  const status = useChatStore((s) => s.status)
  const busy = state === 'running' || status !== null

  return (
    <header
      className={cn(
        'drag-region flex h-10 shrink-0 items-center gap-2 border-b border-line bg-bg/70 px-3 backdrop-blur',
        isMac && 'pl-[86px]',
      )}
    >
      <button
        className="no-drag grid h-7 w-7 place-items-center rounded-lg text-muted hover:bg-line/60 hover:text-fg"
        onClick={toggleSidebar}
        title={t('nav.sessions')}
      >
        <PanelLeft size={16} />
      </button>
      <div className="flex items-center gap-2 text-[13px] text-muted">
        <span
          className={cn(
            'h-2 w-2 rounded-full',
            busy
              ? 'bg-accent-2 animate-pulse'
              : state === 'idle'
                ? 'bg-success'
                : state === 'failed'
                  ? 'bg-danger'
                  : 'bg-faint',
          )}
        />
        <h1 className="font-medium text-fg">Vivi</h1>
        <span>· {t(`state.${status ?? state}`)}</span>
      </div>
      <div className="flex-1" />
      {!isMac ? (
        <div className="no-drag flex items-center">
          <button
            className="grid h-8 w-10 place-items-center text-muted hover:bg-line/60 hover:text-fg"
            onClick={() => invoke('window:minimize')}
            aria-label={t('window.minimize')}
            title={t('window.minimize')}
          >
            <Minus size={14} />
          </button>
          <button
            className="grid h-8 w-10 place-items-center text-muted hover:bg-line/60 hover:text-fg"
            onClick={() => invoke('window:maximize')}
            aria-label={t('window.maximize')}
            title={t('window.maximize')}
          >
            <Square size={12} />
          </button>
          <button
            className="grid h-8 w-10 place-items-center text-muted hover:bg-danger hover:text-white"
            onClick={() => invoke('window:close')}
            aria-label={t('window.close')}
            title={t('window.close')}
          >
            <X size={14} />
          </button>
        </div>
      ) : null}
    </header>
  )
}
