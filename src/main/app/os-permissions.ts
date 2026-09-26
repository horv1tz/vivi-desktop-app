import { shell, systemPreferences } from 'electron'
import type { OsPermissionStatus } from '@shared/events'

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

export function getOsPermissions(): OsPermissionStatus {
  if (process.platform === 'darwin') {
    return {
      microphone: mapMedia(systemPreferences.getMediaAccessStatus('microphone')),
      screen: mapMedia(systemPreferences.getMediaAccessStatus('screen')),
      accessibility: systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'denied',
    }
  }
  if (process.platform === 'win32') {
    return {
      microphone: mapMedia(systemPreferences.getMediaAccessStatus('microphone')),
      screen: 'n/a',
      accessibility: 'n/a',
    }
  }
  return { microphone: 'unknown', screen: 'unknown', accessibility: 'n/a' }
}

export async function requestOsPermission(kind: 'microphone' | 'screen' | 'accessibility'): Promise<boolean> {
  if (process.platform === 'darwin') {
    if (kind === 'microphone') return systemPreferences.askForMediaAccess('microphone')
    if (kind === 'screen') {
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
      return systemPreferences.getMediaAccessStatus('screen') === 'granted'
    }
    return systemPreferences.isTrustedAccessibilityClient(true)
  }
  if (process.platform === 'win32' && kind === 'microphone') {
    await shell.openExternal('ms-settings:privacy-microphone')
    return systemPreferences.getMediaAccessStatus('microphone') === 'granted'
  }
  return true
}
