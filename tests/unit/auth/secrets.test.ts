import { describe, expect, it } from 'vitest'
import { computeIsSecure } from '../../../src/main/auth/secrets'

describe('computeIsSecure (SEC-06)', () => {
  it('is false when encryption is unavailable, regardless of platform/backend', () => {
    expect(computeIsSecure('linux', false, 'gnome_libsecret')).toBe(false)
    expect(computeIsSecure('darwin', false, 'darwin')).toBe(false)
    expect(computeIsSecure('win32', false, 'win32')).toBe(false)
  })

  it('is false on Linux when the selected backend is basic_text (no real keyring)', () => {
    expect(computeIsSecure('linux', true, 'basic_text')).toBe(false)
  })

  it('is true on Linux with a real keyring backend and encryption available', () => {
    expect(computeIsSecure('linux', true, 'gnome_libsecret')).toBe(true)
    expect(computeIsSecure('linux', true, 'kwallet')).toBe(true)
  })

  it('is true on macOS/Windows whenever encryption is available (backend is not meaningful there)', () => {
    expect(computeIsSecure('darwin', true, 'darwin')).toBe(true)
    expect(computeIsSecure('win32', true, 'win32')).toBe(true)
  })
})
