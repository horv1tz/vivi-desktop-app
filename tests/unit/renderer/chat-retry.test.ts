// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck -- src/renderer/** is outside tsconfig.node.json's (composite) project file list, so
// `tsc -p tsconfig.node.json` can't resolve this cross-project import (TS6307); tsconfig.web.json
// covers src/renderer/** but excludes tests/, so no single tsc project spans both (see the same
// workaround in tests/unit/voice/mic-watchdog.test.ts). Vitest transpiles per-file at runtime, so
// the test still runs for real against the actual renderer module — only static type-checking of
// *this* file is skipped.
import { describe, expect, it } from 'vitest'
import { lastUserSendArgs } from '../../../src/renderer/lib/chat-retry'
import type { UiMessage } from '../../../src/shared/events'

const userMessage = (id: string, blocks: UiMessage['blocks']): UiMessage => ({
  id,
  role: 'user',
  blocks,
  timestamp: 0,
})

const assistantMessage = (id: string, blocks: UiMessage['blocks']): UiMessage => ({
  id,
  role: 'assistant',
  blocks,
  timestamp: 0,
})

describe('lastUserSendArgs', () => {
  it('is null with no messages', () => {
    expect(lastUserSendArgs([])).toBeNull()
  })

  it('is null when there is no user message at all', () => {
    const messages = [assistantMessage('a1', [{ type: 'text', text: 'hi' }])]
    expect(lastUserSendArgs(messages)).toBeNull()
  })

  it('rebuilds text from the last user message', () => {
    const messages = [
      userMessage('u1', [{ type: 'text', text: 'first' }]),
      assistantMessage('a1', [{ type: 'text', text: 'reply' }]),
      userMessage('u2', [{ type: 'text', text: 'second' }]),
    ]
    expect(lastUserSendArgs(messages)).toEqual({ text: 'second', images: undefined })
  })

  it('joins multiple text blocks with a newline', () => {
    const messages = [
      userMessage('u1', [
        { type: 'text', text: 'line one' },
        { type: 'text', text: 'line two' },
      ]),
    ]
    expect(lastUserSendArgs(messages)!.text).toBe('line one\nline two')
  })

  it('collects image blocks, dropping their type discriminant', () => {
    const messages = [
      userMessage('u1', [
        { type: 'text', text: 'look at this' },
        { type: 'image', mimeType: 'image/png', data: 'AAAA' },
      ]),
    ]
    expect(lastUserSendArgs(messages)).toEqual({
      text: 'look at this',
      images: [{ mimeType: 'image/png', data: 'AAAA' }],
    })
  })

  it('ignores an assistant message after the last user message', () => {
    const messages = [
      userMessage('u1', [{ type: 'text', text: 'question' }]),
      assistantMessage('a1', [{ type: 'text', text: 'answer' }]),
    ]
    expect(lastUserSendArgs(messages)!.text).toBe('question')
  })
})
