import { describe, expect, it } from 'vitest'
import { integrationsToMcpServers } from '../../../src/main/agent/integrations'
import type { Integration } from '../../../src/shared/settings'

function stdio(over: Partial<Integration> = {}): Integration {
  return {
    id: 'a',
    name: 'my-server',
    enabled: true,
    transport: 'stdio',
    command: 'npx',
    args: '',
    url: '',
    ...over,
  }
}

describe('integrationsToMcpServers (INT-01)', () => {
  it('returns an empty map for no integrations', () => {
    expect(integrationsToMcpServers([])).toEqual({})
  })

  it('maps an enabled stdio integration, splitting args with shell-like quoting', () => {
    const out = integrationsToMcpServers([
      stdio({ name: 'files', command: '/usr/bin/mcp-fs', args: '--root "/home/user/docs"' }),
    ])
    expect(out).toEqual({
      files: { type: 'stdio', command: '/usr/bin/mcp-fs', args: ['--root', '/home/user/docs'] },
    })
  })

  it('maps an enabled http integration by url', () => {
    const out = integrationsToMcpServers([
      stdio({ name: 'remote', transport: 'http', command: '', url: 'https://example.com/mcp' }),
    ])
    expect(out).toEqual({ remote: { type: 'http', url: 'https://example.com/mcp' } })
  })

  it('excludes a disabled integration', () => {
    expect(integrationsToMcpServers([stdio({ enabled: false })])).toEqual({})
  })

  it('excludes a stdio integration with no command, and an http one with no url', () => {
    expect(integrationsToMcpServers([stdio({ command: '' })])).toEqual({})
    expect(integrationsToMcpServers([stdio({ transport: 'http', command: '', url: '' })])).toEqual(
      {},
    )
  })

  it('excludes an integration with a blank name', () => {
    expect(integrationsToMcpServers([stdio({ name: '  ' })])).toEqual({})
  })

  it('maps several integrations by their own names, keyed independently', () => {
    const out = integrationsToMcpServers([
      stdio({ id: 'a', name: 'one', command: 'cmd-a' }),
      stdio({ id: 'b', name: 'two', command: 'cmd-b' }),
    ])
    expect(Object.keys(out).sort()).toEqual(['one', 'two'])
  })
})
