import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClaudeLoginRunner, parseLoginOutput } from '../../../src/main/auth/claude-login'

describe('parseLoginOutput', () => {
  it('extracts an oauth URL from surrounding text', () => {
    const chunk = 'Visit this URL to authorize: https://claude.ai/oauth/authorize?state=abc123 now'
    expect(parseLoginOutput(chunk).url).toBe('https://claude.ai/oauth/authorize?state=abc123')
  })

  it('stops the URL at a quote or angle bracket, not just whitespace', () => {
    const chunk = 'link="https://claude.ai/oauth/authorize?x=1"other'
    expect(parseLoginOutput(chunk).url).toBe('https://claude.ai/oauth/authorize?x=1')
  })

  it('has no url when the chunk has none', () => {
    expect(parseLoginOutput('just some log output').url).toBeUndefined()
  })

  it('detects the code prompt across its known phrasings', () => {
    expect(parseLoginOutput('Paste code here if prompted > ').waitingForCode).toBe(true)
    expect(parseLoginOutput('Enter the code:').waitingForCode).toBe(true)
    expect(parseLoginOutput('Enter code:').waitingForCode).toBe(true)
    expect(parseLoginOutput('authorization code required').waitingForCode).toBe(true)
    expect(parseLoginOutput('logging in...').waitingForCode).toBe(false)
  })

  it('reports the last line as the error only when there is no url and not waiting for code', () => {
    const chunk = 'some preamble\nError: invalid grant'
    const parsed = parseLoginOutput(chunk)
    expect(parsed.error).toBe('Error: invalid grant')
  })

  it('does not report an error alongside a url, even if the chunk also contains error-like words', () => {
    const chunk = 'https://claude.ai/oauth/authorize?x=1\nretry if this failed'
    const parsed = parseLoginOutput(chunk)
    expect(parsed.url).toBeTruthy()
    expect(parsed.error).toBeUndefined()
  })

  it('does not report an error while still waiting for the code', () => {
    const chunk = 'Enter the code: (previous attempt failed)'
    const parsed = parseLoginOutput(chunk)
    expect(parsed.waitingForCode).toBe(true)
    expect(parsed.error).toBeUndefined()
  })
})

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter() as EventEmitter & { setEncoding: (enc: string) => void }
  stderr = new EventEmitter() as EventEmitter & { setEncoding: (enc: string) => void }
  stdin = { write: vi.fn() }
  kill = vi.fn()
  constructor() {
    super()
    this.stdout.setEncoding = vi.fn()
    this.stderr.setEncoding = vi.fn()
  }
}

const spawnMock = vi.fn()
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}))

describe('ClaudeLoginRunner', () => {
  let child: FakeChildProcess

  beforeEach(() => {
    vi.useFakeTimers()
    child = new FakeChildProcess()
    spawnMock.mockReset()
    spawnMock.mockReturnValue(child)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function makeRunner(opts: Partial<{ method: 'claudeai' | 'console'; timeoutMs: number }> = {}) {
    const runner = new ClaudeLoginRunner({
      claudeBinary: '/bin/claude',
      env: {},
      method: opts.method ?? 'claudeai',
      timeoutMs: opts.timeoutMs,
    })
    const events: unknown[] = []
    runner.on('event', (e) => events.push(e))
    const done = vi.fn()
    runner.on('done', done)
    runner.start()
    return { runner, events, done }
  }

  it('spawns with --claudeai or --console depending on the method, and emits "starting" first', async () => {
    const { events } = makeRunner({ method: 'console' })
    expect(spawnMock).toHaveBeenCalledWith(
      '/bin/claude',
      ['auth', 'login', '--console'],
      expect.anything(),
    )
    expect(events[0]).toEqual({ phase: 'starting' })
  })

  it('emits the url once, even if it appears again in a later chunk', async () => {
    const { events } = makeRunner()
    child.stdout.emit('data', 'go to https://claude.ai/oauth/authorize?x=1 to sign in')
    child.stdout.emit('data', 'still waiting… https://claude.ai/oauth/authorize?x=1')
    const urlEvents = events.filter((e) => (e as { phase: string }).phase === 'url')
    expect(urlEvents).toHaveLength(1)
    expect(urlEvents[0]).toEqual({
      phase: 'url',
      url: 'https://claude.ai/oauth/authorize?x=1',
    })
  })

  it('emits waiting-code when the CLI asks for the pasted code', async () => {
    const { events } = makeRunner()
    child.stdout.emit('data', 'Paste code here if prompted > ')
    expect(events).toContainEqual({ phase: 'waiting-code' })
  })

  it('submitCode writes the trimmed code plus a newline to stdin', async () => {
    const { runner } = makeRunner()
    runner.submitCode('  abc-123  ')
    expect(child.stdin.write).toHaveBeenCalledWith('abc-123\n')
  })

  it('submitCode is a no-op once the runner is done', async () => {
    const { runner } = makeRunner()
    child.emit('close', 0)
    child.stdin.write.mockClear()
    runner.submitCode('too-late')
    expect(child.stdin.write).not.toHaveBeenCalled()
  })

  it('finishes with success on a zero exit code', async () => {
    const { events, done } = makeRunner()
    child.emit('close', 0)
    expect(events.at(-1)).toEqual({ phase: 'success' })
    expect(done).toHaveBeenCalledWith({ phase: 'success' })
  })

  it('finishes with an error carrying the last output lines on a non-zero exit code', async () => {
    const { events } = makeRunner()
    child.stdout.emit('data', 'line one\nline two\nline three\nline four\n')
    child.emit('close', 1)
    expect(events.at(-1)).toEqual({ phase: 'error', message: 'line two\nline three\nline four' })
  })

  it('falls back to a generic message when the process produced no output before failing', async () => {
    const { events } = makeRunner()
    child.emit('close', 1)
    expect(events.at(-1)).toEqual({ phase: 'error', message: 'login exited with code 1' })
  })

  it('finishes with an error when the child process itself errors (e.g. binary not found)', async () => {
    const { events } = makeRunner()
    child.emit('error', new Error('ENOENT'))
    expect(events.at(-1)).toEqual({ phase: 'error', message: 'ENOENT' })
  })

  it('cancel() kills the child and reports cancelled', async () => {
    const { runner, events } = makeRunner()
    runner.cancel()
    expect(child.kill).toHaveBeenCalled()
    expect(events.at(-1)).toEqual({ phase: 'cancelled', message: 'cancelled' })
  })

  it('auto-cancels as an error after the timeout with no completion', async () => {
    const { events } = makeRunner({ timeoutMs: 5_000 })
    vi.advanceTimersByTime(5_000)
    expect(events.at(-1)).toEqual({ phase: 'error', message: 'timeout' })
  })

  it('does not double-finish: a close event after cancel() is ignored', async () => {
    const { runner, events } = makeRunner()
    runner.cancel()
    const countAfterCancel = events.length
    child.emit('close', 0)
    expect(events).toHaveLength(countAfterCancel)
  })
})
