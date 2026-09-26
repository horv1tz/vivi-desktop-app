import { screen } from 'electron'
import type { InputDriver } from '../input-driver'
import { RobotJsDriver } from './robotjs'
import { NativeCliDriver } from './native-cli'
import { logger } from '../../../logging/log'

const log = logger('input')

let resolved: InputDriver | null | undefined

/** Picks robotjs when its prebuild loads, otherwise the OS command-line fallback. */
export async function resolveInputDriver(): Promise<InputDriver | null> {
  if (resolved !== undefined) return resolved
  const forced = process.env.VIVI_INPUT_DRIVER
  const candidates: InputDriver[] = forced === 'native' ? [new NativeCliDriver()] : forced === 'robotjs' ? [new RobotJsDriver()] : [new RobotJsDriver(), new NativeCliDriver()]
  for (const c of candidates) {
    if (await c.available()) {
      log.info(`input driver: ${c.name}`)
      resolved = c
      return c
    }
  }
  log.warn('no input driver available (mouse/keyboard control disabled)')
  resolved = null
  return null
}

/** Fail-safe: aborts automation when the user parks the cursor in a screen corner or hit the kill switch. */
export class InputGuard {
  private killed = false

  trip(): void {
    this.killed = true
  }

  reset(): void {
    this.killed = false
  }

  async check(driver: InputDriver): Promise<void> {
    if (this.killed) throw new Error('automation stopped by the user (kill switch)')
    const pos = await driver.getMousePos().catch(() => null)
    if (!pos) return
    for (const d of screen.getAllDisplays()) {
      const { x, y, width, height } = d.bounds
      const corners = [
        [x, y],
        [x + width - 1, y],
        [x, y + height - 1],
        [x + width - 1, y + height - 1],
      ]
      if (corners.some(([cx, cy]) => Math.abs(pos.x - cx!) <= 2 && Math.abs(pos.y - cy!) <= 2)) throw new Error('fail-safe: mouse is in a screen corner, automation aborted')
    }
  }
}
