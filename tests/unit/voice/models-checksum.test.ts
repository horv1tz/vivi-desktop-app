import { describe, expect, it } from 'vitest'
import { checkSha256 } from '../../../src/main/voice/models'

describe('checkSha256 (VO-08)', () => {
  it('does nothing when the model has no pinned checksum yet', () => {
    expect(() => checkSha256('deadbeef', undefined, 'Some Model')).not.toThrow()
  })

  it('passes when the digest matches, case-insensitively', () => {
    expect(() => checkSha256('DEADBEEF', 'deadbeef', 'Some Model')).not.toThrow()
    expect(() => checkSha256('deadbeef', 'DEADBEEF', 'Some Model')).not.toThrow()
  })

  it('throws a clear error naming the model when the digest does not match', () => {
    expect(() => checkSha256('badc0ffee', 'deadbeef', 'Silero VAD v5')).toThrow(/Silero VAD v5/)
    expect(() => checkSha256('badc0ffee', 'deadbeef', 'Silero VAD v5')).toThrow(/checksum mismatch/)
  })
})
