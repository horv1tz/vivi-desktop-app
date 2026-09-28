import { describe, expect, it } from 'vitest'
import {
  formatRuleContent,
  globToRegExp,
  parseRuleContent,
} from '../../../src/shared/permissionRules'

describe('parseRuleContent', () => {
  it('parses a bare rule (no content)', () => {
    expect(parseRuleContent(undefined)).toEqual({ kind: 'bare' })
  })
  it('parses a command prefix rule', () => {
    expect(parseRuleContent('git:*')).toEqual({ kind: 'prefix', prefix: 'git' })
  })
  it('parses a domain rule', () => {
    expect(parseRuleContent('domain:example.com')).toEqual({
      kind: 'domain',
      domain: 'example.com',
    })
  })
  it('parses a path rule', () => {
    expect(parseRuleContent('path:~/Vivi/**')).toEqual({ kind: 'path', glob: '~/Vivi/**' })
  })
  it('falls back to bare for content matching none of the known forms', () => {
    expect(parseRuleContent('garbage')).toEqual({ kind: 'bare' })
  })
})

describe('formatRuleContent', () => {
  it('round-trips every scope kind through parseRuleContent', () => {
    for (const content of ['git:*', 'domain:example.com', 'path:~/Vivi/**']) {
      expect(formatRuleContent(parseRuleContent(content))).toBe(content)
    }
  })
  it('formats bare as undefined', () => {
    expect(formatRuleContent({ kind: 'bare' })).toBeUndefined()
  })
})

describe('globToRegExp', () => {
  it('matches a literal path exactly', () => {
    expect(globToRegExp('/home/u/file.md').test('/home/u/file.md')).toBe(true)
    expect(globToRegExp('/home/u/file.md').test('/home/u/other.md')).toBe(false)
  })
  it('** matches any depth, including across slashes', () => {
    const re = globToRegExp('/home/u/Vivi/**')
    expect(re.test('/home/u/Vivi/notes.md')).toBe(true)
    expect(re.test('/home/u/Vivi/sub/dir/notes.md')).toBe(true)
    expect(re.test('/home/u/Other/notes.md')).toBe(false)
  })
  it('single * does not cross a slash', () => {
    const re = globToRegExp('/home/u/Vivi/*.md')
    expect(re.test('/home/u/Vivi/notes.md')).toBe(true)
    expect(re.test('/home/u/Vivi/sub/notes.md')).toBe(false)
  })
  it('? matches exactly one non-slash character', () => {
    const re = globToRegExp('/home/u/a?.txt')
    expect(re.test('/home/u/a1.txt')).toBe(true)
    expect(re.test('/home/u/a12.txt')).toBe(false)
  })
  it('escapes regex-special characters in the literal parts', () => {
    const re = globToRegExp('/home/u/file(1).txt')
    expect(re.test('/home/u/file(1).txt')).toBe(true)
    expect(re.test('/home/u/fileX1X.txt')).toBe(false)
  })
})
