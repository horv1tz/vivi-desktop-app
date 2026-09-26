import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { app } from 'electron'

/** Directory holding the sherpa-onnx shared libraries for this platform (unpacked from the asar when packaged). */
export function sherpaLibDir(): string | null {
  const platform = process.platform === 'win32' ? 'win' : process.platform
  const pkg = `sherpa-onnx-${platform}-${process.arch}`
  const candidates: string[] = []
  try {
    const require = createRequire(import.meta.url)
    const p = require.resolve(`${pkg}/package.json`)
    candidates.push(dirname(p).replace(`app.asar${process.platform === 'win32' ? '\\' : '/'}`, `app.asar.unpacked${process.platform === 'win32' ? '\\' : '/'}`))
  } catch {
    /* fall through */
  }
  candidates.push(join(process.resourcesPath ?? '', 'app.asar.unpacked', 'node_modules', pkg))
  candidates.push(join(app.getAppPath(), 'node_modules', pkg))
  for (const c of candidates) if (c && existsSync(c)) return c
  return null
}
