import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentUiEvent } from '../../../src/shared/events'
import { defaultSettings, type Settings } from '../../../src/shared/settings'
import type { WorkerToMain } from '../../../src/voice-worker/protocol'
import type { OrchestratorDeps } from '../../../src/main/voice/orchestrator'

// VoiceOrchestrator pulls in a lot of Electron-touching modules it doesn't take as injected deps
// (logging, ipc, the model manager, the worker-client process supervisor, the app windows, the
// secret store...). Mock every one of them at the exact specifier orchestrator.ts imports, so the
// real class runs against fakes instead of the real Electron runtime, which isn't available here.
vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test' } }))

const logMock = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
vi.mock('../../../src/main/logging/log', () => ({ logger: () => logMock }))

vi.mock('../../../src/main/ipc/handlers', () => ({ handle: vi.fn() }))
vi.mock('../../../src/main/app/windows', () => ({ showOverlay: vi.fn() }))
vi.mock('../../../src/main/voice/native-paths', () => ({ sherpaLibDir: () => null }))
vi.mock('../../../src/main/auth/secrets', () => ({ secrets: () => ({ get: async () => 'fake-openai-key', set: async () => undefined }) }))
vi.mock('../../../src/main/voice/models', () => ({
  ModelManager: class {
    isInstalled(): boolean {
      return true
    }
    paths(): { dir: string } {
      return { dir: '/tmp/fake-model' }
    }
    list(): unknown[] {
      return []
    }
  },
}))
// The cloud provider fails synthesis for any chunk whose text contains "FAIL", so tests can force
// a cloud-path TTS failure the same way a local sherpa synth failure is forced (via 'tts-error').
vi.mock('../../../src/main/voice/providers/openai', () => ({
  OpenAIVoiceProvider: class {
    async synthesize(text: string): Promise<{ bytes: ArrayBuffer; mimeType: string }> {
      if (text.includes('FAIL')) throw new Error('cloud tts boom')
      return { bytes: new ArrayBuffer(4), mimeType: 'audio/mpeg' }
    }
  },
}))

const emitted: { channel: string; payload: unknown }[] = []
vi.mock('../../../src/main/ipc/emitters', () => ({
  emit: (channel: string, payload: unknown) => {
    emitted.push({ channel, payload })
  },
}))

interface FakeWorkerClientLike {
  sent: Array<Record<string, unknown>>
  emitEvent(event: string, payload?: unknown): void
}

vi.mock('../../../src/main/voice/worker-client', () => {
  let last: FakeWorkerClientLike | null = null
  class FakeWorkerClient implements FakeWorkerClientLike {
    private listeners = new Map<string, Array<(payload?: unknown) => void>>()
    sent: Array<Record<string, unknown>> = []
    constructor() {
      // Tracks the most recently created instance so the test can reach into the orchestrator's
      // internally-constructed worker client.
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      last = this
    }
    on(event: string, cb: (payload?: unknown) => void): this {
      const arr = this.listeners.get(event) ?? []
      arr.push(cb)
      this.listeners.set(event, arr)
      return this
    }
    off(event: string, cb: (payload?: unknown) => void): this {
      this.listeners.set(
        event,
        (this.listeners.get(event) ?? []).filter((l) => l !== cb),
      )
      return this
    }
    emitEvent(event: string, payload?: unknown): void {
      for (const cb of this.listeners.get(event) ?? []) cb(payload)
    }
    async start(): Promise<void> {}
    send(msg: Record<string, unknown>): void {
      this.sent.push(msg)
    }
    createAudioChannel(): unknown {
      return {}
    }
    async stop(): Promise<void> {}
  }
  return {
    VoiceWorkerClient: FakeWorkerClient,
    workerEntryPath: () => 'fake-voice-worker-entry.js',
    __getLastWorkerClient: (): FakeWorkerClientLike | null => last,
  }
})

const { VoiceOrchestrator } = await import('../../../src/main/voice/orchestrator')
const workerClientMock = (await import('../../../src/main/voice/worker-client')) as unknown as { __getLastWorkerClient: () => FakeWorkerClientLike }

const flushReal = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

let agentListener: ((e: AgentUiEvent) => void) | null = null

function makeDeps(settings: Settings): OrchestratorDeps {
  agentListener = null
  return {
    getSettings: () => settings,
    modelsDir: '/tmp/fake-models-dir',
    sendToAgent: vi.fn(async () => undefined),
    interruptAgent: vi.fn(async () => undefined),
    onAgentEvent: (listener) => {
      agentListener = listener
      return () => {
        agentListener = null
      }
    },
    getDispatcher: () => undefined,
    deliverAudioPort: vi.fn(),
    isOverlayVisible: () => true,
  }
}

/** Starts the orchestrator and completes the worker handshake so it reaches 'armed'. */
async function armOrchestrator(orch: InstanceType<typeof VoiceOrchestrator>, flush: () => Promise<unknown> = flushReal): Promise<FakeWorkerClientLike> {
  const starting = orch.start()
  await flush()
  const client = workerClientMock.__getLastWorkerClient()!
  client.emitEvent('message', { type: 'init-done', ok: true, capabilities: { stt: true, vad: true, kws: true, tts: true } } satisfies WorkerToMain)
  await starting
  return client
}

function audioEvents(): { generation: number; seq: number; sampleRate: number; pcm: ArrayBuffer; last: boolean }[] {
  return emitted.filter((e) => e.channel === 'voice:audio').map((e) => e.payload as never)
}

function stateEvents(): { state: string; detail?: string }[] {
  return emitted.filter((e) => e.channel === 'voice:state').map((e) => e.payload as never)
}

beforeEach(() => {
  emitted.length = 0
})

afterEach(() => {
  vi.useRealTimers()
})

describe('VoiceOrchestrator TTS chunk resilience (VO-02)', () => {
  it('fills a failed local TTS chunk with silence instead of leaving a permanent gap, and still marks the reply done', async () => {
    const settings = defaultSettings()
    const orch = new VoiceOrchestrator(makeDeps(settings))
    const client = await armOrchestrator(orch)

    await orch.speak('Привет! Я нашла три файла в папке. Первый называется notes.md, второй — plan.txt.')
    const ttsSent = client.sent.filter((m) => m.type === 'tts')
    expect(ttsSent.length).toBe(2)
    const gen = ttsSent[0]!.generation as number

    const seq0 = ttsSent[0]!.seq as number
    const seq1 = ttsSent[1]!.seq as number
    client.emitEvent('message', { type: 'tts-audio', generation: gen, seq: seq0, sampleRate: 16000, pcm: new Float32Array(320).buffer } satisfies WorkerToMain)
    client.emitEvent('message', { type: 'tts-error', generation: gen, seq: seq1, error: 'sherpa boom' } satisfies WorkerToMain)

    expect(logMock.warn).toHaveBeenCalledWith(expect.stringContaining(`tts error seq ${seq1}`))

    const events = audioEvents()
    const filler = events.find((e) => e.generation === gen && e.seq === seq1 && !e.last)
    expect(filler).toBeDefined()
    expect(filler!.pcm.byteLength).toBeGreaterThan(0) // real, playable silence — not an empty/skipped buffer

    // The "done speaking" marker for this reply is still sent regardless of the chunk failure.
    const done = events.find((e) => e.generation === gen && e.last)
    expect(done).toBeDefined()
  })

  it('still marks the reply done even if every chunk fails', async () => {
    const settings = defaultSettings()
    const orch = new VoiceOrchestrator(makeDeps(settings))
    const client = await armOrchestrator(orch)

    await orch.speak('Первое предложение довольно длинное значение. Второе тоже вполне длинное предложение.')
    const ttsSent = client.sent.filter((m) => m.type === 'tts')
    expect(ttsSent.length).toBe(2)
    const gen = ttsSent[0]!.generation as number
    for (const job of ttsSent) client.emitEvent('message', { type: 'tts-error', generation: gen, seq: job.seq as number, error: 'boom' } satisfies WorkerToMain)

    const events = audioEvents()
    expect(events.filter((e) => e.generation === gen && !e.last)).toHaveLength(2) // both filled with silence
    expect(events.some((e) => e.generation === gen && e.last)).toBe(true) // and the queue still completes
  })

  it('fills a failed cloud TTS chunk with silence too', async () => {
    const settings = defaultSettings()
    settings.voice.ttsProvider = 'openai'
    settings.features.cloudVoice = true
    const orch = new VoiceOrchestrator(makeDeps(settings))
    await armOrchestrator(orch)

    await orch.speak('Первое сообщение без ошибок совсем. FAIL здесь во втором предложении.')
    await flushReal() // let the fire-and-forget cloudSpeak() promises settle

    const events = audioEvents()
    const done = events.find((e) => e.last)
    expect(done).toBeDefined()
    const filler = events.find((e) => e.seq === 1 && e.generation === done!.generation && !e.last)
    expect(filler).toBeDefined()
    expect(filler!.pcm.byteLength).toBeGreaterThan(0)
  })
})

describe("VoiceOrchestrator 'thinking' watchdog (VO-02)", () => {
  it('forces a re-arm with an error if the agent never replies, but resets on a legitimate reply', async () => {
    vi.useFakeTimers()
    const settings = defaultSettings()
    const orch = new VoiceOrchestrator(makeDeps(settings), { thinkingMs: 5000, speakingMs: 5000 })
    orch.attachAgent()
    const client = await armOrchestrator(orch, () => vi.advanceTimersByTimeAsync(0))

    client.emitEvent('message', { type: 'final', text: 'привет вива', durationMs: 500 } satisfies WorkerToMain)
    expect(orch.getState()).toBe('thinking')

    // Advance to just before the timeout: nothing has happened yet.
    await vi.advanceTimersByTimeAsync(4999)
    expect(orch.getState()).toBe('thinking')

    await vi.advanceTimersByTimeAsync(2)
    expect(orch.getState()).toBe('armed')
    expect(stateEvents().some((e) => e.state === 'error' && e.detail === 'response timed out')).toBe(true)
  })

  it('does not fire if the agent replies before the timeout', async () => {
    vi.useFakeTimers()
    const settings = defaultSettings()
    const orch = new VoiceOrchestrator(makeDeps(settings), { thinkingMs: 5000, speakingMs: 5000 })
    orch.attachAgent()
    const client = await armOrchestrator(orch, () => vi.advanceTimersByTimeAsync(0))

    client.emitEvent('message', { type: 'final', text: 'привет вива', durationMs: 500 } satisfies WorkerToMain)
    expect(orch.getState()).toBe('thinking')

    await vi.advanceTimersByTimeAsync(1000)
    agentListener?.({
      type: 'result',
      result: { turnId: 't1', subtype: 'success', isError: false, costUsd: 0, totalCostUsd: 0, durationMs: 10, numTurns: 1, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    })
    expect(orch.getState()).toBe('armed')

    // Long past the original 5s timeout: the watchdog was cleared by the legitimate transition.
    await vi.advanceTimersByTimeAsync(10_000)
    expect(orch.getState()).toBe('armed')
    expect(stateEvents().some((e) => e.state === 'error')).toBe(false)
  })
})

describe("VoiceOrchestrator 'speaking' watchdog (VO-02)", () => {
  it('forces a re-arm, cancels playback and emits an error if speaking never completes', async () => {
    vi.useFakeTimers()
    const settings = defaultSettings()
    const orch = new VoiceOrchestrator(makeDeps(settings), { thinkingMs: 5000, speakingMs: 3000 })
    const client = await armOrchestrator(orch, () => vi.advanceTimersByTimeAsync(0))

    await orch.speak('Первое предложение довольно длинное значение. Второе тоже вполне длинное предложение.')
    expect(orch.getState()).toBe('speaking')

    await vi.advanceTimersByTimeAsync(2999)
    expect(orch.getState()).toBe('speaking')

    await vi.advanceTimersByTimeAsync(2)
    expect(orch.getState()).toBe('armed')
    expect(client.sent.some((m) => m.type === 'tts-cancel')).toBe(true)
    expect(stateEvents().some((e) => e.state === 'error' && e.detail === 'playback timed out')).toBe(true)
  })

  it('does not fire if playback legitimately finishes first', async () => {
    vi.useFakeTimers()
    const settings = defaultSettings()
    const orch = new VoiceOrchestrator(makeDeps(settings), { thinkingMs: 5000, speakingMs: 3000 })
    const client = await armOrchestrator(orch, () => vi.advanceTimersByTimeAsync(0))

    await orch.speak('Первое предложение довольно длинное значение. Второе тоже вполне длинное предложение.')
    const gen = client.sent.find((m) => m.type === 'tts')!.generation as number
    expect(orch.getState()).toBe('speaking')

    await vi.advanceTimersByTimeAsync(1000)
    orch.playbackEnded(gen)
    expect(orch.getState()).toBe('armed')

    // Well past the original 3s timeout: cleared by the legitimate playbackEnded() transition.
    await vi.advanceTimersByTimeAsync(5000)
    expect(orch.getState()).toBe('armed')
    expect(stateEvents().some((e) => e.state === 'error')).toBe(false)
  })
})
