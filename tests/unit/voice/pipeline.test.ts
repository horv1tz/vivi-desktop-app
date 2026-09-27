import { describe, expect, it } from 'vitest'
import {
  VoicePipeline,
  type SttEngine,
  type VadEngine,
  type WakeEngine,
} from '../../../src/voice-worker/pipeline'

class FakeVad implements VadEngine {
  speech = false
  segments: Float32Array[] = []
  feed(): boolean {
    return this.speech
  }
  popSegments(): Float32Array[] {
    return this.segments.splice(0)
  }
  flush(): void {}
  reset(): void {
    this.speech = false
    this.segments = []
  }
}

class FakeWake implements WakeEngine {
  fire = false
  feed(): boolean {
    const f = this.fire
    this.fire = false
    return f
  }
  reset(): void {}
}

class FakeStt implements SttEngine {
  streaming = true
  partials = 0
  finalized: (Float32Array | null)[] = []
  feed(): string | null {
    this.partials++
    return this.partials % 5 === 0 ? `partial ${this.partials}` : null
  }
  async finalize(segment: Float32Array | null): Promise<string> {
    this.finalized.push(segment)
    return segment && segment.length ? 'hello world' : ''
  }
  reset(): void {}
}

function setup(opts: Partial<ConstructorParameters<typeof VoicePipeline>[1]> = {}) {
  let now = 0
  const vad = new FakeVad()
  const wake = new FakeWake()
  const stt = new FakeStt()
  const events: string[] = []
  const finals: string[] = []
  const pipeline = new VoicePipeline(
    { wake, vad, stt },
    {
      sampleRate: 16000,
      silenceMs: 800,
      followupMs: 0,
      noSpeechTimeoutMs: 6000,
      maxUtteranceMs: 30_000,
      preRollMs: 1500,
      wakeWordEnabled: true,
      bargeInMs: 300,
      bargeInGraceMs: 400,
      bargeInRequiresWakeWord: false,
      now: () => now,
      ...opts,
    },
    {
      onState: (s) => events.push(`state:${s}`),
      onWake: () => events.push('wake'),
      onPartial: (t) => events.push(`partial:${t}`),
      onFinal: (t) => finals.push(t),
      onTimeout: () => events.push('timeout'),
      onLevel: () => undefined,
      onBargeIn: () => events.push('barge-in'),
      onError: (m) => events.push(`error:${m}`),
    },
  )
  const frame = new Float32Array(320)
  const tick = (ms = 20): void => {
    now += ms
    pipeline.feed(frame)
  }
  const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
  return { pipeline, vad, wake, stt, events, finals, tick, flush, now: () => now }
}

describe('VoicePipeline', () => {
  it('wakes on keyword, captures speech and finalizes on the VAD segment', async () => {
    const t = setup()
    t.pipeline.arm()
    expect(t.pipeline.current).toBe('armed')
    t.wake.fire = true
    t.tick()
    expect(t.events).toContain('wake')
    expect(t.pipeline.current).toBe('listening')
    t.vad.speech = true
    for (let i = 0; i < 10; i++) t.tick()
    expect(t.events.some((e) => e.startsWith('partial:'))).toBe(true)
    t.vad.speech = false
    t.vad.segments = [new Float32Array(16000)]
    t.tick()
    await t.flush()
    expect(t.finals).toEqual(['hello world'])
    expect(t.pipeline.current).toBe('armed')
  })

  it('times out when nobody speaks after wake', async () => {
    const t = setup()
    t.pipeline.arm()
    t.pipeline.startListening({ withPreRoll: false })
    for (let i = 0; i < 400; i++) t.tick(20)
    await t.flush()
    expect(t.events).toContain('timeout')
    expect(t.pipeline.current).toBe('armed')
    expect(t.finals).toEqual([])
  })

  it('push-to-talk includes pre-roll and finalizes on release', async () => {
    const t = setup()
    t.pipeline.arm()
    for (let i = 0; i < 50; i++) t.tick()
    t.pipeline.startListening({ withPreRoll: true })
    t.vad.speech = true
    for (let i = 0; i < 20; i++) t.tick()
    t.pipeline.stopListening()
    await t.flush()
    expect(t.finals).toEqual(['hello world'])
    const captured = t.stt.finalized[0]!
    // 50 frames of pre-roll (capped at 1.5 s = 75 frames) + 20 frames of speech
    expect(captured.length).toBe((50 + 20) * 320)
  })

  it('finalizes after trailing silence without a VAD segment (safety net)', async () => {
    const t = setup()
    t.pipeline.arm()
    t.pipeline.startListening({ withPreRoll: false })
    t.vad.speech = true
    for (let i = 0; i < 10; i++) t.tick()
    t.vad.speech = false
    for (let i = 0; i < 80; i++) t.tick()
    await t.flush()
    expect(t.finals).toEqual(['hello world'])
  })

  it('detects barge-in while speaking and starts listening with pre-roll', () => {
    const t = setup()
    t.pipeline.arm()
    t.pipeline.setSpeaking(true)
    t.vad.speech = true
    for (let i = 0; i < 20; i++) t.tick() // grace period 400 ms
    for (let i = 0; i < 16; i++) t.tick() // 320 ms of speech
    expect(t.events).toContain('barge-in')
    expect(t.pipeline.current).toBe('listening')
  })

  it('ignores audio when off and cancel returns to armed', () => {
    const t = setup()
    t.tick()
    expect(t.events).toEqual([])
    t.pipeline.arm()
    t.pipeline.startListening({ withPreRoll: false })
    t.pipeline.cancel()
    expect(t.pipeline.current).toBe('armed')
  })
})

describe('VoicePipeline "interrupt only by wake word" barge-in (VO-04)', () => {
  it('ordinary sustained speech does not interrupt while enabled', () => {
    const t = setup({ bargeInRequiresWakeWord: true })
    t.pipeline.arm()
    t.pipeline.setSpeaking(true)
    t.vad.speech = true
    for (let i = 0; i < 20; i++) t.tick() // clear the grace period
    for (let i = 0; i < 50; i++) t.tick() // far past the ordinary bargeInMs window
    expect(t.events).not.toContain('barge-in')
    expect(t.pipeline.current).toBe('armed')
  })

  it('the wake word does interrupt while enabled', () => {
    const t = setup({ bargeInRequiresWakeWord: true })
    t.pipeline.arm()
    t.pipeline.setSpeaking(true)
    for (let i = 0; i < 20; i++) t.tick() // clear the grace period
    t.wake.fire = true
    t.tick()
    expect(t.events).toContain('barge-in')
    expect(t.pipeline.current).toBe('listening')
  })

  it('falls back to ordinary VAD-gated barge-in when no wake engine is available', () => {
    let now = 0
    const vad = new FakeVad()
    const events: string[] = []
    const pipeline = new VoicePipeline(
      { wake: null, vad, stt: new FakeStt() },
      {
        sampleRate: 16000,
        silenceMs: 800,
        followupMs: 0,
        noSpeechTimeoutMs: 6000,
        maxUtteranceMs: 30_000,
        preRollMs: 1500,
        wakeWordEnabled: false,
        bargeInMs: 300,
        bargeInGraceMs: 400,
        bargeInRequiresWakeWord: true,
        now: () => now,
      },
      {
        onState: () => undefined,
        onWake: () => undefined,
        onPartial: () => undefined,
        onFinal: () => undefined,
        onTimeout: () => undefined,
        onLevel: () => undefined,
        onBargeIn: () => events.push('barge-in'),
        onError: () => undefined,
      },
    )
    const frame = new Float32Array(320)
    const tick = (ms = 20): void => {
      now += ms
      pipeline.feed(frame)
    }
    pipeline.arm()
    pipeline.setSpeaking(true)
    vad.speech = true
    for (let i = 0; i < 20; i++) tick() // clear the grace period
    for (let i = 0; i < 16; i++) tick() // 320 ms of speech, past bargeInMs
    expect(events).toContain('barge-in')
    expect(pipeline.current).toBe('listening')
  })

  it('unchanged (VAD-gated) behavior when disabled, even with a wake engine present', () => {
    const t = setup({ bargeInRequiresWakeWord: false })
    t.pipeline.arm()
    t.pipeline.setSpeaking(true)
    t.vad.speech = true
    for (let i = 0; i < 20; i++) t.tick()
    for (let i = 0; i < 16; i++) t.tick()
    expect(t.events).toContain('barge-in')
    expect(t.pipeline.current).toBe('listening')
  })
})

describe('VoicePipeline follow-up window (VO-03)', () => {
  it('does nothing when followupMs is 0 (disabled)', () => {
    const t = setup({ followupMs: 0 })
    t.pipeline.arm()
    t.pipeline.startFollowup()
    expect(t.pipeline.current).toBe('armed')
  })

  it('starts listening on speech alone, without the wake word firing', () => {
    const t = setup({ followupMs: 8000 })
    t.pipeline.arm()
    t.pipeline.startFollowup()
    expect(t.pipeline.current).toBe('followup')
    t.vad.speech = true
    t.tick()
    expect(t.pipeline.current).toBe('listening')
    expect(t.events).not.toContain('wake')
  })

  it('finalizes a follow-up utterance normally once the VAD segment completes', async () => {
    const t = setup({ followupMs: 8000 })
    t.pipeline.arm()
    t.pipeline.startFollowup()
    t.vad.speech = true
    t.tick()
    expect(t.pipeline.current).toBe('listening')
    for (let i = 0; i < 10; i++) t.tick()
    t.vad.speech = false
    t.vad.segments = [new Float32Array(16000)]
    t.tick()
    await t.flush()
    expect(t.finals).toEqual(['hello world'])
    expect(t.pipeline.current).toBe('armed')
  })

  it('falls back to armed (requiring the wake word again) once the window elapses with no speech', () => {
    const t = setup({ followupMs: 2000 })
    t.pipeline.arm()
    t.pipeline.startFollowup()
    for (let i = 0; i < 99; i++) t.tick() // 1980ms: just under 2000ms
    expect(t.pipeline.current).toBe('followup')
    for (let i = 0; i < 2; i++) t.tick() // 2020ms: past the window
    expect(t.pipeline.current).toBe('armed')
  })

  it('the wake word still works once the follow-up window has expired back to armed', () => {
    const t = setup({ followupMs: 2000 })
    t.pipeline.arm()
    t.pipeline.startFollowup()
    for (let i = 0; i < 101; i++) t.tick() // past the 2000ms window
    expect(t.pipeline.current).toBe('armed')
    t.wake.fire = true
    t.tick()
    expect(t.events).toContain('wake')
    expect(t.pipeline.current).toBe('listening')
  })
})
