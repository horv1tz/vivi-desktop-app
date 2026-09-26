import { execFile } from 'node:child_process'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

export function text(t: string): CallToolResult {
  return { content: [{ type: 'text', text: t }] }
}

export function error(t: string): CallToolResult {
  return { content: [{ type: 'text', text: t }], isError: true }
}

export function image(base64: string, mimeType: string, caption?: string): CallToolResult {
  const content: CallToolResult['content'] = [{ type: 'image', data: base64, mimeType }]
  if (caption) content.push({ type: 'text', text: caption })
  return { content }
}

export function run(
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number; input?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = execFile(
      cmd,
      args,
      {
        timeout: opts.timeoutMs ?? 15_000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
        env: opts.env,
      },
      (err, stdout, stderr) => {
        const code =
          err && typeof (err as { code?: unknown }).code === 'number'
            ? ((err as { code: number }).code ?? 1)
            : err
              ? 1
              : 0
        resolve({
          code,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? '') + (err && !stderr ? err.message : ''),
        })
      },
    )
    if (opts.input !== undefined) {
      child.stdin?.write(opts.input)
      child.stdin?.end()
    }
  })
}

/**
 * `env` carries values the script reads as `$env:NAME` instead of having them interpolated into the
 * script text. PowerShell double-quoted strings evaluate `$(...)` subexpressions regardless of how
 * the substituted text was quote-escaped, so any externally-influenced string (a window title, an app
 * name, typed key names, …) MUST travel as an environment variable, never as literal script text.
 */
export function powershell(
  script: string,
  timeoutMs = 20_000,
  env?: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { timeoutMs, env: env ? { ...process.env, ...env } : undefined },
  )
}

export function truncate(s: string, max = 20_000): string {
  return s.length > max ? `${s.slice(0, max)}\n…[truncated ${s.length - max} chars]` : s
}
