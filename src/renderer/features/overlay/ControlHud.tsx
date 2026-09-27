import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MousePointer2 } from 'lucide-react'
import { useViviEvent } from '../../lib/bridge'
import { useSettingsStore } from '../../stores/settings'

/** CU-07: input-driving tools whose activity should light up the "Vivi is controlling" HUD. */
const INPUT_TOOLS = new Set(['mcp__vivi__mouse', 'mcp__vivi__keyboard', 'mcp__vivi__windows'])

function describeAction(name: string, input: unknown): string {
  const short = name.replace('mcp__vivi__', '')
  const action =
    input && typeof input === 'object' && 'action' in input
      ? String((input as { action?: unknown }).action ?? '')
      : ''
  return action ? `${short}: ${action}` : short
}

export function ControlHud() {
  const { t } = useTranslation()
  const killHotkey = useSettingsStore((s) => s.settings.appearance.killSwitchHotkey)
  const [lastAction, setLastAction] = useState<string | null>(null)

  useViviEvent(
    'agent:event',
    useCallback((e) => {
      if (e.type === 'tool-use' && INPUT_TOOLS.has(e.block.name)) {
        setLastAction(describeAction(e.block.name, e.block.input))
      }
    }, []),
  )

  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex items-center gap-2 rounded-full border border-line bg-bg/90 px-4 py-2 text-[13px] text-fg shadow-lg backdrop-blur">
        <MousePointer2 size={14} className="shrink-0 animate-pulse text-accent" />
        <span className="font-medium">{t('hud.controlling')}</span>
        {lastAction ? <span className="truncate text-faint">· {lastAction}</span> : null}
        <span className="shrink-0 text-faint">
          · {killHotkey} {t('hud.stop')}
        </span>
      </div>
    </div>
  )
}
