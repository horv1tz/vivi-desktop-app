import { globalShortcut } from 'electron'
import { settings } from '../settings/store'
import { logger } from '../logging/log'

const log = logger('shortcuts')

export interface ShortcutActions {
  onOverlay: () => void
  onKillSwitch: () => void
}

let registered: string[] = []

export function registerShortcuts(actions: ShortcutActions): void {
  unregisterShortcuts()
  const s = settings().get().appearance
  const bind = (accelerator: string, fn: () => void, name: string): void => {
    if (!accelerator) return
    try {
      const ok = globalShortcut.register(accelerator, fn)
      if (ok) registered.push(accelerator)
      else log.warn(`could not register ${name} shortcut ${accelerator} (in use?)`)
    } catch (err) {
      log.warn(`invalid ${name} shortcut ${accelerator}`, err)
    }
  }
  bind(s.overlayHotkey, actions.onOverlay, 'overlay')
  bind(s.killSwitchHotkey, actions.onKillSwitch, 'kill-switch')
}

export function unregisterShortcuts(): void {
  for (const acc of registered) globalShortcut.unregister(acc)
  registered = []
}
