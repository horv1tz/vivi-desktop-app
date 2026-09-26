import { describe, expect, it } from 'vitest'
import { buildEnv, buildOptions, buildPermissionAllowRules } from '../../../src/main/agent/options'
import { defaultSettings } from '../../../src/shared/settings'

describe('buildEnv', () => {
  it('keeps PATH, isolates config dir and strips nested-session markers', () => {
    const env = buildEnv({
      baseEnv: { PATH: '/usr/bin', CLAUDE_SESSION_ID: 'parent', CLAUDECODE: '1', HOME: '/home/u' },
      extraEnv: { ANTHROPIC_API_KEY: 'sk-test', HTTPS_PROXY: '' },
      claudeConfigDir: '/data/claude',
      appVersion: '1.0.0',
    })
    expect(env.PATH).toBe('/usr/bin')
    expect(env.CLAUDE_CONFIG_DIR).toBe('/data/claude')
    expect(env.CLAUDE_SESSION_ID).toBeUndefined()
    expect(env.CLAUDECODE).toBeUndefined()
    expect(env.ANTHROPIC_API_KEY).toBe('sk-test')
    expect('HTTPS_PROXY' in env).toBe(false)
    expect(env.CLAUDE_AGENT_SDK_CLIENT_APP).toBe('vivi/1.0.0')
  })

  it('does not override config dir when isolateConfig is false', () => {
    const env = buildEnv({ baseEnv: {}, extraEnv: {}, claudeConfigDir: '/x', appVersion: '1', isolateConfig: false })
    expect(env.CLAUDE_CONFIG_DIR).toBeUndefined()
  })
})

describe('buildOptions', () => {
  it('produces SDK options with custom prompt, inline allow rules and isolation', () => {
    const settings = defaultSettings()
    settings.agent.model = 'claude-opus-5'
    settings.agent.effort = 'high'
    settings.agent.maxBudgetUsd = 2
    const opts = buildOptions({
      settings,
      cwd: '/work',
      homeDir: '/home/u',
      memoryFile: '/work/memory/VIVI.md',
      claudeConfigDir: '/data/claude',
      extraEnv: {},
      appVersion: '1.0.0',
      allowedTools: ['Read'],
      alwaysAllowRules: [{ toolName: 'Bash', ruleContent: 'git *' }, { toolName: 'Write' }],
      baseEnv: { PATH: '/bin' },
    })
    expect(opts.cwd).toBe('/work')
    expect(opts.settingSources).toEqual([])
    expect(opts.settings).toEqual({ permissions: { allow: ['Bash(git *)', 'Write'] } })
    expect(opts.model).toBe('claude-opus-5')
    expect(opts.effort).toBe('high')
    expect(opts.maxBudgetUsd).toBe(2)
    expect(opts.includePartialMessages).toBe(true)
    expect(opts.additionalDirectories).toContain('/home/u')
    const sp = opts.systemPrompt as { type: string; prompt: string[] }
    expect(sp.type).toBe('custom')
    expect(sp.prompt).toHaveLength(3)
    expect(sp.prompt[0]).toContain('Vivi')
    expect(sp.prompt[2]).toContain('/work')
  })

  it('formats permission rules', () => {
    expect(buildPermissionAllowRules([{ toolName: 'Bash', ruleContent: 'npm test' }])).toEqual(['Bash(npm test)'])
  })
})
