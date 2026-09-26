import { cpSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { mainWindow } from './helpers'

// Boots the voice utilityProcess with real sherpa-onnx models inside Electron (no microphone needed).
// Opt in with VIVI_E2E_VOICE=1 and VIVI_MODELS_DIR=<dir with extracted models>.
test.skip(process.env.VIVI_E2E_VOICE !== '1' || !process.env.VIVI_MODELS_DIR, 'set VIVI_E2E_VOICE=1 and VIVI_MODELS_DIR to run')

test('voice worker loads models and arms the pipeline', async () => {
  test.setTimeout(120_000)
  const userData = mkdtempSync(join(tmpdir(), 'vivi-voice-'))
  cpSync(process.env.VIVI_MODELS_DIR!, join(userData, 'models'), { recursive: true })
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ onboardingCompleted: true, voice: { enabled: true, wakeWordEnabled: true, wakeWordStrategy: 'kws', sttModel: 'stt-zipformer-small-ru', ttsVoice: 'tts-piper-ru-irina' } }))
  const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${userData}`], env: { ...process.env, VIVI_MOCK_AGENT: '1' }, timeout: 60_000 })
  try {
    const page = await mainWindow(app)
    await page.evaluate(() => (window as unknown as { vivi: { invoke: (c: string) => Promise<unknown> } }).vivi.invoke('voice:start'))
    await expect
      .poll(async () => page.evaluate(() => (window as unknown as { vivi: { invoke: (c: string) => Promise<string> } }).vivi.invoke('voice:getState')), { timeout: 90_000, intervals: [1000] })
      .toBe('armed')
    // Synthesize speech through the worker and confirm audio chunks reach the renderer.
    const chunks = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const w = window as unknown as { vivi: { invoke: (c: string, ...a: unknown[]) => Promise<unknown>; on: (c: string, l: (p: { last: boolean; pcm: ArrayBuffer }) => void) => () => void } }
          let n = 0
          const off = w.vivi.on('voice:audio', (p) => {
            if (p.pcm.byteLength > 0) {
              n++
              off()
              resolve(n)
            }
          })
          void w.vivi.invoke('voice:speak', 'Привет! Проверка голоса.')
          setTimeout(() => resolve(n), 30_000)
        }),
    )
    expect(chunks).toBeGreaterThan(0)
  } finally {
    await app.close()
  }
})
