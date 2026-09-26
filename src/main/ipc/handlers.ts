import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { InvokeChannel, InvokeMap } from '@shared/ipc'
import { logger } from '../logging/log'

const log = logger('ipc')

type Handler<K extends InvokeChannel> = (
  event: IpcMainInvokeEvent,
  ...args: InvokeMap[K]['args']
) => Promise<InvokeMap[K]['result']> | InvokeMap[K]['result']

/** Typed wrapper around ipcMain.handle; errors are logged and re-thrown to the renderer. */
export function handle<K extends InvokeChannel>(channel: K, fn: Handler<K>): void {
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await fn(event, ...(args as InvokeMap[K]['args']))
    } catch (err) {
      log.error(`${channel} failed:`, err)
      throw err instanceof Error ? new Error(err.message) : new Error(String(err))
    }
  })
}
