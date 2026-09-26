// SEC-07: writes a SHA-256 checksum file for every release installer in a dist directory, so a
// user can verify a downloaded artifact wasn't tampered with in transit or on a mirror.
import { createHash } from 'node:crypto'
import { createReadStream, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const INSTALLER_EXTENSIONS = ['.AppImage', '.deb', '.exe', '.dmg', '.zip']

function sha256(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

export async function writeChecksums(distDir, outFile) {
  const files = readdirSync(distDir)
    .filter((f) => INSTALLER_EXTENSIONS.some((ext) => f.endsWith(ext)))
    .sort()
  const lines = []
  for (const file of files) lines.push(`${await sha256(join(distDir, file))}  ${file}`)
  const content = lines.length ? `${lines.join('\n')}\n` : ''
  writeFileSync(join(distDir, outFile), content, 'utf8')
  return { files, content }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const distDir = process.argv[2] ?? 'dist'
  const outFile = process.argv[3] ?? 'checksums.txt'
  const { files, content } = await writeChecksums(distDir, outFile)
  if (!files.length) console.error(`checksums: no installer files found in ${distDir}`)
  else process.stdout.write(content)
}
