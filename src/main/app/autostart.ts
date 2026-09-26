import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { logger } from '../logging/log'

const log = logger('autostart')

/** Registers/unregisters Vivi to start at login (Linux: XDG autostart entry). */
export function applyAutostart(enabled: boolean, hidden: boolean): void {
  try {
    if (process.platform === 'linux') {
      const dir = join(homedir(), '.config', 'autostart')
      const file = join(dir, 'vivi.desktop')
      if (!enabled) {
        if (existsSync(file)) rmSync(file)
        return
      }
      const exec = process.env.APPIMAGE ?? process.execPath
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        file,
        `[Desktop Entry]\nType=Application\nName=Vivi\nExec=${JSON.stringify(exec)}${hidden ? ' --hidden' : ''}\nX-GNOME-Autostart-enabled=true\nTerminal=false\n`,
        'utf8',
      )
      return
    }
    if (!app.isPackaged) return
    app.setLoginItemSettings({ openAtLogin: enabled, args: hidden ? ['--hidden'] : [] })
  } catch (err) {
    log.warn('autostart update failed', err)
  }
}
