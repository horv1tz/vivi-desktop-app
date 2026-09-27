import { existsSync, readFileSync, writeFileSync } from 'node:fs'

export interface WindowState {
  x: number
  y: number
  width: number
  height: number
  isMaximized: boolean
}

export function loadWindowState(filePath: string): WindowState | null {
  try {
    if (!existsSync(filePath)) return null
    const raw: unknown = JSON.parse(readFileSync(filePath, 'utf8'))
    if (typeof raw !== 'object' || raw === null) return null
    const { x, y, width, height, isMaximized } = raw as Record<string, unknown>
    if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0)
      return null
    return {
      x: typeof x === 'number' ? x : 0,
      y: typeof y === 'number' ? y : 0,
      width,
      height,
      isMaximized: !!isMaximized,
    }
  } catch {
    return null
  }
}

export function saveWindowState(filePath: string, state: WindowState): void {
  try {
    writeFileSync(filePath, JSON.stringify(state), 'utf8')
  } catch {
    // best-effort: losing the saved window position/size is never worth crashing over
  }
}

export interface DisplayBounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * UX-08: a window position saved on a display that's since been disconnected (laptop undocked, a
 * second monitor unplugged) would otherwise restore off-screen and be unreachable — there's no
 * "drag it back" once you can't see or click it. Keeps the saved size (capped to the largest
 * available display) if the saved top-left corner still falls on some current display, otherwise
 * re-centers on the first (primary) one.
 */
export function clampToDisplays(
  state: WindowState,
  displays: DisplayBounds[],
  minWidth = 1,
  minHeight = 1,
): WindowState {
  if (displays.length === 0) return state
  const maxWidth = Math.max(...displays.map((d) => d.width))
  const maxHeight = Math.max(...displays.map((d) => d.height))
  const width = Math.max(minWidth, Math.min(state.width, maxWidth))
  const height = Math.max(minHeight, Math.min(state.height, maxHeight))
  const cornerVisible = displays.some(
    (d) =>
      state.x + 50 >= d.x &&
      state.x < d.x + d.width &&
      state.y + 20 >= d.y &&
      state.y < d.y + d.height,
  )
  if (cornerVisible) return { ...state, width, height }
  const primary = displays[0]!
  return {
    x: Math.round(primary.x + (primary.width - width) / 2),
    y: Math.round(primary.y + (primary.height - height) / 2),
    width,
    height,
    isMaximized: state.isMaximized,
  }
}
