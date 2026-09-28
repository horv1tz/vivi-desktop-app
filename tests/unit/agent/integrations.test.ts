import { describe, expect, it, vi } from 'vitest'
import type { Integration } from '../../../src/shared/settings'

const secretStore = new Map<string, string>()
vi.mock('../../../src/main/auth/secrets', () => ({
  secrets: () => ({
    get: async (key: string) => secretStore.get(key) ?? null,
    set: async (key: string, value: string) => {
      if (value) secretStore.set(key, value)
      else secretStore.delete(key)
    },
    delete: (key: string) => secretStore.delete(key),
  }),
}))

const { integrationsToMcpServers } = await import('../../../src/main/agent/integrations')

function stdio(over: Partial<Integration> = {}): Integration {
  return {
    id: 'a',
    name: 'my-server',
    enabled: true,
    transport: 'stdio',
    command: 'npx',
    args: '',
    url: '',
    env: [],
    ...over,
  }
}

describe('integrationsToMcpServers (INT-01)', () => {
  it('returns an empty map for no integrations', async () => {
    expect(await integrationsToMcpServers([])).toEqual({})
  })

  it('maps an enabled stdio integration, splitting args with shell-like quoting', async () => {
    const out = await integrationsToMcpServers([
      stdio({ name: 'files', command: '/usr/bin/mcp-fs', args: '--root "/home/user/docs"' }),
    ])
    expect(out).toEqual({
      files: { type: 'stdio', command: '/usr/bin/mcp-fs', args: ['--root', '/home/user/docs'] },
    })
  })

  it('maps an enabled http integration by url', async () => {
    const out = await integrationsToMcpServers([
      stdio({ name: 'remote', transport: 'http', command: '', url: 'https://example.com/mcp' }),
    ])
    expect(out).toEqual({ remote: { type: 'http', url: 'https://example.com/mcp' } })
  })

  it('excludes a disabled integration', async () => {
    expect(await integrationsToMcpServers([stdio({ enabled: false })])).toEqual({})
  })

  it('excludes a stdio integration with no command, and an http one with no url', async () => {
    expect(await integrationsToMcpServers([stdio({ command: '' })])).toEqual({})
    expect(
      await integrationsToMcpServers([stdio({ transport: 'http', command: '', url: '' })]),
    ).toEqual({})
  })

  it('excludes an integration with a blank name', async () => {
    expect(await integrationsToMcpServers([stdio({ name: '  ' })])).toEqual({})
  })

  it('maps several integrations by their own names, keyed independently', async () => {
    const out = await integrationsToMcpServers([
      stdio({ id: 'a', name: 'one', command: 'cmd-a' }),
      stdio({ id: 'b', name: 'two', command: 'cmd-b' }),
    ])
    expect(Object.keys(out).sort()).toEqual(['one', 'two'])
  })

  describe('INT-01: env vars', () => {
    it('resolves declared env keys from the secret store, keyed by integration id', async () => {
      secretStore.set('integrationEnv:gh:GITHUB_PERSONAL_ACCESS_TOKEN', 'ghp_secret')
      const out = await integrationsToMcpServers([
        stdio({
          id: 'gh',
          name: 'github',
          command: 'npx',
          env: [{ key: 'GITHUB_PERSONAL_ACCESS_TOKEN', hasValue: true }],
        }),
      ])
      expect(out.github).toEqual({
        type: 'stdio',
        command: 'npx',
        args: [],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_secret' },
      })
    })

    it('omits the env field entirely when there are no declared keys', async () => {
      const out = await integrationsToMcpServers([stdio({ command: 'npx', env: [] })])
      expect(out['my-server']).not.toHaveProperty('env')
    })

    it('skips a declared key whose hasValue is false or whose secret is missing', async () => {
      const out = await integrationsToMcpServers([
        stdio({
          id: 'x',
          command: 'npx',
          env: [
            { key: 'UNSET_FLAG', hasValue: false },
            { key: 'MISSING_IN_STORE', hasValue: true },
          ],
        }),
      ])
      expect(out['my-server']).not.toHaveProperty('env')
    })

    it('never resolves env vars for an http integration', async () => {
      secretStore.set('integrationEnv:h:TOKEN', 'x')
      const out = await integrationsToMcpServers([
        stdio({
          id: 'h',
          transport: 'http',
          command: '',
          url: 'https://example.com/mcp',
          env: [{ key: 'TOKEN', hasValue: true }],
        }),
      ])
      expect(out['my-server']).toEqual({ type: 'http', url: 'https://example.com/mcp' })
    })
  })
})
