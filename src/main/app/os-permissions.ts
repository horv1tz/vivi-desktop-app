import { shell, systemPreferences } from 'electron'
import type { OsPermissionStatus } from '@shared/events'
import { run } from '../agent/tools/util'

type MediaStatus = ReturnType<typeof systemPreferences.getMediaAccessStatus>

function mapMedia(status: MediaStatus): OsPermissionStatus['microphone'] {
  switch (status) {
    case 'granted':
      return 'granted'
    case 'denied':
      return 'denied'
    case 'not-determined':
      return 'not-determined'
    case 'restricted':
      return 'restricted'
    default:
      return 'unknown'
  }
}

/**
 * CU-06: macOS has no direct API to read Automation (Apple Events) TCC status the way it does for
 * accessibility (`isTrustedAccessibilityClient`), so this probes it with a harmless AppleScript
 * call to System Events. The very first call also doubles as the request: if the user has never
 * been asked, macOS itself pops its own "Vivi wants to control System Events" prompt at this point.
 */
async function checkAutomationPermission(): Promise<OsPermissionStatus['automation']> {
  const r = await run(
    'osascript',
    ['-e', 'tell application "System Events" to return name of first process'],
    { timeoutMs: 10_000 },
  )
  if (r.code === 0) return 'granted'
  // errAEEventNotPermitted (-1743) is macOS's specific "not authorized" error; anything else
  // (System Events not running, a timeout, osascript missing) is inconclusive, not a denial.
  if (/-1743|not allowed assistive access|not authorized/i.test(r.stderr)) return 'denied'
  return 'unknown'
}

export async function getOsPermissions(): Promise<OsPermissionStatus> {
  if (process.platform === 'darwin') {
    return {
      microphone: mapMedia(systemPreferences.getMediaAccessStatus('microphone')),
      screen: mapMedia(systemPreferences.getMediaAccessStatus('screen')),
      accessibility: systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'denied',
      automation: await checkAutomationPermission(),
    }
  }
  if (process.platform === 'win32') {
    return {
      microphone: mapMedia(systemPreferences.getMediaAccessStatus('microphone')),
      screen: 'n/a',
      accessibility: 'n/a',
      automation: 'n/a',
    }
  }
  return { microphone: 'unknown', screen: 'unknown', accessibility: 'n/a', automation: 'n/a' }
}

export interface InputPermissionCheck {
  ok: boolean
  message?: string
}

/**
 * CU-06: called right before a mouse/keyboard/window-focus tool call actually reaches the input
 * driver, so a TCC denial on macOS surfaces as one clear, actionable tool error instead of
 * whatever the native driver happens to throw (robotjs's CGEvent calls silently no-op without
 * Accessibility rather than raising, which is worse: the agent would see a "click succeeded" that
 * never actually landed). Accessibility is checked synchronously (no subprocess) since it gates
 * every mouse/keyboard action; Automation is only checked for window focus/minimize, since that's
 * the only action that shells out to `osascript` under the native-cli fallback driver.
 */
export async function checkInputPermission(
  kind: 'pointer' | 'window',
): Promise<InputPermissionCheck> {
  if (process.platform !== 'darwin') return { ok: true }
  if (!systemPreferences.isTrustedAccessibilityClient(false)) {
    return {
      ok: false,
      message:
        'macOS Accessibility permission is required to control the mouse and keyboard. Open System Settings → Privacy & Security → Accessibility, enable Vivi, then try again.',
    }
  }
  if (kind === 'window' && (await checkAutomationPermission()) === 'denied') {
    return {
      ok: false,
      message:
        "macOS Automation permission is required to focus or minimize other apps' windows. Open System Settings → Privacy & Security → Automation, enable Vivi → System Events, then try again.",
    }
  }
  return { ok: true }
}

export async function requestOsPermission(
  kind: 'microphone' | 'screen' | 'accessibility' | 'automation',
): Promise<boolean> {
  if (process.platform === 'darwin') {
    if (kind === 'microphone') return systemPreferences.askForMediaAccess('microphone')
    if (kind === 'screen') {
      await shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
      )
      return systemPreferences.getMediaAccessStatus('screen') === 'granted'
    }
    if (kind === 'automation') {
      // Triggers the system prompt on first use (see checkAutomationPermission); if already denied,
      // send the user straight to the pane where they'd re-enable it.
      const status = await checkAutomationPermission()
      if (status !== 'granted')
        await shell.openExternal(
          'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
        )
      return status === 'granted'
    }
    return systemPreferences.isTrustedAccessibilityClient(true)
  }
  if (process.platform === 'win32' && kind === 'microphone') {
    await shell.openExternal('ms-settings:privacy-microphone')
    return systemPreferences.getMediaAccessStatus('microphone') === 'granted'
  }
  return true
}
