/// <reference lib="dom" />
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { EventChannel, EventMap, InvokeChannel, InvokeMap, ViviBridge } from '@shared/ipc'

const bridge: ViviBridge = {
  platform: process.platform,
  invoke: <K extends InvokeChannel>(channel: K, ...args: InvokeMap[K]['args']) =>
    ipcRenderer.invoke(channel, ...args) as Promise<InvokeMap[K]['result']>,
  on: <K extends EventChannel>(channel: K, listener: (payload: EventMap[K]) => void) => {
    const handler = (_event: IpcRendererEvent, payload: EventMap[K]): void => listener(payload)
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  },
}

// MessagePort hand-off for the microphone stream: main → preload → main world (window 'message' event).
ipcRenderer.on('voice:port', (event) => {
  window.postMessage('voice:port', '*', event.ports)
})

contextBridge.exposeInMainWorld('vivi', bridge)
