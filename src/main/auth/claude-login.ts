import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { LoginFlowEvent } from '@shared/events'

export interface LoginParse {
  url?: string
  waitingForCode: boolean
  error?: string
}

const URL_RE = /(https:\/\/[^\s'"<>]+oauth[^\s'"<>]*)/i

/** Parses the incremental stdout of `claude auth login` for the OAuth URL and the code prompt. */
export function parseLoginOutput(chunk: string): LoginParse {
  const url = URL_RE.exec(chunk)?.[1]
  const waitingForCode = /paste code here|enter (the )?code|authorization code/i.test(chunk)
  const error = /error|failed|invalid|denied/i.test(chunk) && !url && !waitingForCode ? chunk.trim().split('\n').at(-1) : undefined
  return { url, waitingForCode, error }
}

export interface LoginRunnerOptions {
  claudeBinary: string
  env: NodeJS.ProcessEnv
  method: 'claudeai' | 'console'
  timeoutMs?: number
}

/**
 * Drives the CLI's headless login: spawns `claude auth login`, surfaces the URL to open in the
 * browser, forwards the pasted code to stdin and reports success/failure.
 */
export class ClaudeLoginRunner extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private urlEmitted = false
  private done = false
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly opts: LoginRunnerOptions) {
    super()
  }

  start(): void {
    const args = ['auth', 'login', this.opts.method === 'console' ? '--console' : '--claudeai']
    this.emitEvent({ phase: 'starting' })
    // BROWSER=/bin/true style suppression is not portable; the CLI opens the browser itself, the app opens it too.
    this.child = spawn(this.opts.claudeBinary, args, { env: { ...this.opts.env, NO_COLOR: '1', TERM: 'dumb', BROWSER: process.platform === 'win32' ? 'cmd /c exit' : 'true' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    this.child.stdout.setEncoding('utf8')
    this.child.stderr.setEncoding('utf8')
    const onData = (data: string): void => {
      this.buffer += data
      const parsed = parseLoginOutput(this.buffer)
      if (parsed.url && !this.urlEmitted) {
        this.urlEmitted = true
        this.emitEvent({ phase: 'url', url: parsed.url })
      }
      if (parsed.waitingForCode) this.emitEvent({ phase: 'waiting-code' })
    }
    this.child.stdout.on('data', onData)
    this.child.stderr.on('data', onData)
    this.child.on('error', (err) => this.finish({ phase: 'error', message: err.message }))
    this.child.on('close', (code) => {
      if (this.done) return
      if (code === 0) this.finish({ phase: 'success' })
      else this.finish({ phase: 'error', message: this.buffer.trim().split('\n').slice(-3).join('\n') || `login exited with code ${code}` })
    })
    this.timer = setTimeout(() => this.cancel('timeout'), this.opts.timeoutMs ?? 10 * 60_000)
  }

  submitCode(code: string): void {
    if (!this.child || this.done) return
    this.child.stdin.write(`${code.trim()}\n`)
  }

  cancel(reason = 'cancelled'): void {
    if (this.done) return
    this.child?.kill()
    this.finish({ phase: reason === 'timeout' ? 'error' : 'cancelled', message: reason })
  }

  private emitEvent(e: LoginFlowEvent): void {
    this.emit('event', e)
  }

  private finish(e: LoginFlowEvent): void {
    if (this.done) return
    this.done = true
    if (this.timer) clearTimeout(this.timer)
    this.emitEvent(e)
    this.emit('done', e)
  }
}
