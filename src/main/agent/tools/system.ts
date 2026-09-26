import os from 'node:os'
import { app, powerMonitor, screen } from 'electron'
import { powershell, run } from './util'

export function systemInfo(): Record<string, unknown> {
  const mem = {
    totalGb: +(os.totalmem() / 1e9).toFixed(1),
    freeGb: +(os.freemem() / 1e9).toFixed(1),
  }
  const displays = screen
    .getAllDisplays()
    .map((d) => ({ id: d.id, bounds: d.bounds, scaleFactor: d.scaleFactor }))
  return {
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
    hostname: os.hostname(),
    user: safeUser(),
    home: os.homedir(),
    uptimeMinutes: Math.round(os.uptime() / 60),
    cpu: {
      model: os.cpus()[0]?.model,
      cores: os.cpus().length,
      loadAvg: os.loadavg().map((n) => +n.toFixed(2)),
    },
    memory: mem,
    displays,
    cursor: screen.getCursorScreenPoint(),
    onBattery: powerMonitor.isOnBatteryPower(),
    locale: app.getLocale(),
    appVersion: app.getVersion(),
    time: new Date().toString(),
  }
}

function safeUser(): string {
  try {
    return os.userInfo().username
  } catch {
    return 'unknown'
  }
}

export async function lockScreen(): Promise<string> {
  if (process.platform === 'darwin') {
    const r = await run('osascript', [
      '-e',
      'tell application "System Events" to keystroke "q" using {command down, control down}',
    ])
    if (r.code !== 0) {
      const r2 = await run('pmset', ['displaysleepnow'])
      if (r2.code !== 0) throw new Error(r.stderr || r2.stderr)
    }
    return 'screen locked'
  }
  if (process.platform === 'win32') {
    const r = await run('rundll32.exe', ['user32.dll,LockWorkStation'])
    if (r.code !== 0) throw new Error(r.stderr)
    return 'screen locked'
  }
  for (const [cmd, args] of [
    ['loginctl', ['lock-session']],
    ['xdg-screensaver', ['lock']],
    ['gnome-screensaver-command', ['-l']],
  ] as const) {
    const r = await run(cmd, [...args])
    if (r.code === 0) return 'screen locked'
  }
  throw new Error('no screen locker found (loginctl/xdg-screensaver)')
}

export async function sleepSystem(): Promise<string> {
  if (process.platform === 'darwin') {
    const r = await run('pmset', ['sleepnow'])
    if (r.code !== 0) throw new Error(r.stderr)
  } else if (process.platform === 'win32') {
    const r = await run('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0'])
    if (r.code !== 0) throw new Error(r.stderr)
  } else {
    const r = await run('systemctl', ['suspend'])
    if (r.code !== 0) throw new Error(r.stderr)
  }
  return 'sleeping'
}

export async function shutdownSystem(restart: boolean): Promise<string> {
  if (process.platform === 'darwin') {
    const r = await run('osascript', [
      '-e',
      `tell application "System Events" to ${restart ? 'restart' : 'shut down'}`,
    ])
    if (r.code !== 0) throw new Error(r.stderr)
  } else if (process.platform === 'win32') {
    const r = await run('shutdown.exe', [restart ? '/r' : '/s', '/t', '5'])
    if (r.code !== 0) throw new Error(r.stderr)
  } else {
    const r = await run('systemctl', [restart ? 'reboot' : 'poweroff'])
    if (r.code !== 0) throw new Error(r.stderr)
  }
  return restart ? 'restarting' : 'shutting down'
}

/** value: 0-100 to set, or 'mute' | 'unmute' | 'up' | 'down'. */
export async function setVolume(
  value: number | 'mute' | 'unmute' | 'up' | 'down',
): Promise<string> {
  if (process.platform === 'darwin') {
    const script =
      value === 'mute'
        ? 'set volume output muted true'
        : value === 'unmute'
          ? 'set volume output muted false'
          : value === 'up'
            ? 'set volume output volume ((output volume of (get volume settings)) + 10)'
            : value === 'down'
              ? 'set volume output volume ((output volume of (get volume settings)) - 10)'
              : `set volume output volume ${Math.max(0, Math.min(100, value))}`
    const r = await run('osascript', ['-e', script])
    if (r.code !== 0) throw new Error(r.stderr)
    return `volume: ${value}`
  }
  if (process.platform === 'win32') {
    const key =
      value === 'mute' || value === 'unmute'
        ? 173
        : value === 'up'
          ? 175
          : value === 'down'
            ? 174
            : null
    if (key !== null) {
      const r = await powershell(`(New-Object -ComObject WScript.Shell).SendKeys([char]${key})`)
      if (r.code !== 0) throw new Error(r.stderr)
      return `volume: ${value}`
    }
    // Absolute level: step down to 0 then up in 2% increments (50 steps) — no extra dependencies.
    const steps = Math.round(Math.max(0, Math.min(100, Number(value))) / 2)
    const r = await powershell(
      `$w=New-Object -ComObject WScript.Shell; 1..50 | % { $w.SendKeys([char]174) }; 1..${steps} | % { $w.SendKeys([char]175) }`,
      30_000,
    )
    if (r.code !== 0) throw new Error(r.stderr)
    return `volume: ~${steps * 2}%`
  }
  const arg =
    value === 'mute'
      ? ['set-sink-mute', '@DEFAULT_SINK@', '1']
      : value === 'unmute'
        ? ['set-sink-mute', '@DEFAULT_SINK@', '0']
        : value === 'up'
          ? ['set-sink-volume', '@DEFAULT_SINK@', '+10%']
          : value === 'down'
            ? ['set-sink-volume', '@DEFAULT_SINK@', '-10%']
            : ['set-sink-volume', '@DEFAULT_SINK@', `${Math.max(0, Math.min(100, value))}%`]
  const r = await run('pactl', arg)
  if (r.code !== 0) {
    const a = await run('amixer', [
      'set',
      'Master',
      value === 'mute'
        ? 'mute'
        : value === 'unmute'
          ? 'unmute'
          : value === 'up'
            ? '10%+'
            : value === 'down'
              ? '10%-'
              : `${value}%`,
    ])
    if (a.code !== 0) throw new Error(r.stderr || a.stderr)
  }
  return `volume: ${value}`
}
