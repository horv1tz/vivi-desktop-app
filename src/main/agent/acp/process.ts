import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { ndJsonStream, type Stream } from '@agentclientprotocol/sdk'

/** npm-style launchers on Windows are .cmd/.bat shims that only cmd.exe can start. */
export function needsWindowsShell(command: string): boolean {
  return /\.(cmd|bat)$/i.test(command)
}

/**
 * On Windows a bare command name ("gemini") usually maps to a .cmd shim that CreateProcess cannot run
 * directly. Resolve it through `where` so the caller knows the real file (and whether a shell is needed).
 */
export function resolveWindowsCommand(command: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== 'win32' || isAbsolute(command) || /[\\/]/.test(command) || /\.[a-z0-9]+$/i.test(command)) return command
  try {
    const r = spawnSync('where.exe', [command], { encoding: 'utf8', windowsHide: true, timeout: 5000 })
    const first = r.stdout?.split(/\r?\n/).map((l) => l.trim()).find(Boolean)
    return first || command
  } catch {
    return command
  }
}

/** Quote an argument for cmd.exe when a .cmd shim has to be started through the shell. */
export function quoteForCmd(arg: string): string {
  if (arg === '') return '""'
  if (!/[\s"&|<>^()]/.test(arg)) return arg
  return `"${arg.replace(/"/g, '\\"')}"`
}

export interface AcpProcessOptions {
  command: string
  args: string[]
  env: Record<string, string | undefined>
  cwd: string
  onStderr?: (line: string) => void
  onExit?: (info: { code: number | null; signal: NodeJS.Signals | null }) => void
}

export interface AcpProcess {
  readonly pid: number | undefined
  readonly stream: Stream
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
  readonly isRunning: boolean
  /** Close stdin (agents exit on EOF), then SIGTERM/SIGKILL after grace periods. */
  stop(graceMs?: number): Promise<void>
}

/**
 * Spawns an ACP agent and wires its stdio into an ACP `Stream` (newline-delimited JSON-RPC).
 * Works for the bundled Claude adapter (run with Electron as Node) and for any third-party ACP agent.
 */
export function spawnAcpProcess(opts: AcpProcessOptions): AcpProcess {
  const command = resolveWindowsCommand(opts.command)
  const useShell = process.platform === 'win32' && needsWindowsShell(command)
  const child: ChildProcessWithoutNullStreams = spawn(useShell ? quoteForCmd(command) : command, useShell ? opts.args.map(quoteForCmd) : opts.args, {
    cwd: opts.cwd,
    env: Object.fromEntries(Object.entries(opts.env).filter((e): e is [string, string] => typeof e[1] === 'string')),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    shell: useShell,
  })
  let running = true
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('exit', (code, signal) => {
      running = false
      const info = { code, signal }
      opts.onExit?.(info)
      resolve(info)
    })
    child.once('error', (err) => {
      running = false
      opts.onStderr?.(`spawn error: ${err.message}`)
      const info = { code: null, signal: null }
      opts.onExit?.(info)
      resolve(info)
    })
  })
  let tail = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    tail += chunk
    const lines = tail.split(/\r?\n/)
    tail = lines.pop() ?? ''
    for (const l of lines) opts.onStderr?.(l)
  })
  child.stdin.on('error', () => {
    /* EPIPE after the agent died: reported through exit */
  })
  const stream = ndJsonStream(Writable.toWeb(child.stdin) as WritableStream<Uint8Array>, Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>)
  return {
    get pid() {
      return child.pid
    },
    stream,
    exited,
    get isRunning() {
      return running
    },
    async stop(graceMs = 2000): Promise<void> {
      if (!running) return
      try {
        child.stdin.end()
      } catch {
        /* ignore */
      }
      const wait = (ms: number): Promise<boolean> => Promise.race([exited.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), ms))])
      if (await wait(graceMs)) return
      try {
        child.kill('SIGTERM')
      } catch {
        /* ignore */
      }
      if (await wait(1500)) return
      try {
        child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      await wait(1000)
    },
  }
}
