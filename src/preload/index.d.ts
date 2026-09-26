import type { ViviBridge } from '../shared/ipc'

declare global {
  interface Window {
    vivi: ViviBridge
  }
}

export {}
