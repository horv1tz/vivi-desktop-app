/* eslint-disable @typescript-eslint/no-require-imports */
// electron-builder afterPack hook: copies the native Claude Code binary that ships inside the
// platform-specific @anthropic-ai/claude-agent-sdk-* package into <app>/resources/claude-bin.
// The binary cannot be spawned from inside app.asar, and the SDK resolves it with require.resolve,
// so the app passes an explicit pathToClaudeCodeExecutable at runtime (src/main/util/claude-bin.ts).
const fs = require('node:fs')
const path = require('node:path')

const ARCH_NAMES = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' }

function platformKey(electronPlatformName) {
  if (electronPlatformName === 'darwin' || electronPlatformName === 'mas') return 'darwin'
  if (electronPlatformName === 'win32') return 'win32'
  return 'linux'
}

function resourcesDir(context) {
  const platform = context.electronPlatformName
  if (platform === 'darwin' || platform === 'mas') {
    const appName = `${context.packager.appInfo.productFilename}.app`
    return path.join(context.appOutDir, appName, 'Contents', 'Resources')
  }
  return path.join(context.appOutDir, 'resources')
}

module.exports = async function afterPack(context) {
  const platform = platformKey(context.electronPlatformName)
  const archName = ARCH_NAMES[context.arch] ?? 'x64'
  const arches = archName === 'universal' ? ['arm64', 'x64'] : [archName]
  const binaryName = platform === 'win32' ? 'claude.exe' : 'claude'
  const outDir = path.join(resourcesDir(context), 'claude-bin')
  fs.mkdirSync(outDir, { recursive: true })

  for (const arch of arches) {
    const pkg = `@anthropic-ai/claude-agent-sdk-${platform}-${arch}`
    const src = path.join(context.packager.projectDir, 'node_modules', pkg, binaryName)
    if (!fs.existsSync(src)) {
      throw new Error(
        `[after-pack] ${src} not found. Install the platform package for the build target: ` +
          `npm install ${pkg} --force (cross builds need the target platform's package).`,
      )
    }
    const dest = path.join(outDir, arches.length > 1 ? `${binaryName}-${arch}` : binaryName)
    fs.copyFileSync(src, dest)
    if (platform !== 'win32') fs.chmodSync(dest, 0o755)
    const size = fs.statSync(dest).size
    console.log(`  • after-pack: copied ${pkg}/${binaryName} → ${path.relative(context.appOutDir, dest)} (${(size / 1e6).toFixed(1)} MB)`)
  }
}
