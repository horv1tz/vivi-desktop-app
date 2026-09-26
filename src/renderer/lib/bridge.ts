import { useEffect } from 'react'
import type { EventChannel, EventMap, InvokeChannel, InvokeMap, ViviBridge } from '@shared/ipc'

const fallback: ViviBridge = {
  platform: 'linux',
  invoke: async (channel, ..._args: unknown[]) => {
    throw new Error(`vivi bridge unavailable (${String(channel)}) — running outside Electron?`)
  },
  on: () => () => {},
}

export const vivi: ViviBridge =
  typeof window !== 'undefined' && window.vivi ? window.vivi : fallback

export function invoke<K extends InvokeChannel>(
  channel: K,
  ...args: InvokeMap[K]['args']
): Promise<InvokeMap[K]['result']> {
  return vivi.invoke(channel, ...args)
}

/** Subscribe to a main-process event for the lifetime of the component. */
export function useViviEvent<K extends EventChannel>(
  channel: K,
  listener: (payload: EventMap[K]) => void,
): void {
  useEffect(() => vivi.on(channel, listener), [channel, listener])
}

export const isMac = vivi.platform === 'darwin'
export const isWindows = vivi.platform === 'win32'
export const isLinux = vivi.platform === 'linux'
