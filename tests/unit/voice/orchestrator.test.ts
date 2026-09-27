import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentUiEvent, PermissionRequest, QuestionRequest } from '../../../src/shared/events'
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
vi.mock('../../../src/main/auth/secrets', () => ({
  secrets: () => ({ get: async () => 'fake-openai-key', set: async () => undefined }),
}))
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
const workerClientMock = (await import('../../../src/main/voice/worker-client')) as unknown as {
  __getLastWorkerClient: () => FakeWorkerClientLike
}

const flushReal = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
const finalTranscript = (text: string): WorkerToMain => ({ type: 'final', text, durationMs: 300 })
const spokenText = (client: FakeWorkerClientLike): string =>
  client.sent
    .filter((m) => m.type === 'tts')
    .map((m) => m.text as string)
    .join(' ')

let agentListener: ((e: AgentUiEvent) => void) | null = null
let permissionListener: ((req: PermissionRequest) => void) | null = null
let permissionResolvedListener: ((id: string) => void) | null = null
let questionListener: ((req: QuestionRequest) => void) | null = null
let questionResolvedListener: ((id: string) => void) | null = null

function makeDeps(settings: Settings): OrchestratorDeps {
  agentListener = null
  permissionListener = null
  permissionResolvedListener = null
  questionListener = null
  questionResolvedListener = null
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
    onPermissionRequest: (listener) => {
      permissionListener = listener
      return () => {
        permissionListener = null
      }
    },
    onPermissionResolved: (listener) => {
      permissionResolvedListener = listener
      return () => {
        permissionResolvedListener = null
      }
    },
    respondPermission: vi.fn(),
    onQuestionRequest: (listener) => {
      questionListener = listener
      return () => {
        questionListener = null
      }
    },
    onQuestionResolved: (listener) => {
      questionResolvedListener = listener
      return () => {
        questionResolvedListener = null
      }
    },
    answerQuestion: vi.fn(),
  }
}

/** Starts the orchestrator and completes the worker handshake so it reaches 'armed'. */
async function armOrchestrator(
  orch: InstanceType<typeof VoiceOrchestrator>,
  flush: () => Promise<unknown> = flushReal,
): Promise<FakeWorkerClientLike> {
  const starting = orch.start()
  await flush()
  const client = workerClientMock.__getLastWorkerClient()!
  client.emitEvent('message', {
    type: 'init-done',
    ok: true,
    capabilities: { stt: true, vad: true, kws: true, tts: true },
  } satisfies WorkerToMain)
  await starting
  return client
}

function audioEvents(): {
  generation: number
  seq: number
  sampleRate: number
  pcm: ArrayBuffer
  last: boolean
}[] {
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

    await orch.speak(
      'Привет! Я нашла три файла в папке. Первый называется notes.md, второй — plan.txt.',
    )
    const ttsSent = client.sent.filter((m) => m.type === 'tts')
    expect(ttsSent.length).toBe(2)
    const gen = ttsSent[0]!.generation as number

    const seq0 = ttsSent[0]!.seq as number
    const seq1 = ttsSent[1]!.seq as number
    client.emitEvent('message', {
      type: 'tts-audio',
      generation: gen,
      seq: seq0,
      sampleRate: 16000,
      pcm: new Float32Array(320).buffer,
    } satisfies WorkerToMain)
    client.emitEvent('message', {
      type: 'tts-error',
      generation: gen,
      seq: seq1,
      error: 'sherpa boom',
    } satisfies WorkerToMain)

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

    await orch.speak(
      'Первое предложение довольно длинное значение. Второе тоже вполне длинное предложение.',
    )
    const ttsSent = client.sent.filter((m) => m.type === 'tts')
    expect(ttsSent.length).toBe(2)
    const gen = ttsSent[0]!.generation as number
    for (const job of ttsSent)
      client.emitEvent('message', {
        type: 'tts-error',
        generation: gen,
        seq: job.seq as number,
        error: 'boom',
      } satisfies WorkerToMain)

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

    client.emitEvent('message', {
      type: 'final',
      text: 'привет вива',
      durationMs: 500,
    } satisfies WorkerToMain)
    expect(orch.getState()).toBe('thinking')

    // Advance to just before the timeout: nothing has happened yet.
    await vi.advanceTimersByTimeAsync(4999)
    expect(orch.getState()).toBe('thinking')

    await vi.advanceTimersByTimeAsync(2)
    expect(orch.getState()).toBe('armed')
    expect(
      stateEvents().some((e) => e.state === 'error' && e.detail === 'response timed out'),
    ).toBe(true)
  })

  it('does not fire if the agent replies before the timeout', async () => {
    vi.useFakeTimers()
    const settings = defaultSettings()
    const orch = new VoiceOrchestrator(makeDeps(settings), { thinkingMs: 5000, speakingMs: 5000 })
    orch.attachAgent()
    const client = await armOrchestrator(orch, () => vi.advanceTimersByTimeAsync(0))

    client.emitEvent('message', {
      type: 'final',
      text: 'привет вива',
      durationMs: 500,
    } satisfies WorkerToMain)
    expect(orch.getState()).toBe('thinking')

    await vi.advanceTimersByTimeAsync(1000)
    agentListener?.({
      type: 'result',
      result: {
        turnId: 't1',
        subtype: 'success',
        isError: false,
        costUsd: 0,
        totalCostUsd: 0,
        durationMs: 10,
        numTurns: 1,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
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

    await orch.speak(
      'Первое предложение довольно длинное значение. Второе тоже вполне длинное предложение.',
    )
    expect(orch.getState()).toBe('speaking')

    await vi.advanceTimersByTimeAsync(2999)
    expect(orch.getState()).toBe('speaking')

    await vi.advanceTimersByTimeAsync(2)
    expect(orch.getState()).toBe('armed')
    expect(client.sent.some((m) => m.type === 'tts-cancel')).toBe(true)
    expect(
      stateEvents().some((e) => e.state === 'error' && e.detail === 'playback timed out'),
    ).toBe(true)
  })

  it('does not fire if playback legitimately finishes first', async () => {
    vi.useFakeTimers()
    const settings = defaultSettings()
    const orch = new VoiceOrchestrator(makeDeps(settings), { thinkingMs: 5000, speakingMs: 3000 })
    const client = await armOrchestrator(orch, () => vi.advanceTimersByTimeAsync(0))

    await orch.speak(
      'Первое предложение довольно длинное значение. Второе тоже вполне длинное предложение.',
    )
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

describe('VoiceOrchestrator voice permissions and questions (VO-05)', () => {
  const permissionReq: PermissionRequest = {
    requestId: 'p1',
    toolName: 'Bash',
    input: {},
    category: 'exec',
    dangerous: false,
    dangerReasons: [],
    canAlwaysAllow: true,
    suggestionsCount: 0,
    displayName: 'run a shell command',
  }
  const questionReq: QuestionRequest = {
    requestId: 'q1',
    questions: [
      { question: 'Which language?', options: [{ label: 'TypeScript' }, { label: 'Python' }] },
    ],
  }

  it('only speaks/force-listens for a permission request raised during a voice-originated turn', async () => {
    const settings = defaultSettings()
    const orch = new VoiceOrchestrator(makeDeps(settings))
    orch.attachAgent()
    const client = await armOrchestrator(orch)

    // No voice turn in progress yet: a permission request must be a no-op for voice.
    permissionListener?.(permissionReq)
    expect(client.sent.some((m) => m.type === 'ptt')).toBe(false)

    client.emitEvent('message', finalTranscript('run the tests'))
    await flushReal()
    client.sent.length = 0
    permissionListener?.(permissionReq)

    expect(client.sent.some((m) => m.type === 'ptt' && m.active === true)).toBe(true)
    expect(spokenText(client)).toContain('run a shell command')
  })

  it('resolves the permission from a matched voice answer, stops forced listening, and lets the next utterance start a normal turn again', async () => {
    const settings = defaultSettings()
    const deps = makeDeps(settings)
    const orch = new VoiceOrchestrator(deps)
    orch.attachAgent()
    const client = await armOrchestrator(orch)
    client.emitEvent('message', finalTranscript('run the tests'))
    await flushReal()
    permissionListener?.(permissionReq)
    client.sent.length = 0

    client.emitEvent('message', finalTranscript('yes, go ahead'))
    await flushReal()

    expect(deps.respondPermission).toHaveBeenCalledWith('p1', 'allow')
    expect(client.sent.some((m) => m.type === 'ptt' && m.active === false)).toBe(true)
    expect(spokenText(client)).toBeTruthy()

    // Pending is cleared: the next utterance is a normal new turn, not another answer attempt.
    ;(deps.sendToAgent as ReturnType<typeof vi.fn>).mockClear()
    client.emitEvent('message', finalTranscript('open settings'))
    await flushReal()
    expect(deps.sendToAgent).toHaveBeenCalledWith({ text: 'open settings', fromVoice: true })
  })

  it('re-prompts instead of forwarding an unrecognized answer to the agent', async () => {
    const settings = defaultSettings()
    const deps = makeDeps(settings)
    const orch = new VoiceOrchestrator(deps)
    orch.attachAgent()
    const client = await armOrchestrator(orch)
    client.emitEvent('message', finalTranscript('run the tests'))
    await flushReal()
    permissionListener?.(permissionReq)
    client.sent.length = 0

    client.emitEvent('message', finalTranscript('what time is it'))
    await flushReal()

    expect(deps.respondPermission).not.toHaveBeenCalled()
    expect(deps.sendToAgent).not.toHaveBeenCalledWith({
      text: 'what time is it',
      fromVoice: true,
    })
    expect(spokenText(client)).toBeTruthy() // re-prompted instead of silently dropping it
  })

  it('clears the pending permission and forced listening when it is resolved from the UI instead of voice', async () => {
    const settings = defaultSettings()
    const deps = makeDeps(settings)
    const orch = new VoiceOrchestrator(deps)
    orch.attachAgent()
    const client = await armOrchestrator(orch)
    client.emitEvent('message', finalTranscript('run the tests'))
    await flushReal()
    permissionListener?.(permissionReq)
    client.sent.length = 0

    permissionResolvedListener?.('p1')
    expect(client.sent.some((m) => m.type === 'ptt' && m.active === false)).toBe(true)

    // A follow-up utterance is now a normal turn, not treated as a stale answer attempt.
    client.emitEvent('message', finalTranscript('open settings'))
    await flushReal()
    expect(deps.sendToAgent).toHaveBeenCalledWith({ text: 'open settings', fromVoice: true })
  })

  it('clears the pending question and forced listening when it is resolved from the UI instead of voice', async () => {
    const settings = defaultSettings()
    const deps = makeDeps(settings)
    const orch = new VoiceOrchestrator(deps)
    orch.attachAgent()
    const client = await armOrchestrator(orch)
    client.emitEvent('message', finalTranscript('help me pick a language'))
    await flushReal()
    questionListener?.(questionReq)
    client.sent.length = 0

    questionResolvedListener?.('q1')
    expect(client.sent.some((m) => m.type === 'ptt' && m.active === false)).toBe(true)

    client.emitEvent('message', finalTranscript('open settings'))
    await flushReal()
    expect(deps.sendToAgent).toHaveBeenCalledWith({ text: 'open settings', fromVoice: true })
  })

  it('speaks a single-select question, then answers it by number and sends answers keyed by question text', async () => {
    const settings = defaultSettings()
    const deps = makeDeps(settings)
    const orch = new VoiceOrchestrator(deps)
    orch.attachAgent()
    const client = await armOrchestrator(orch)
    client.emitEvent('message', finalTranscript('help me pick a language'))
    await flushReal()
    questionListener?.(questionReq)

    expect(client.sent.some((m) => m.type === 'ptt' && m.active === true)).toBe(true)
    expect(spokenText(client)).toContain('Which language?')
    client.sent.length = 0

    client.emitEvent('message', finalTranscript('option 2'))
    await flushReal()

    expect(deps.answerQuestion).toHaveBeenCalledWith('q1', { 'Which language?': 'Python' })
  })

  it('does not attempt voice Q&A for a multi-question prompt (falls back to the on-screen dialog only)', async () => {
    const settings = defaultSettings()
    const deps = makeDeps(settings)
    const orch = new VoiceOrchestrator(deps)
    orch.attachAgent()
    const client = await armOrchestrator(orch)
    client.emitEvent('message', finalTranscript('help me pick'))
    await flushReal()
    client.sent.length = 0

    questionListener?.({
      requestId: 'q2',
      questions: [
        { question: 'A?', options: [{ label: 'x' }] },
        { question: 'B?', options: [{ label: 'y' }] },
      ],
    })

    expect(client.sent.some((m) => m.type === 'ptt')).toBe(false)
    expect(spokenText(client)).toBe('')
  })
})

describe('VoiceOrchestrator follow-up window (VO-03)', () => {
  const resultEvent = (): AgentUiEvent => ({
    type: 'result',
    result: {
      turnId: 't1',
      subtype: 'success',
      isError: false,
      costUsd: 0,
      totalCostUsd: 0,
      durationMs: 10,
      numTurns: 1,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  })

  it('opens a follow-up window once a spoken reply finishes playing, not before', async () => {
    const settings = defaultSettings()
    const orch = new VoiceOrchestrator(makeDeps(settings))
    orch.attachAgent()
    const client = await armOrchestrator(orch)
    client.emitEvent('message', finalTranscript('what is the weather'))
    await flushReal()
    agentListener?.({
      type: 'text-delta',
      messageId: 'm1',
      blockIndex: 0,
      text: 'Sunny.',
      kind: 'text',
    })
    agentListener?.(resultEvent())
    const gen = client.sent.find((m) => m.type === 'tts')!.generation as number

    // Still speaking: no follow-up message sent yet.
    expect(client.sent.some((m) => m.type === 'followup')).toBe(false)

    orch.playbackEnded(gen)
    expect(client.sent.some((m) => m.type === 'followup')).toBe(true)
  })

  it('opens the follow-up window immediately when the reply had nothing to speak', async () => {
    const settings = defaultSettings()
    const orch = new VoiceOrchestrator(makeDeps(settings))
    orch.attachAgent()
    const client = await armOrchestrator(orch)
    client.emitEvent('message', finalTranscript('be quiet please'))
    await flushReal()
    // No text-delta at all: nothing queued to speak.
    agentListener?.(resultEvent())

    expect(client.sent.some((m) => m.type === 'followup')).toBe(true)
  })

  it('does not open a follow-up window while a permission/question is pending', async () => {
    const settings = defaultSettings()
    const orch = new VoiceOrchestrator(makeDeps(settings))
    orch.attachAgent()
    const client = await armOrchestrator(orch)
    client.emitEvent('message', finalTranscript('run the tests'))
    await flushReal()
    permissionListener?.({
      requestId: 'p1',
      toolName: 'Bash',
      input: {},
      category: 'exec',
      dangerous: false,
      dangerReasons: [],
      canAlwaysAllow: true,
      suggestionsCount: 0,
    })
    client.sent.length = 0

    agentListener?.({
      type: 'text-delta',
      messageId: 'm1',
      blockIndex: 0,
      text: 'Done.',
      kind: 'text',
    })
    agentListener?.(resultEvent())
    const gen = client.sent.find((m) => m.type === 'tts')?.generation as number | undefined
    if (gen !== undefined) orch.playbackEnded(gen)

    expect(client.sent.some((m) => m.type === 'followup')).toBe(false)
  })
})
