import { describe, expect, it, vi } from 'vitest'
import type { Options, Query, query } from '@anthropic-ai/claude-agent-sdk'
import type { RoutineEntry } from '../../../src/shared/events'
import { defaultSettings } from '../../../src/shared/settings'
import { runRoutineOnce, type RoutineRunnerDeps } from '../../../src/main/agent/routine-runner'
import {
  EDIT_TOOLS,
  EXEC_TOOLS,
  INPUT_TOOLS,
  READ_ONLY_TOOLS,
  SYSTEM_TOOLS,
} from '../../../src/main/agent/permissions/policy'

type QueryFn = typeof query

function makeRoutine(over: Partial<RoutineEntry> = {}): RoutineEntry {
  return {
    id: 'r1',
    name: 'Digest',
    prompt: 'summarize the day',
    schedule: { kind: 'interval', minutes: 60 },
    safeMode: true,
    enabled: true,
    nextRunAt: 1,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

function makeDeps(over: Partial<RoutineRunnerDeps> = {}): RoutineRunnerDeps {
  return {
    getSettings: () => defaultSettings(),
    getExtraEnv: async () => ({}),
    isolateConfig: () => true,
    cwd: () => '/work',
    homeDir: '/home/u',
    memoryFile: () => '/work/memory/VIVI.md',
    skillsFile: () => '/work/skills/skills.json',
    scenariosFile: () => '/work/scenarios/scenarios.json',
    routinesFile: () => '/work/routines/routines.json',
    claudeConfigDir: '/data/claude',
    appVersion: '1.0.0',
    mcpServer: () => ({ type: 'sdk', name: 'vivi' }) as never,
    ...over,
  }
}

/** Captures the Options a fake queryFn was invoked with, without actually running the SDK. */
function capturingQuery(
  onCall: (opts: Options) => void,
  result: { subtype: 'success' | 'error_max_turns'; result?: string; is_error?: boolean } = {
    subtype: 'success',
    result: 'ok',
    is_error: false,
  },
): QueryFn {
  return ((input: { prompt: string; options: Options }) => {
    onCall(input.options)
    return (async function* () {
      yield { type: 'result', ...result } as never
    })() as unknown as Query
  }) as QueryFn
}

describe('runRoutineOnce — tool restriction', () => {
  it('safeMode: restricts to read-only tools and disallows edit/exec/input/system', async () => {
    let captured: Options | undefined
    const routine = makeRoutine({ safeMode: true })
    await runRoutineOnce(routine, makeDeps({ queryFn: capturingQuery((o) => (captured = o)) }))
    expect(captured?.allowedTools).toEqual(READ_ONLY_TOOLS)
    for (const t of [...EDIT_TOOLS, ...EXEC_TOOLS, ...INPUT_TOOLS, ...SYSTEM_TOOLS])
      expect(captured?.disallowedTools).toContain(t)
  })

  it('non-safeMode: uses the settings-derived auto-allow list and no disallowedTools', async () => {
    let captured: Options | undefined
    const routine = makeRoutine({ safeMode: false })
    await runRoutineOnce(routine, makeDeps({ queryFn: capturingQuery((o) => (captured = o)) }))
    expect(captured?.disallowedTools).toBeUndefined()
    expect(captured?.allowedTools).not.toEqual(READ_ONLY_TOOLS)
  })

  it("caps maxTurns at 30 regardless of the user's own chat maxTurns setting", async () => {
    let captured: Options | undefined
    const settings = defaultSettings()
    settings.agent.maxTurns = 200
    await runRoutineOnce(
      makeRoutine(),
      makeDeps({ getSettings: () => settings, queryFn: capturingQuery((o) => (captured = o)) }),
    )
    expect(captured?.maxTurns).toBeLessThanOrEqual(30)
  })
})

describe('runRoutineOnce — canUseTool (unattended safety)', () => {
  it('denies AskUserQuestion unconditionally, even if askForInput/edits are relaxed', async () => {
    let captured: Options | undefined
    await runRoutineOnce(
      makeRoutine({ safeMode: false }),
      makeDeps({ queryFn: capturingQuery((o) => (captured = o)) }),
    )
    const decision = await captured!.canUseTool!('AskUserQuestion', {}, ctx())
    expect(decision!.behavior).toBe('deny')
  })

  it('denies a tool that would normally prompt for approval — nobody is there to answer', async () => {
    let captured: Options | undefined
    await runRoutineOnce(
      makeRoutine({ safeMode: false }),
      makeDeps({ queryFn: capturingQuery((o) => (captured = o)) }),
    )
    // Bash is 'exec'; default settings have askForExec: true and no matching rule -> 'ask' -> deny.
    const decision = await captured!.canUseTool!('Bash', { command: 'ls' }, ctx())
    expect(decision!.behavior).toBe('deny')
  })

  it('allows a tool already covered by an always-allow rule, reusing the live policy engine', async () => {
    let captured: Options | undefined
    const settings = defaultSettings()
    settings.permissions.alwaysAllowRules = [
      { toolName: 'Bash', ruleContent: 'ls:*', behavior: 'allow' },
    ]
    await runRoutineOnce(
      makeRoutine({ safeMode: false }),
      makeDeps({ getSettings: () => settings, queryFn: capturingQuery((o) => (captured = o)) }),
    )
    const decision = await captured!.canUseTool!('Bash', { command: 'ls -la' }, ctx())
    expect(decision!.behavior).toBe('allow')
  })
})

describe('runRoutineOnce — result handling', () => {
  it('returns the result text on success', async () => {
    const result = await runRoutineOnce(
      makeRoutine(),
      makeDeps({
        queryFn: capturingQuery(() => undefined, {
          subtype: 'success',
          result: 'all done',
          is_error: false,
        }),
      }),
    )
    expect(result.isError).toBe(false)
    expect(result.summary).toBe('all done')
  })

  it('reports isError when the run stops for a non-success reason', async () => {
    const result = await runRoutineOnce(
      makeRoutine(),
      makeDeps({
        queryFn: capturingQuery(() => undefined, { subtype: 'error_max_turns' }),
      }),
    )
    expect(result.isError).toBe(true)
    expect(result.summary).toContain('error_max_turns')
  })

  it('reports isError when the agent produces no result message at all', async () => {
    const queryFn = (() => (async function* () {})()) as unknown as QueryFn
    const result = await runRoutineOnce(makeRoutine(), makeDeps({ queryFn }))
    expect(result.isError).toBe(true)
    expect(result.summary).toMatch(/no result/)
  })

  it('reports isError when queryFn throws', async () => {
    const queryFn = (() => {
      throw new Error('spawn failed')
    }) as unknown as QueryFn
    const result = await runRoutineOnce(makeRoutine(), makeDeps({ queryFn }))
    expect(result.isError).toBe(true)
    expect(result.summary).toBe('spawn failed')
  })

  it('reports isError when building options fails (e.g. getExtraEnv rejects)', async () => {
    const result = await runRoutineOnce(
      makeRoutine(),
      makeDeps({
        getExtraEnv: async () => {
          throw new Error('env unavailable')
        },
        queryFn: vi.fn() as never,
      }),
    )
    expect(result.isError).toBe(true)
    expect(result.summary).toBe('env unavailable')
  })
})

function ctx(): Parameters<NonNullable<Options['canUseTool']>>[2] {
  return {
    signal: new AbortController().signal,
    toolUseID: 'tool-use-1',
    requestId: 'control-req-1',
  } as Parameters<NonNullable<Options['canUseTool']>>[2]
}
