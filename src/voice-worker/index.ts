// Voice worker (Electron utilityProcess). Phase 6 fills in the sherpa-onnx pipeline;
// this stub keeps the process protocol alive so the app boots without native voice libs.
import { logger } from './log'

const log = logger('voice-worker')

process.parentPort?.on('message', (event) => {
  const msg = event.data as { type?: string }
  if (msg?.type === 'ping') process.parentPort?.postMessage({ type: 'pong' })
  else log.debug('message', msg?.type)
})

process.parentPort?.postMessage({ type: 'ready' })
