import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { join, posix, win32 } from 'node:path'
import CDP from 'chrome-remote-interface'
import { splitArgs } from '../acp/args'

/**
 * INT-03: browser automation over CDP, driving a dedicated Chromium instance — never the user's
 * everyday browser. Attaching to a real, already-logged-in browser over a debugging port would
 * hand any tool call full control of every authenticated session in it; a separate profile keeps
 * "what has Vivi done in a browser" answerable on its own, the same way computer-use tools are
 * scoped and confirmed rather than reaching into arbitrary existing state.
 */

export interface BrowserElement {
  ref: string
  tag: string
  text: string
  attributes: Record<string, string>
}

export function candidateExecutables(plat: NodeJS.Platform): string[] {
  if (plat === 'darwin')
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ]
  if (plat === 'win32') {
    const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files'
    const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
    const local = process.env['LOCALAPPDATA'] ?? ''
    return [
      join(pf, 'Google\\Chrome\\Application\\chrome.exe'),
      join(pf86, 'Google\\Chrome\\Application\\chrome.exe'),
      join(local, 'Google\\Chrome\\Application\\chrome.exe'),
      join(pf, 'Microsoft\\Edge\\Application\\msedge.exe'),
      join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe'),
      join(pf, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
    ]
  }
  // Linux/BSD: bare command names, resolved against PATH by commandExistsOnPath.
  return [
    'google-chrome-stable',
    'google-chrome',
    'chromium',
    'chromium-browser',
    'microsoft-edge-stable',
    'microsoft-edge',
    'brave-browser',
  ]
}

export function commandExistsOnPath(cmd: string, plat: NodeJS.Platform): boolean {
  const dirs = (process.env.PATH ?? '').split(plat === 'win32' ? ';' : ':')
  const names = plat === 'win32' ? [cmd, `${cmd}.exe`] : [cmd]
  // Joins with `plat`'s own separator, not the host's — `plat` always matches the host in real
  // usage (findBrowserExecutable() passes process.platform), but tests exercise other platforms'
  // logic on whatever OS CI happens to run on, which the ambient `join` can't do correctly.
  const platJoin = plat === 'win32' ? win32.join : posix.join
  return dirs.some((d) => d && names.some((n) => existsSync(platJoin(d, n))))
}

/** Finds an installed Chrome/Chromium/Edge/Brave. `VIVI_BROWSER_BIN` overrides everything (dev/CI, and anyone who wants a specific browser). */
export function findBrowserExecutable(): string | null {
  const override = process.env.VIVI_BROWSER_BIN
  if (override && existsSync(override)) return override
  const plat = process.platform
  for (const c of candidateExecutables(plat)) {
    const isPath = c.includes('/') || c.includes('\\')
    if (isPath ? existsSync(c) : commandExistsOnPath(c, plat)) return c
  }
  return null
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => (port ? resolve(port) : reject(new Error('no free port'))))
    })
  })
}

async function waitForCdpReady(port: number, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastErr: unknown
  while (Date.now() < deadline) {
    try {
      await CDP.Version({ port, host: '127.0.0.1' })
      return
    } catch (err) {
      lastErr = err
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  throw new Error(`browser did not become ready on port ${port}: ${(lastErr as Error)?.message}`)
}

let proc: ChildProcess | null = null
let port: number | null = null
let client: CDP.Client | null = null
let targetId: string | null = null

async function ensureBrowser(profileDir: string): Promise<number> {
  if (proc && !proc.killed && port) {
    try {
      await CDP.Version({ port, host: '127.0.0.1' })
      return port
    } catch {
      proc = null
      port = null
      client = null
      targetId = null
    }
  }
  const exe = findBrowserExecutable()
  if (!exe)
    throw new Error(
      'No Chrome, Chromium, Edge or Brave installation found for browser automation. Install one, or set VIVI_BROWSER_BIN to its executable path.',
    )
  const p = await findFreePort()
  // VIVI_BROWSER_ARGS lets an advanced user (or a root/CI sandbox, where Chromium refuses to
  // start at all without --no-sandbox) append extra flags. Deliberately not baked into the
  // defaults below: --no-sandbox by default would weaken every real, non-root end user's install.
  const child = spawn(
    exe,
    [
      `--remote-debugging-port=${p}`,
      `--remote-debugging-address=127.0.0.1`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--password-store=basic',
      ...splitArgs(process.env.VIVI_BROWSER_ARGS ?? ''),
      'about:blank',
    ],
    { detached: false, stdio: 'ignore' },
  )
  child.on('exit', () => {
    proc = null
    port = null
    client = null
    targetId = null
  })
  proc = child
  await waitForCdpReady(p)
  port = p
  return p
}

async function getClient(profileDir: string): Promise<CDP.Client> {
  const p = await ensureBrowser(profileDir)
  if (client) return client
  if (!targetId) {
    const target = await CDP.New({ port: p, host: '127.0.0.1', url: 'about:blank' })
    targetId = target.id
  }
  const c = await CDP({ port: p, host: '127.0.0.1', target: targetId })
  await c.Page.enable()
  await c.Runtime.enable()
  c.on('disconnect', () => {
    if (client === c) client = null
  })
  client = c
  return c
}

/** Evaluates `expression` in the page and returns the JSON-decoded result (the expression must itself return a JSON-serializable value). */
async function evaluateJson<T>(c: CDP.Client, expression: string): Promise<T> {
  const result = await c.Runtime.evaluate({
    expression: `JSON.stringify((function(){ ${expression} })())`,
    returnByValue: true,
    awaitPromise: true,
  })
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.exception?.description ?? 'page script failed')
  const value = result.result.value as string | undefined
  return value ? (JSON.parse(value) as T) : (undefined as T)
}

export async function browserOpen(
  profileDir: string,
  url: string,
): Promise<{ title: string; url: string; text: string }> {
  const c = await getClient(profileDir)
  const loaded = c.Page.loadEventFired()
  await c.Page.navigate({ url })
  await Promise.race([loaded, new Promise((r) => setTimeout(r, 15_000))])
  return evaluateJson(
    c,
    `return { title: document.title, url: location.href, text: (document.body ? document.body.innerText : '').trim().slice(0, 1500) }`,
  )
}

const REF_ATTR = 'data-vivi-ref'
const ATTRS_TO_KEEP = [
  'id',
  'class',
  'href',
  'type',
  'name',
  'placeholder',
  'value',
  'aria-label',
  'role',
]

export async function browserFind(
  profileDir: string,
  query: { selector?: string; text?: string },
): Promise<BrowserElement[]> {
  const c = await getClient(profileDir)
  const args = JSON.stringify({
    selector: query.selector ?? null,
    text: query.text ?? null,
    refAttr: REF_ATTR,
    keepAttrs: ATTRS_TO_KEEP,
  })
  return evaluateJson(
    c,
    `
    const { selector, text, refAttr, keepAttrs } = ${args}
    const isVisible = (el) => {
      const r = el.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) return false
      const s = getComputedStyle(el)
      return s.visibility !== 'hidden' && s.display !== 'none'
    }
    let candidates = []
    if (selector) {
      candidates = Array.from(document.querySelectorAll(selector))
    } else if (text) {
      const needle = text.toLowerCase()
      const all = Array.from(
        document.querySelectorAll('a,button,input,textarea,select,[role],h1,h2,h3,h4,h5,h6,p,span,div,li,label'),
      )
      candidates = all.filter((el) => {
        const own = (el.textContent || '').trim().toLowerCase()
        if (!own.includes(needle)) return false
        // Prefer the innermost matching element: skip one whose matching child already covers it.
        return !Array.from(el.children).some((ch) => (ch.textContent || '').toLowerCase().includes(needle))
      })
    }
    candidates = candidates.filter(isVisible).slice(0, 20)
    return candidates.map((el) => {
      if (!el.getAttribute(refAttr)) el.setAttribute(refAttr, 'r-' + Math.random().toString(36).slice(2, 10))
      const attributes = {}
      for (const a of keepAttrs) {
        const v = el.getAttribute(a)
        if (v) attributes[a] = v.length > 200 ? v.slice(0, 200) : v
      }
      return {
        ref: el.getAttribute(refAttr),
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || '').trim().slice(0, 200),
        attributes,
      }
    })
    `,
  )
}

export async function browserClick(profileDir: string, ref: string): Promise<string> {
  const c = await getClient(profileDir)
  const args = JSON.stringify({ ref, refAttr: REF_ATTR })
  return evaluateJson(
    c,
    `
    const { ref, refAttr } = ${args}
    const el = document.querySelector('[' + refAttr + '="' + ref + '"]')
    if (!el) return 'element not found (it may have left the page — call browser_find again)'
    el.scrollIntoView({ block: 'center', inline: 'center' })
    el.click()
    return 'clicked'
    `,
  )
}

export async function browserType(profileDir: string, ref: string, text: string): Promise<string> {
  const c = await getClient(profileDir)
  const args = JSON.stringify({ ref, refAttr: REF_ATTR, text })
  return evaluateJson(
    c,
    `
    const { ref, refAttr, text } = ${args}
    const el = document.querySelector('[' + refAttr + '="' + ref + '"]')
    if (!el) return 'element not found (it may have left the page — call browser_find again)'
    el.scrollIntoView({ block: 'center', inline: 'center' })
    el.focus()
    const isFormField = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
    if (isFormField) {
      const proto = el.tagName === 'INPUT' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
      setter.call(el, text)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    } else if (el.isContentEditable) {
      el.textContent = text
      el.dispatchEvent(new Event('input', { bubbles: true }))
    } else {
      return 'element is not a text input, textarea or editable region'
    }
    return 'typed ' + text.length + ' chars'
    `,
  )
}

export async function browserRead(profileDir: string, selector?: string): Promise<string> {
  const c = await getClient(profileDir)
  const args = JSON.stringify({ selector: selector ?? null })
  return evaluateJson(
    c,
    `
    const { selector } = ${args}
    const el = selector ? document.querySelector(selector) : document.body
    if (!el) return selector ? 'no element matches ' + JSON.stringify(selector) : '(empty page)'
    return el.innerText.trim().slice(0, 8000)
    `,
  )
}

export async function browserClose(): Promise<void> {
  const c = client
  client = null
  targetId = null
  try {
    await c?.close()
  } catch {
    // best-effort
  }
  const p = proc
  proc = null
  port = null
  if (p && !p.killed) p.kill()
}
