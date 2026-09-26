// Generates resources/icon.png (1024x1024) and a 32x32 tray icon without any native dependency.
// Design: soft radial gradient orb (Vivi's voice orb) on a rounded dark tile.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function crc32(buf) {
  let c
  const table = crc32.table || (crc32.table = Array.from({ length: 256 }, (_, n) => {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  }))
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crc])
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function mix(a, b, t) {
  return a + (b - a) * t
}

function render(size, { tile = true } = {}) {
  const px = Buffer.alloc(size * size * 4)
  const c = size / 2
  const radius = size * 0.34
  const tileRadius = size * 0.22
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      let r = 0, g = 0, b = 0, a = 0
      if (tile) {
        // rounded square tile
        const dx = Math.max(Math.abs(x - c) - (c - tileRadius), 0)
        const dy = Math.max(Math.abs(y - c) - (c - tileRadius), 0)
        const d = Math.sqrt(dx * dx + dy * dy) - tileRadius
        const inside = Math.min(Math.max(1 - d, 0), 1)
        if (inside > 0) {
          const t = y / size
          r = mix(18, 12, t); g = mix(20, 14, t); b = mix(36, 24, t); a = 255 * inside
        }
      }
      // orb with radial gradient + highlight
      const ox = x - c, oy = y - c
      const dist = Math.sqrt(ox * ox + oy * oy)
      if (dist < radius + 1) {
        const t = Math.min(dist / radius, 1)
        const edge = Math.min(Math.max(radius + 1 - dist, 0), 1)
        const hx = ox + radius * 0.35, hy = oy + radius * 0.4
        const h = Math.max(0, 1 - Math.sqrt(hx * hx + hy * hy) / (radius * 0.9))
        let or = mix(124, 56, t) + 120 * h * h
        let og = mix(92, 140, t) + 90 * h * h
        let ob = mix(255, 220, t) + 40 * h * h
        or = Math.min(255, or); og = Math.min(255, og); ob = Math.min(255, ob)
        const oa = edge
        r = mix(r, or, oa); g = mix(g, og, oa); b = mix(b, ob, oa); a = Math.max(a, 255 * oa)
      }
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a
    }
  }
  return encodePng(size, size, px)
}

mkdirSync(join(root, 'resources'), { recursive: true })
writeFileSync(join(root, 'resources', 'icon.png'), render(1024))
writeFileSync(join(root, 'resources', 'tray.png'), render(64, { tile: false }))
writeFileSync(join(root, 'resources', 'tray@2x.png'), render(128, { tile: false }))
writeFileSync(join(root, 'resources', 'trayTemplate.png'), render(22, { tile: false }))
writeFileSync(join(root, 'resources', 'trayTemplate@2x.png'), render(44, { tile: false }))
console.log('icons written to resources/')
