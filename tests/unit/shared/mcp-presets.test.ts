import { describe, expect, it } from 'vitest'
import { MCP_PRESETS } from '../../../src/shared/mcp-presets'
import { splitArgs } from '../../../src/main/agent/acp/args'

describe('MCP_PRESETS (INT-01)', () => {
  it('has unique ids and non-empty name/command/args/description', () => {
    const ids = MCP_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of MCP_PRESETS) {
      expect(p.id.length).toBeGreaterThan(0)
      expect(p.name.length).toBeGreaterThan(0)
      expect(p.command.length).toBeGreaterThan(0)
      expect(p.args.length).toBeGreaterThan(0)
      expect(p.description.length).toBeGreaterThan(0)
    }
  })

  it('every args string tokenizes cleanly (no unbalanced quotes)', () => {
    for (const p of MCP_PRESETS) {
      expect(() => splitArgs(p.args)).not.toThrow()
      expect(splitArgs(p.args).length).toBeGreaterThan(0)
    }
  })

  it('every declared env var has a non-empty key and label', () => {
    for (const p of MCP_PRESETS) {
      for (const v of p.envVars ?? []) {
        expect(v.key.length).toBeGreaterThan(0)
        expect(v.label.length).toBeGreaterThan(0)
        // env vars are conventionally SCREAMING_SNAKE_CASE — catches an accidental typo/placeholder.
        expect(v.key).toMatch(/^[A-Z][A-Z0-9_]*$/)
      }
    }
  })

  it('includes the verified GitHub, Slack, Brave Search and Sequential Thinking presets', () => {
    expect(MCP_PRESETS.find((p) => p.id === 'github')?.envVars?.map((v) => v.key)).toEqual([
      'GITHUB_PERSONAL_ACCESS_TOKEN',
    ])
    expect(MCP_PRESETS.find((p) => p.id === 'slack')?.envVars?.map((v) => v.key)).toEqual([
      'SLACK_MCP_XOXB_TOKEN',
    ])
    expect(MCP_PRESETS.find((p) => p.id === 'brave-search')?.envVars?.map((v) => v.key)).toEqual([
      'BRAVE_API_KEY',
    ])
    expect(MCP_PRESETS.find((p) => p.id === 'sequential-thinking')?.envVars).toBeUndefined()
  })
})
