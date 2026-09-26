import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { shell } from 'electron'
import { powershell, run } from './util'

export interface InstalledApp {
  name: string
  path?: string
  id?: string
}

export async function openTarget(target: string): Promise<string> {
  const t = target.trim()
  if (/^(https?|mailto|tel|file):/i.test(t)) {
    await shell.openExternal(t)
    return `opened URL ${t}`
  }
  if (/^[a-z0-9.+-]+:\/\//i.test(t)) {
    await shell.openExternal(t)
    return `opened ${t}`
  }
  const expanded = t.startsWith('~') ? join(homedir(), t.slice(1)) : t
  if (existsSync(expanded)) {
    const err = await shell.openPath(expanded)
    if (err) throw new Error(err)
    return `opened path ${expanded}`
  }
  return launchApp(t)
}

export async function launchApp(name: string): Promise<string> {
  if (process.platform === 'darwin') {
    const r = await run('open', ['-a', name])
    if (r.code !== 0) throw new Error(r.stderr.trim() || `could not open app "${name}"`)
    return `launched ${name}`
  }
  if (process.platform === 'win32') {
    const apps = await listInstalledApps().catch(() => [] as InstalledApp[])
    const match = apps.find((a) => a.name.toLowerCase() === name.toLowerCase()) ?? apps.find((a) => a.name.toLowerCase().includes(name.toLowerCase()))
    const r = match?.id
      ? await powershell('Start-Process "shell:AppsFolder\\$env:VIVI_APP_ID"', 20_000, { VIVI_APP_ID: match.id })
      : await powershell('Start-Process -FilePath $env:VIVI_APP_NAME', 20_000, { VIVI_APP_NAME: name })
    if (r.code !== 0) throw new Error(r.stderr.trim() || `could not start "${name}"`)
    return `launched ${match?.name ?? name}`
  }
  const apps = await listInstalledApps().catch(() => [] as InstalledApp[])
  const match = apps.find((a) => a.name.toLowerCase() === name.toLowerCase()) ?? apps.find((a) => a.name.toLowerCase().includes(name.toLowerCase()))
  if (match?.id) {
    const r = await run('gtk-launch', [match.id])
    if (r.code === 0) return `launched ${match.name}`
  }
  // No shell: `spawn` resolves `name` on PATH itself and never re-interprets shell metacharacters,
  // unlike the previous `sh -c` form (which let a name like "$(rm -rf ~)" execute as a command).
  const launched = await new Promise<boolean>((resolve) => {
    let settled = false
    const child = spawn(name, [], { detached: true, stdio: 'ignore' })
    child.once('error', () => {
      if (!settled) {
        settled = true
        resolve(false)
      }
    })
    child.once('spawn', () => {
      child.unref()
      if (!settled) {
        settled = true
        resolve(true)
      }
    })
  })
  if (launched) return `launched ${name}`
  throw new Error(`could not find application "${name}"`)
}

let appCache: { at: number; apps: InstalledApp[] } | null = null

export async function listInstalledApps(): Promise<InstalledApp[]> {
  if (appCache && Date.now() - appCache.at < 5 * 60_000) return appCache.apps
  let apps: InstalledApp[] = []
  if (process.platform === 'darwin') {
    const dirs = ['/Applications', '/System/Applications', '/System/Applications/Utilities', join(homedir(), 'Applications')]
    for (const dir of dirs) {
      if (!existsSync(dir)) continue
      for (const entry of readdirSync(dir)) if (entry.endsWith('.app')) apps.push({ name: entry.replace(/\.app$/, ''), path: join(dir, entry) })
    }
  } else if (process.platform === 'win32') {
    const r = await powershell('Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress', 30_000)
    if (r.code === 0 && r.stdout.trim()) {
      const parsed = JSON.parse(r.stdout) as { Name: string; AppID: string }[] | { Name: string; AppID: string }
      const list = Array.isArray(parsed) ? parsed : [parsed]
      apps = list.map((a) => ({ name: a.Name, id: a.AppID }))
    }
  } else {
    const dirs = ['/usr/share/applications', '/usr/local/share/applications', join(homedir(), '.local/share/applications'), '/var/lib/flatpak/exports/share/applications', '/var/lib/snapd/desktop/applications']
    for (const dir of dirs) {
      if (!existsSync(dir)) continue
      for (const entry of readdirSync(dir)) {
        if (!entry.endsWith('.desktop')) continue
        try {
          const body = readFileSync(join(dir, entry), 'utf8')
          if (/^NoDisplay=true/m.test(body)) continue
          const name = /^Name=(.+)$/m.exec(body)?.[1]?.trim()
          if (name) apps.push({ name, id: entry.replace(/\.desktop$/, ''), path: join(dir, entry) })
        } catch {
          /* unreadable */
        }
      }
    }
  }
  apps.sort((a, b) => a.name.localeCompare(b.name))
  appCache = { at: Date.now(), apps }
  return apps
}
