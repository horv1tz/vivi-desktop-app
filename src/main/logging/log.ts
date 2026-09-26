import { join } from 'node:path'
import log from 'electron-log/main'
import { app } from 'electron'

let initialized = false

export function initLogging(): void {
  if (initialized) return
  initialized = true
  log.initialize({ preload: false })
  log.transports.file.resolvePathFn = () => join(app.getPath('logs'), 'vivi.log')
  log.transports.file.maxSize = 5 * 1024 * 1024
  log.transports.file.level = 'info'
  log.transports.console.level = process.env.NODE_ENV === 'development' || !app.isPackaged ? 'debug' : 'info'
  log.errorHandler.startCatching({ showDialog: false })
  log.info(`Vivi ${app.getVersion()} starting (${process.platform}/${process.arch}, electron ${process.versions.electron}, node ${process.versions.node})`)
}

export type Logger = ReturnType<typeof log.scope>

export function logger(scope: string): Logger {
  return log.scope(scope)
}

export { log }
