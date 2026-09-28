import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  autoAllowedTools,
  categorize,
  isUnderTrustedFolder,
  makePolicy,
  matchesRule,
} from '../../../src/main/agent/permissions/policy'
import { defaultSettings } from '../../../src/shared/settings'

function freshState() {
  return {
    sessionGrants: new Set<'read' | 'edit' | 'exec' | 'input' | 'system' | 'unknown'>(),
    turnGrants: new Set<'read' | 'edit' | 'exec' | 'input' | 'system' | 'unknown'>(),
  }
}

describe('policy', () => {
  it('categorizes tools', () => {
    expect(categorize('Read')).toBe('read')
    expect(categorize('Edit')).toBe('edit')
    expect(categorize('Bash')).toBe('exec')
    expect(categorize('mcp__vivi__mouse')).toBe('input')
    expect(categorize('mcp__vivi__system')).toBe('system')
    expect(categorize('mcp__foo__bar')).toBe('unknown')
  })

  it('auto-allows read-only tools by default and edits when asking is off', () => {
    const s = defaultSettings().permissions
    expect(autoAllowedTools(s)).toContain('Read')
    expect(autoAllowedTools(s)).not.toContain('Write')
    expect(autoAllowedTools({ ...s, askForEdits: false })).toContain('Write')
  })

  it('screenshot and clipboard read have their own auto-allow toggle, independent of autoAllowReadOnly', () => {
    const s = {
      ...defaultSettings().permissions,
      autoAllowReadOnly: false,
      autoAllowScreenshot: true,
      autoAllowClipboardRead: false,
    }
    expect(autoAllowedTools(s)).toContain('mcp__vivi__screenshot')
    expect(autoAllowedTools(s)).not.toContain('mcp__vivi__clipboard_read')
    expect(autoAllowedTools(s)).not.toContain('Read')
    const state = {
      sessionGrants: new Set<'read' | 'edit' | 'exec' | 'input' | 'system' | 'unknown'>(),
      turnGrants: new Set<'read' | 'edit' | 'exec' | 'input' | 'system' | 'unknown'>(),
    }
    const policy = makePolicy(() => s, state)
    expect(policy('mcp__vivi__screenshot', {}).verdict).toBe('allow')
    expect(policy('mcp__vivi__clipboard_read', {}).verdict).toBe('ask')
    expect(policy('Read', {}).verdict).toBe('ask')
  })

  it('asks for exec, allows after session grant, always asks for dangerous', () => {
    const s = defaultSettings().permissions
    const state = {
      sessionGrants: new Set<'read' | 'edit' | 'exec' | 'input' | 'system' | 'unknown'>(),
      turnGrants: new Set<'read' | 'edit' | 'exec' | 'input' | 'system' | 'unknown'>(),
    }
    const policy = makePolicy(() => s, state)
    expect(policy('Bash', { command: 'ls' }).verdict).toBe('ask')
    state.sessionGrants.add('exec')
    expect(policy('Bash', { command: 'ls' }).verdict).toBe('allow')
    const danger = policy('Bash', { command: 'rm -rf /' })
    expect(danger.verdict).toBe('ask')
    expect(danger.dangerous).toBe(true)
    expect(danger.canAlwaysAllow).toBe(false)
    expect(policy('mcp__vivi__mouse', {}).verdict).toBe('ask')
    state.sessionGrants.add('input')
    expect(policy('mcp__vivi__mouse', {}).verdict).toBe('allow')
  })

  it('tags the reason for each verdict path, and leaves it unset for a plain ask', () => {
    const s = defaultSettings().permissions
    expect(makePolicy(() => s, freshState())('Read', {}).reason).toBe('auto-category')
    expect(makePolicy(() => s, freshState())('Bash', { command: 'ls' }).reason).toBeUndefined()

    const turnState = freshState()
    turnState.turnGrants.add('input')
    expect(makePolicy(() => s, turnState)('mcp__vivi__mouse', {}).reason).toBe('turn-grant')

    const sessionState = freshState()
    sessionState.sessionGrants.add('input')
    expect(makePolicy(() => s, sessionState)('mcp__vivi__mouse', {}).reason).toBe('session-grant')

    const sessionExecState = freshState()
    sessionExecState.sessionGrants.add('exec')
    expect(makePolicy(() => s, sessionExecState)('Bash', { command: 'ls' }).reason).toBe(
      'session-grant',
    )
  })
})

describe('matchesRule (SEC-03)', () => {
  it('matches a bare rule unconditionally for the same tool', () => {
    expect(matchesRule('Bash', { command: 'ls' }, { toolName: 'Bash' })).toBe(true)
    expect(matchesRule('Write', {}, { toolName: 'Bash' })).toBe(false)
  })
  it('matches a command-prefix rule against the first word', () => {
    const rule = { toolName: 'Bash', ruleContent: 'git:*' }
    expect(matchesRule('Bash', { command: 'git status' }, rule)).toBe(true)
    expect(matchesRule('Bash', { command: 'gitless' }, rule)).toBe(false)
  })
  it('matches a domain rule against the URL hostname', () => {
    const rule = { toolName: 'WebFetch', ruleContent: 'domain:example.com' }
    expect(matchesRule('WebFetch', { url: 'https://example.com/x' }, rule)).toBe(true)
    expect(matchesRule('WebFetch', { url: 'https://evil.com/x' }, rule)).toBe(false)
    expect(matchesRule('WebFetch', { url: 'not a url' }, rule)).toBe(false)
  })
  it('matches a path-glob rule against file_path, falling back through notebook_path/path', () => {
    const rule = { toolName: 'Write', ruleContent: 'path:/home/u/Vivi/**' }
    expect(matchesRule('Write', { file_path: '/home/u/Vivi/notes.md' }, rule)).toBe(true)
    expect(matchesRule('Write', { file_path: '/home/u/Other/notes.md' }, rule)).toBe(false)
    expect(matchesRule('Write', {}, rule)).toBe(false)
    const notebookRule = { toolName: 'NotebookEdit', ruleContent: 'path:/home/u/nb/**' }
    expect(matchesRule('NotebookEdit', { notebook_path: '/home/u/nb/x.ipynb' }, notebookRule)).toBe(
      true,
    )
  })
  it('expands a leading ~ against the real home directory', () => {
    const rule = { toolName: 'Write', ruleContent: 'path:~/Vivi/**' }
    const path = join(homedir(), 'Vivi', 'notes.md')
    expect(matchesRule('Write', { file_path: path }, rule)).toBe(true)
  })
})

describe('isUnderTrustedFolder (SEC-03)', () => {
  it('matches the folder itself and anything nested under it', () => {
    expect(isUnderTrustedFolder('/home/u/proj', ['/home/u/proj'])).toBe(true)
    expect(isUnderTrustedFolder('/home/u/proj/sub/file.ts', ['/home/u/proj'])).toBe(true)
  })
  it('does not match a sibling folder with a shared prefix', () => {
    expect(isUnderTrustedFolder('/home/u/projX', ['/home/u/proj'])).toBe(false)
  })
  it('does not match when nothing is trusted', () => {
    expect(isUnderTrustedFolder('/home/u/proj/file.ts', [])).toBe(false)
  })
})

describe('makePolicy — deny rules (SEC-03)', () => {
  it('a deny rule blocks even a normally-auto-allowed category', () => {
    const s = { ...defaultSettings().permissions, askForExec: false }
    s.alwaysAllowRules = [{ toolName: 'Bash', behavior: 'deny' }]
    const policy = makePolicy(() => s, freshState())
    const result = policy('Bash', { command: 'ls' })
    expect(result.verdict).toBe('deny')
    expect(result.canAlwaysAllow).toBe(false)
    expect(result.reason).toBe('deny-rule')
    expect(result.denyMessage).toMatch(/deny.*rule/i)
  })

  it('a deny rule wins even over a dangerous command (deny is safer than ask)', () => {
    const s = defaultSettings().permissions
    s.alwaysAllowRules = [{ toolName: 'Bash', behavior: 'deny' }]
    const policy = makePolicy(() => s, freshState())
    const result = policy('Bash', { command: 'rm -rf /' })
    expect(result.verdict).toBe('deny')
    expect(result.reason).toBe('deny-rule')
  })

  it('a scoped deny (path) only blocks matching calls, not the whole tool', () => {
    const s = { ...defaultSettings().permissions, askForEdits: true }
    s.alwaysAllowRules = [{ toolName: 'Write', ruleContent: 'path:/secret/**', behavior: 'deny' }]
    const policy = makePolicy(() => s, freshState())
    expect(policy('Write', { file_path: '/secret/x.txt' }).verdict).toBe('deny')
    expect(policy('Write', { file_path: '/home/u/x.txt' }).verdict).toBe('ask')
  })

  it('an allow rule never overrides a deny rule for the same tool', () => {
    const s = defaultSettings().permissions
    s.alwaysAllowRules = [
      { toolName: 'Bash', behavior: 'allow' },
      { toolName: 'Bash', behavior: 'deny' },
    ]
    const policy = makePolicy(() => s, freshState())
    expect(policy('Bash', { command: 'ls' }).verdict).toBe('deny')
  })
})

describe('makePolicy — path-scoped allow rules (SEC-03)', () => {
  it('allows edits under the ruled path even while askForEdits is on', () => {
    const s = { ...defaultSettings().permissions, askForEdits: true }
    s.alwaysAllowRules = [
      { toolName: 'Write', ruleContent: 'path:/home/u/Vivi/**', behavior: 'allow' },
    ]
    const policy = makePolicy(() => s, freshState())
    const allowed = policy('Write', { file_path: '/home/u/Vivi/notes.md' })
    expect(allowed.verdict).toBe('allow')
    expect(allowed.reason).toBe('allow-rule')
    expect(policy('Write', { file_path: '/home/u/Other/notes.md' }).verdict).toBe('ask')
  })
})

describe('makePolicy — trusted folders (SEC-03)', () => {
  it('auto-allows edits under a trusted folder without needing a rule', () => {
    const s = {
      ...defaultSettings().permissions,
      askForEdits: true,
      trustedFolders: ['/home/u/Vivi'],
    }
    const policy = makePolicy(() => s, freshState())
    const allowed = policy('Edit', { file_path: '/home/u/Vivi/notes.md' })
    expect(allowed.verdict).toBe('allow')
    expect(allowed.reason).toBe('trusted-folder')
    expect(policy('Edit', { file_path: '/home/u/Other/notes.md' }).verdict).toBe('ask')
  })

  it('does not extend trust to a non-edit category', () => {
    // Read is already auto-allowed by default, so disable that to isolate the trusted-folder effect.
    const s = {
      ...defaultSettings().permissions,
      trustedFolders: ['/home/u/Vivi'],
      autoAllowReadOnly: false,
    }
    const policy = makePolicy(() => s, freshState())
    expect(policy('Read', { file_path: '/home/u/Vivi/notes.md' }).verdict).toBe('ask')
  })
})
