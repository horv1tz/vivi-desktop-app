/**
 * SEC-03: the "always allow"/"always deny" rule grammar, shared between the main-process policy
 * engine (which enforces it) and the renderer (which needs to parse/preview it while composing a
 * rule in Settings → Permissions) — one parser, so a rule reads the same way everywhere instead of
 * each side guessing at the other's syntax.
 */

export type RuleScope =
  | { kind: 'bare' }
  | { kind: 'prefix'; prefix: string }
  | { kind: 'domain'; domain: string }
  | { kind: 'path'; glob: string }

/** Parses a stored `ruleContent` string (the part in `Tool(...)`) into its structured form. */
export function parseRuleContent(ruleContent: string | undefined): RuleScope {
  if (!ruleContent) return { kind: 'bare' }
  const prefix = /^([\w./-]+):\*$/.exec(ruleContent)
  if (prefix) return { kind: 'prefix', prefix: prefix[1]! }
  const domain = /^domain:(.+)$/.exec(ruleContent)
  if (domain) return { kind: 'domain', domain: domain[1]! }
  const path = /^path:(.+)$/.exec(ruleContent)
  if (path) return { kind: 'path', glob: path[1]! }
  return { kind: 'bare' }
}

/** Inverse of `parseRuleContent` — builds the stored string from a structured scope. */
export function formatRuleContent(scope: RuleScope): string | undefined {
  switch (scope.kind) {
    case 'bare':
      return undefined
    case 'prefix':
      return `${scope.prefix}:*`
    case 'domain':
      return `domain:${scope.domain}`
    case 'path':
      return `path:${scope.glob}`
  }
}

/**
 * Compiles a glob into a RegExp — deliberately minimal (no external dependency): `**` matches any
 * run of characters including `/`, a single `*` matches any run of characters except `/`, `?`
 * matches exactly one character other than `/`, everything else is matched literally. Enough for
 * "under this folder" (`~/Vivi/**`) and "direct children only" (`~/Vivi/*.md`) without pulling in
 * a full glob library for two patterns.
 */
export function globToRegExp(glob: string): RegExp {
  let out = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        out += '.*'
        i++
      } else {
        out += '[^/]*'
      }
    } else if (c === '?') {
      out += '[^/]'
    } else {
      out += c!.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${out}$`)
}
