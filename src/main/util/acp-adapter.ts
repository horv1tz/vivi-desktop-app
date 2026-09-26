import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

const PKG = '@agentclientprotocol/claude-agent-acp'

/**
 * Entry script of the bundled Claude ACP adapter. In packaged builds it lives inside app.asar;
 * an ELECTRON_RUN_AS_NODE child can import ESM straight from the archive, so no unpacking is needed.
 */
export function resolveAcpAdapterEntry(): string | null {
  const override = process.env.VIVI_ACP_ADAPTER
  if (override && existsSync(override)) return override
  const p = join(app.getAppPath(), 'node_modules', PKG, 'dist', 'index.js')
  return existsSync(p) ? p : null
}

/** Bootstrap script (built by electron-vite next to the main bundle) that launches the adapter. */
export function resolveAcpBootstrap(): string | null {
  const p = join(import.meta.dirname, 'acp-bootstrap.js')
  return existsSync(p) ? p : null
}

export function acpAdapterVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(app.getAppPath(), 'node_modules', PKG, 'package.json'), 'utf8')) as { version?: string }
    return pkg.version ?? 'unknown'
  } catch {
    return 'missing'
  }
}
