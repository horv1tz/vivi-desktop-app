import { BrowserWindow } from 'electron'
import type { EventChannel, EventMap } from '@shared/ipc'

/** Broadcast an event to every live renderer (main window + overlay). */
export function emit<K extends EventChannel>(channel: K, payload: EventMap[K]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload)
  }
}

export function emitTo<K extends EventChannel>(win: BrowserWindow | null, channel: K, payload: EventMap[K]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}
