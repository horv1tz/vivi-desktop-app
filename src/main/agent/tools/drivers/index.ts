import { screen } from 'electron'
import type { InputDriverInfo } from '@shared/events'
import type { InputDriver } from '../input-driver'
import { RobotJsDriver } from './robotjs'
import { NativeCliDriver } from './native-cli'
import { logger } from '../../../logging/log'

const log = logger('input')

let resolved: InputDriver | null | undefined
let attempts: InputDriverInfo['attempts'] = []

/**
 * OBS-01: why the active driver is what it is, and what was tried and skipped along the way — for
 * the Diagnostics panel. Triggers resolution (same as resolveInputDriver) if it hasn't run yet, so
 * the panel doesn't have to separately force it.
 */
export async function getInputDriverInfo(): Promise<InputDriverInfo> {
  const driver = await resolveInputDriver()
  return { active: driver?.name ?? null, attempts }
}

/** Picks robotjs when its prebuild loads, otherwise the OS command-line fallback. */
export async function resolveInputDriver(): Promise<InputDriver | null> {
  if (resolved !== undefined) return resolved
  attempts = []
  const forced = process.env.VIVI_INPUT_DRIVER
  const candidates: InputDriver[] =
    forced === 'native'
      ? [new NativeCliDriver()]
      : forced === 'robotjs'
        ? [new RobotJsDriver()]
        : [new RobotJsDriver(), new NativeCliDriver()]
  for (const c of candidates) {
    if (await c.available()) {
      log.info(`input driver: ${c.name}`)
      attempts.push({ name: c.name, ok: true })
      resolved = c
      return c
    }
    const reason =
      c instanceof RobotJsDriver
        ? (c.getLoadError() ?? undefined)
        : process.platform === 'linux'
          ? 'neither xdotool nor ydotool found'
          : undefined
    attempts.push({ name: c.name, ok: false, reason })
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
      if (corners.some(([cx, cy]) => Math.abs(pos.x - cx!) <= 2 && Math.abs(pos.y - cy!) <= 2))
        throw new Error('fail-safe: mouse is in a screen corner, automation aborted')
    }
  }
}
