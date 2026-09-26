export interface WindowInfo {
  id: number
  title: string
  app: string
  pid: number
  path?: string
  bounds: { x: number; y: number; width: number; height: number }
  active?: boolean
}

type GetWindows = typeof import('get-windows') // eslint-disable-line @typescript-eslint/consistent-type-imports

let mod: GetWindows | null | undefined

async function load(): Promise<GetWindows | null> {
  if (mod !== undefined) return mod
  try {
    mod = await import('get-windows')
  } catch {
    mod = null
  }
  return mod
}

export async function listWindows(): Promise<WindowInfo[]> {
  const gw = await load()
  if (!gw) throw new Error('window listing is unavailable on this platform build (get-windows not installed)')
  const active = await gw.activeWindow({ accessibilityPermission: false, screenRecordingPermission: true }).catch(() => undefined)
  const all = await gw.openWindows({ accessibilityPermission: false, screenRecordingPermission: true })
  return all.map((w) => ({ id: w.id, title: w.title, app: w.owner.name, pid: w.owner.processId, path: w.owner.path, bounds: w.bounds, active: active ? w.id === active.id : undefined }))
}
