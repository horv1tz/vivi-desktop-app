import { safeStorage } from 'electron'
import Store from 'electron-store'
import { logger } from '../logging/log'

const log = logger('secrets')

export type SecretKey = 'claudeOauthToken' | 'anthropicApiKey' | 'proxyPassword' | 'openaiApiKey'

/**
 * Encrypted secret store: values are encrypted with Electron safeStorage (Keychain / DPAPI /
 * Secret Service) and the ciphertext is kept in a separate electron-store file.
 */
class SecretStore {
  private store = new Store<Record<string, string>>({ name: 'secrets', clearInvalidConfig: true })

  get backend(): string {
    return process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : process.platform
  }

  get isSecure(): boolean {
    if (!safeStorage.isEncryptionAvailable()) return false
    return this.backend !== 'basic_text'
  }

  async set(key: SecretKey, value: string): Promise<void> {
    if (!value) {
      this.store.delete(key)
      return
    }
    if (safeStorage.isEncryptionAvailable()) {
      const buf = await safeStorage.encryptStringAsync(value)
      this.store.set(key, `enc:${buf.toString('base64')}`)
    } else {
      log.warn('safeStorage unavailable; storing secret obfuscated only')
      this.store.set(key, `b64:${Buffer.from(value, 'utf8').toString('base64')}`)
    }
  }

  async get(key: SecretKey): Promise<string | null> {
    const raw = this.store.get(key)
    if (!raw) return null
    try {
      if (raw.startsWith('enc:')) {
        const res = await safeStorage.decryptStringAsync(Buffer.from(raw.slice(4), 'base64'))
        const value = typeof res === 'string' ? res : res.result
        if (typeof res !== 'string' && res.shouldReEncrypt) void this.set(key, value)
        return value
      }
      if (raw.startsWith('b64:')) return Buffer.from(raw.slice(4), 'base64').toString('utf8')
      return raw
    } catch (err) {
      log.error(`could not decrypt secret ${key}`, err)
      return null
    }
  }

  has(key: SecretKey): boolean {
    return this.store.has(key)
  }

  delete(key: SecretKey): void {
    this.store.delete(key)
  }
}

let instance: SecretStore | null = null
export function secrets(): SecretStore {
  if (!instance) instance = new SecretStore()
  return instance
}
