/**
 * Heuristic detection of destructive shell commands and inputs. Anything flagged here always asks
 * the user (red dialog, no "always allow") regardless of permission settings.
 */
const PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|-r|-rf|--recursive)\b/i, reason: 'recursive delete (rm -r/-rf)' },
  { re: /\brm\s+-[a-z]*f\b/i, reason: 'forced delete (rm -f)' },
  { re: /\bsudo\b|\bdoas\b|\brunas\b/i, reason: 'elevated privileges' },
  { re: /\bmkfs(\.\w+)?\b|\bdiskpart\b|\bformat(\.com)?\s+[a-z]:/i, reason: 'disk formatting' },
  { re: /\bdd\s+if=/i, reason: 'raw disk write (dd)' },
  { re: />\s*\/dev\/(sd|nvme|disk|hd)/i, reason: 'writing to a block device' },
  { re: /\b(shutdown|reboot|poweroff|halt)\b|Stop-Computer|Restart-Computer/i, reason: 'shutdown / reboot' },
  { re: /\breg(\.exe)?\s+delete\b/i, reason: 'registry deletion' },
  { re: /Remove-Item\b[^|;]*-Recurse/i, reason: 'recursive delete (Remove-Item -Recurse)' },
  { re: /\bgit\s+push\b[^|;]*(--force|-f)\b/i, reason: 'git force push' },
  { re: /\bgit\s+reset\s+--hard\b/i, reason: 'git reset --hard' },
  { re: /\bgit\s+clean\b[^|;]*-[a-z]*f/i, reason: 'git clean -f' },
  { re: /\bchmod\s+(-R\s+)?[0-7]*777\b/i, reason: 'world-writable permissions' },
  { re: /\bchown\s+-R\b/i, reason: 'recursive ownership change' },
  { re: /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/i, reason: 'piping a download into a shell' },
  { re: /\bkill\s+-9\b|\bkillall\b|\bpkill\b|taskkill\s+\/f/i, reason: 'force-killing processes' },
  { re: /:\(\)\s*\{\s*:\|\s*:\s*&\s*\}\s*;\s*:/, reason: 'fork bomb' },
  { re: /\bcrontab\s+-r\b/i, reason: 'removing all cron jobs' },
  { re: /\b(del|erase)\s+\/[sq]/i, reason: 'recursive delete (del /s)' },
  { re: /\brd\s+\/s\b|\brmdir\s+\/s\b/i, reason: 'recursive directory removal' },
  { re: /\bDROP\s+(TABLE|DATABASE)\b|\bTRUNCATE\s+TABLE\b/i, reason: 'destructive SQL' },
  { re: /~\/?\s*$|\/\s*$/, reason: 'targets the home or root directory' },
]

const SYSTEM_DANGEROUS_ACTIONS = new Set(['shutdown', 'restart', 'sleep', 'lock'])

function stripQuoted(cmd: string): string {
  // Quoted strings are data (echo "rm -rf" > notes), not commands.
  return cmd.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''")
}

function splitSegments(cmd: string): string[] {
  return cmd
    .split(/\s*(?:&&|\|\||;|\|)\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function detectDangerousCommand(toolName: string, input: Record<string, unknown>): { dangerous: boolean; reasons: string[] } {
  const reasons = new Set<string>()
  if (toolName === 'Bash' || toolName === 'PowerShell') {
    const command = stripQuoted(String(input.command ?? ''))
    for (const seg of splitSegments(command)) {
      for (const p of PATTERNS) {
        // The trailing-slash heuristic only matters for delete commands.
        if (p.reason.startsWith('targets') && !/\b(rm|del|erase|rd|rmdir|Remove-Item)\b/i.test(seg)) continue
        if (p.re.test(seg)) reasons.add(p.reason)
      }
    }
    // Pipe-spanning patterns (download | shell) need the whole command line.
    for (const p of PATTERNS) if (p.reason.startsWith('piping') && p.re.test(command)) reasons.add(p.reason)
  }
  if (toolName === 'mcp__vivi__system') {
    const action = String(input.action ?? '')
    if (SYSTEM_DANGEROUS_ACTIONS.has(action)) reasons.add(`system action: ${action}`)
  }
  if (toolName === 'mcp__vivi__keyboard') {
    const keys = String(input.keys ?? '').toLowerCase()
    if (/alt\+f4|cmd\+q|command\+q|ctrl\+alt\+del/.test(keys)) reasons.add(`closes applications (${keys})`)
  }
  return { dangerous: reasons.size > 0, reasons: [...reasons] }
}
