import type { RateLimitInfo } from '@shared/events'

/**
 * AG-06: a 'rejected' rate limit means the account is locked out until resetsAt (a Unix
 * timestamp in seconds) — this is the only status that should actually block sending, as opposed
 * to 'allowed_warning' (still works, just close to a limit).
 */
export function rateLimitResetsAtMs(info: RateLimitInfo | null | undefined): number | null {
  return info?.status === 'rejected' && info.resetsAt ? info.resetsAt * 1000 : null
}

export function isRateLimited(info: RateLimitInfo | null | undefined, now: number): boolean {
  const resetsAtMs = rateLimitResetsAtMs(info)
  return resetsAtMs !== null && now < resetsAtMs
}
