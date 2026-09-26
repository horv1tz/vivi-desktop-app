// Verifies an unpacked electron-builder output (dist/<platform>-unpacked or .app):
//  - the Claude Code binary is present under resources/claude-bin and runs `--version`
//  - native modules (.node) and sherpa-onnx shared libraries are unpacked from the asar
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const distDir = process.argv[2] ?? 'dist'
const candidates = existsSync(distDir) ? readdirSync(distDir).filter((d) => d.endsWith('-unpacked') || d.endsWith('.app')) : []
if (candidates.length === 0) {
  console.error(`verify-dist: no unpacked build found in ${distDir}`)
  process.exit(1)
}
let failed = false
for (const dir of candidates) {
  const base = join(distDir, dir)
  const resources = dir.endsWith('.app') ? join(base, 'Contents', 'Resources') : join(base, 'resources')
  const bin = process.platform === 'win32' ? 'claude.exe' : 'claude'
  const binPath = join(resources, 'claude-bin', bin)
  console.log(`\n== ${base}`)
  if (!existsSync(binPath)) {
    console.error(`  ✗ missing ${binPath}`)
    failed = true
  } else {
    const size = statSync(binPath).size
    try {
      const v = execFileSync(binPath, ['--version'], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, CLAUDE_CONFIG_DIR: join(process.cwd(), 'dist', '.verify-config') } }).trim()
      console.log(`  ✓ claude-bin ok (${(size / 1e6).toFixed(1)} MB): ${v}`)
    } catch (err) {
      console.error(`  ✗ claude-bin failed to run: ${err.message}`)
      failed = true
    }
  }
  const unpacked = join(resources, 'app.asar.unpacked', 'node_modules')
  const checks = ['sherpa-onnx-node', 'robotjs', 'get-windows']
  for (const mod of checks) {
    const p = join(unpacked, mod)
    if (existsSync(p)) console.log(`  ✓ unpacked ${mod}`)
    else console.log(`  · ${mod} not unpacked (optional dependency may be absent on this platform)`)
  }
  const platformPkgs = existsSync(unpacked) ? readdirSync(unpacked).filter((n) => n.startsWith('sherpa-onnx-')) : []
  const libs = platformPkgs.flatMap((p) => readdirSync(join(unpacked, p)).filter((f) => /\.(so|dylib|dll)/.test(f)))
  if (libs.length > 0) console.log(`  ✓ sherpa-onnx shared libs unpacked: ${libs.slice(0, 4).join(', ')}${libs.length > 4 ? '…' : ''}`)
  else { console.error('  ✗ sherpa-onnx shared libraries not found in app.asar.unpacked'); failed = true }
  const asar = join(resources, 'app.asar')
  if (!existsSync(asar)) { console.error('  ✗ app.asar missing'); failed = true } else console.log('  ✓ app.asar present')
}
process.exit(failed ? 1 : 0)
