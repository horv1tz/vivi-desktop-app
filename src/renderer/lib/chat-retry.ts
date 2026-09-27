import type { UiMessage } from '@shared/events'
import type { SendArgs } from '@shared/ipc'

/**
 * UX-04: rebuilds the SendArgs that produced the most recent user message, so a "Retry" button on
 * a failed turn can resend exactly what was sent rather than making the user retype it. Always
 * sent as a manual (non-voice) retry, even if the original message came from voice — clicking a
 * button in the chat view isn't a voice turn.
 */
export function lastUserSendArgs(messages: UiMessage[]): SendArgs | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (m.role !== 'user') continue
    const text = m.blocks
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
    const images = m.blocks
      .filter((b) => b.type === 'image')
      .map((b) => ({ mimeType: b.mimeType, data: b.data }))
    return { text, images: images.length ? images : undefined }
  }
  return null
}
