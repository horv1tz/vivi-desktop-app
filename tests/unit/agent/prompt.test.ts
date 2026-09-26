import { describe, expect, it } from 'vitest'
import { VOICE_MESSAGE_MARKER, buildSystemPrompt, markVoiceText } from '../../../src/main/agent/prompt'

describe('markVoiceText', () => {
  it('prefixes the marker only when the message came from voice', () => {
    expect(markVoiceText('hello', true)).toBe(`${VOICE_MESSAGE_MARKER}hello`)
    expect(markVoiceText('hello', false)).toBe('hello')
    expect(markVoiceText('hello', undefined)).toBe('hello')
  })
})

describe('buildSystemPrompt (AG-01)', () => {
  const ctx = { platform: 'linux', locale: 'en' as const, workspaceDir: '/w', homeDir: '/h', memoryFile: '/w/memory/VIVI.md' }

  it('explains the voice marker in the static part instead of a frozen process-level flag', () => {
    const { staticPart } = buildSystemPrompt(ctx)
    expect(staticPart).toContain(VOICE_MESSAGE_MARKER)
  })

  it('never bakes a one-off "voice mode" line into the dynamic part', () => {
    // The dynamic part used to carry a frozen `voiceMode` flag from whichever turn started the
    // session (systemPrompt uses snapshot: true), which then applied to every later turn
    // regardless of its own origin. That flag is gone; per-turn origin is now message-level only.
    const { dynamicPart } = buildSystemPrompt(ctx)
    expect(dynamicPart).not.toContain('voice mode')
  })
})
