import { desktopCapturer, nativeImage, screen } from 'electron'

export interface ScreenshotResult {
  base64: string
  mimeType: 'image/png' | 'image/jpeg'
  /** Size of the returned image in pixels. */
  width: number
  height: number
  /** Logical size of the captured display (points), i.e. the coordinate space for mouse tools. */
  logicalWidth: number
  logicalHeight: number
  /** Factor to map image pixels back to logical coordinates: logical = pixel * (logicalWidth / width). */
  scale: number
  displayId: number
  displayIndex: number
  displayBounds: { x: number; y: number; width: number; height: number }
}

export function listDisplays(): { index: number; id: number; bounds: { x: number; y: number; width: number; height: number }; scaleFactor: number; primary: boolean }[] {
  const primary = screen.getPrimaryDisplay()
  return screen.getAllDisplays().map((d, index) => ({ index, id: d.id, bounds: d.bounds, scaleFactor: d.scaleFactor, primary: d.id === primary.id }))
}

/** Captures one display (default: the one under the cursor) and downsizes it for the model. */
export async function captureScreen(opts: { display?: number; maxSide?: number; region?: { x: number; y: number; width: number; height: number }; quality?: 'png' | 'jpeg' } = {}): Promise<ScreenshotResult> {
  const displays = screen.getAllDisplays()
  const target = opts.display !== undefined ? displays[opts.display] : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  if (!target) throw new Error(`display ${opts.display} not found (have ${displays.length})`)
  const physical = { width: Math.round(target.bounds.width * target.scaleFactor), height: Math.round(target.bounds.height * target.scaleFactor) }
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: physical })
  const source = sources.find((s) => s.display_id === String(target.id)) ?? sources[displays.indexOf(target)] ?? sources[0]
  if (!source) throw new Error('no screen source available (screen recording permission?)')
  let img = source.thumbnail
  if (img.isEmpty()) throw new Error('empty screenshot (permission denied or display asleep)')
  if (opts.region) {
    const f = img.getSize().width / target.bounds.width
    img = img.crop({ x: Math.round(opts.region.x * f), y: Math.round(opts.region.y * f), width: Math.round(opts.region.width * f), height: Math.round(opts.region.height * f) })
  }
  const maxSide = opts.maxSide ?? 1568
  const size = img.getSize()
  const longest = Math.max(size.width, size.height)
  if (longest > maxSide) {
    const factor = maxSide / longest
    img = img.resize({ width: Math.round(size.width * factor), height: Math.round(size.height * factor), quality: 'good' })
  }
  const out = img.getSize()
  const logicalWidth = opts.region ? opts.region.width : target.bounds.width
  const logicalHeight = opts.region ? opts.region.height : target.bounds.height
  const useJpeg = opts.quality === 'jpeg'
  const buf = useJpeg ? img.toJPEG(80) : img.toPNG()
  return {
    base64: buf.toString('base64'),
    mimeType: useJpeg ? 'image/jpeg' : 'image/png',
    width: out.width,
    height: out.height,
    logicalWidth,
    logicalHeight,
    scale: logicalWidth / out.width,
    displayId: target.id,
    displayIndex: displays.indexOf(target),
    displayBounds: target.bounds,
  }
}

/** Utility for tests: converts image pixel coordinates to logical screen coordinates. */
export function imageToLogical(px: { x: number; y: number }, shot: Pick<ScreenshotResult, 'scale' | 'displayBounds'>, region?: { x: number; y: number }): { x: number; y: number } {
  const ox = shot.displayBounds.x + (region?.x ?? 0)
  const oy = shot.displayBounds.y + (region?.y ?? 0)
  return { x: Math.round(ox + px.x * shot.scale), y: Math.round(oy + px.y * shot.scale) }
}

export function pngDataUrl(base64: string): string {
  return `data:image/png;base64,${base64}`
}

export { nativeImage }
