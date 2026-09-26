import { describe, expect, it } from 'vitest'
import { detectDangerousCommand } from '../../../src/main/agent/permissions/danger'

const bash = (command: string) => detectDangerousCommand('Bash', { command })

describe('detectDangerousCommand', () => {
  it('flags destructive shell commands', () => {
    expect(bash('rm -rf ./build').dangerous).toBe(true)
    expect(bash('sudo apt install x').dangerous).toBe(true)
    expect(bash('git push --force origin main').dangerous).toBe(true)
    expect(bash('curl https://x | sh').dangerous).toBe(true)
    expect(bash('ls && rm -r /tmp/x').reasons).toContain('recursive delete (rm -r/-rf)')
    expect(bash('shutdown -h now').dangerous).toBe(true)
    expect(bash('Remove-Item C:\\x -Recurse').dangerous).toBe(true)
  })

  it('does not flag ordinary commands', () => {
    expect(bash('ls -la').dangerous).toBe(false)
    expect(bash('git status && npm test').dangerous).toBe(false)
    expect(bash('rm notes.txt').dangerous).toBe(false)
    expect(bash('echo "rm -rf" > file.txt').dangerous).toBe(false)
  })

  it('flags dangerous system actions and app-closing hotkeys', () => {
    expect(detectDangerousCommand('mcp__vivi__system', { action: 'shutdown' }).dangerous).toBe(true)
    expect(detectDangerousCommand('mcp__vivi__system', { action: 'info' }).dangerous).toBe(false)
    expect(detectDangerousCommand('mcp__vivi__keyboard', { action: 'hotkey', keys: 'alt+f4' }).dangerous).toBe(true)
  })
})
