import { describe, expect, it } from 'vitest'
import { autoAllowedTools, categorize, makePolicy } from '../../../src/main/agent/permissions/policy'
import { defaultSettings } from '../../../src/shared/settings'

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

  it('asks for exec, allows after session grant, always asks for dangerous', () => {
    const s = defaultSettings().permissions
    const state = { sessionGrants: new Set<'read' | 'edit' | 'exec' | 'input' | 'system' | 'unknown'>() }
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
})
