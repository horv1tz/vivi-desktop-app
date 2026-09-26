// Verifies an unpacked electron-builder output (dist/<platform>-unpacked or .app):
//  - the Claude Code binary is present under resources/claude-bin and runs `--version`
//  - native modules (.node) and sherpa-onnx shared libraries are unpacked from the asar
import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { execFileSync } from 'node:child_process'

/**
 * Collects unpacked build output directories under `distDir`. Most targets place it directly at
 * the top level (`dist/linux-unpacked`, `dist/win-unpacked`); electron-builder's macOS `dir`
 * target instead nests the `.app` bundle one level down inside an arch-named folder
 * (`dist/mac-arm64/Vivi.app`), so a plain top-level scan misses it entirely. Returns full paths.
 */
export function findCandidates(distDir) {
  if (!existsSync(distDir)) return []
  const out = []
  for (const entry of readdirSync(distDir)) {
    const full = join(distDir, entry)
    if (!statSync(full).isDirectory()) continue
    if (entry.endsWith('-unpacked') || entry.endsWith('.app')) {
      out.push(full)
      continue
    }
    for (const inner of readdirSync(full)) {
      if (inner.endsWith('.app')) out.push(join(full, inner))
    }
  }
  return out
}

async function main() {
  const distDir = process.argv[2] ?? 'dist'
  const candidates = findCandidates(distDir)
  if (candidates.length === 0) {
    console.error(`verify-dist: no unpacked build found in ${distDir}`)
    process.exit(1)
  }
  let failed = false
  for (const base of candidates) {
    const isApp = base.endsWith('.app')
    const resources = isApp ? join(base, 'Contents', 'Resources') : join(base, 'resources')
    // Infer the target platform from the output folder so cross-builds (dist/win-unpacked on Linux) are checked too.
    const targetIsWin = basename(base).startsWith('win') || process.platform === 'win32'
    const bin = targetIsWin ? 'claude.exe' : 'claude'
    const binPath = join(resources, 'claude-bin', bin)
    const canRun = targetIsWin === (process.platform === 'win32')
    console.log(`\n== ${base}`)
    if (!existsSync(binPath)) {
      console.error(`  ✗ missing ${binPath}`)
      failed = true
    } else {
      const size = statSync(binPath).size
      if (!canRun)
        console.log(
          `  ✓ claude-bin present (${(size / 1e6).toFixed(1)} MB; cross-build, not executed)`,
        )
      else
        try {
          const v = execFileSync(binPath, ['--version'], {
            encoding: 'utf8',
            timeout: 60_000,
            env: {
              ...process.env,
              CLAUDE_CONFIG_DIR: join(process.cwd(), 'dist', '.verify-config'),
            },
          }).trim()
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
      else
        console.log(`  · ${mod} not unpacked (optional dependency may be absent on this platform)`)
    }
    const platformPkgs = existsSync(unpacked)
      ? readdirSync(unpacked).filter((n) => n.startsWith('sherpa-onnx-'))
      : []
    const libs = platformPkgs.flatMap((p) =>
      readdirSync(join(unpacked, p)).filter((f) => /\.(so|dylib|dll)/.test(f)),
    )
    if (libs.length > 0)
      console.log(
        `  ✓ sherpa-onnx shared libs unpacked: ${libs.slice(0, 4).join(', ')}${libs.length > 4 ? '…' : ''}`,
      )
    else {
      console.error('  ✗ sherpa-onnx shared libraries not found in app.asar.unpacked')
      failed = true
    }
    const asar = join(resources, 'app.asar')
    if (!existsSync(asar)) {
      console.error('  ✗ app.asar missing')
      failed = true
    } else console.log('  ✓ app.asar present')
  }
  process.exit(failed ? 1 : 0)
}

// Only run when executed directly (`node scripts/verify-dist.mjs`), not when imported by a test.
if (import.meta.url === `file://${process.argv[1]}`) await main()
