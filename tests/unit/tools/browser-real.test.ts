import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

// Real integration test against a real, locally spawned Chromium — no mocking. Skipped wherever
// no Chrome/Chromium/Edge/Brave is discoverable, which is the normal case on this project's own
// CI (ci.yml sets PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 and its e2e tests only ever launch Electron
// itself via _electron.launch(), never a standalone browser, so no browser binary is expected to
// exist there). Run it locally with VIVI_BROWSER_BIN pointing at a real Chromium to verify the
// whole CDP pipeline for real — same "opt-in, not part of normal CI" spirit as real-agent*.spec.ts.
const {
  browserClick,
  browserClose,
  browserFind,
  browserOpen,
  browserRead,
  browserType,
  findBrowserExecutable,
} = await import('../../../src/main/agent/tools/browser')

const browserBin = findBrowserExecutable()

describe.skipIf(!browserBin)('browser.ts against a real Chromium (INT-03)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vivi-browser-test-'))
  const profileDir = join(dir, 'profile')
  const pagePath = join(dir, 'page.html')
  writeFileSync(
    pagePath,
    `<!doctype html><html><head><title>Vivi browser test</title></head><body>
      <h1>Hello from the test page</h1>
      <p>Some paragraph text to read.</p>
      <input type="text" placeholder="Your name" />
      <button id="go">Submit</button>
      <p id="result"></p>
      <script>
        document.getElementById('go').addEventListener('click', () => {
          const name = document.querySelector('input').value
          document.getElementById('result').textContent = 'Hello, ' + name + '!'
        })
      </script>
    </body></html>`,
    'utf8',
  )
  const pageUrl = pathToFileURL(pagePath).href

  afterAll(async () => {
    await browserClose()
  }, 20_000)

  it('opens a page and returns its title and text preview', async () => {
    const r = await browserOpen(profileDir, pageUrl)
    expect(r.title).toBe('Vivi browser test')
    expect(r.text).toContain('Hello from the test page')
  }, 30_000)

  it('reads the full page text', async () => {
    const r = await browserRead(profileDir)
    expect(r).toContain('Some paragraph text to read.')
  }, 15_000)

  it('finds an element by CSS selector and gets a stable ref', async () => {
    const els = await browserFind(profileDir, { selector: 'input' })
    expect(els).toHaveLength(1)
    expect(els[0]!.tag).toBe('input')
    expect(els[0]!.attributes.placeholder).toBe('Your name')
    expect(els[0]!.ref).toMatch(/^r-/)
  }, 15_000)

  it('finds an element by visible text', async () => {
    const els = await browserFind(profileDir, { text: 'Submit' })
    expect(els.length).toBeGreaterThan(0)
    expect(els.some((e) => e.tag === 'button')).toBe(true)
  }, 15_000)

  it('types into a field and clicks a button end to end', async () => {
    const [input] = await browserFind(profileDir, { selector: 'input' })
    await browserType(profileDir, input!.ref, 'Vivi')
    const [button] = await browserFind(profileDir, { selector: '#go' })
    await browserClick(profileDir, button!.ref)
    const result = await browserRead(profileDir, '#result')
    expect(result).toBe('Hello, Vivi!')
  }, 20_000)

  it('reports a clear error for a ref that no longer exists', async () => {
    const result = await browserClick(profileDir, 'r-doesnotexist')
    expect(result).toMatch(/not found/)
  }, 15_000)
})
