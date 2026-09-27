import { afterEach, describe, expect, it } from 'vitest'
import {
  MODIFIERS,
  normalizeKey,
  parseCombo,
  primaryModifier,
} from '../../../src/main/agent/tools/keys'

describe('normalizeKey', () => {
  it('maps common aliases to their canonical name', () => {
    expect(normalizeKey('ctrl')).toBe('control')
    expect(normalizeKey('ctl')).toBe('control')
    expect(normalizeKey('cmd')).toBe('command')
    expect(normalizeKey('super')).toBe('command')
    expect(normalizeKey('win')).toBe('command')
    expect(normalizeKey('opt')).toBe('alt')
    expect(normalizeKey('esc')).toBe('escape')
    expect(normalizeKey('pgdn')).toBe('pagedown')
    expect(normalizeKey('pgup')).toBe('pageup')
    expect(normalizeKey('del')).toBe('delete')
    expect(normalizeKey('bksp')).toBe('backspace')
  })

  it('is case-insensitive and trims surrounding whitespace', () => {
    expect(normalizeKey('CTRL')).toBe('control')
    expect(normalizeKey('  Cmd  ')).toBe('command')
  })

  it('passes through function keys F1-F24 unchanged', () => {
    expect(normalizeKey('f1')).toBe('f1')
    expect(normalizeKey('F13')).toBe('f13')
    expect(normalizeKey('f24')).toBe('f24')
  })

  it('does not treat f25 or higher as a function key (falls through as a plain lowercase name)', () => {
    expect(normalizeKey('f25')).toBe('f25')
  })

  it('passes through a single printable character unchanged', () => {
    expect(normalizeKey('a')).toBe('a')
    expect(normalizeKey('Z')).toBe('z')
  })

  it('maps punctuation aliases to their canonical names', () => {
    expect(normalizeKey('+')).toBe('plus')
    expect(normalizeKey('-')).toBe('minus')
    expect(normalizeKey('.')).toBe('period')
    expect(normalizeKey('/')).toBe('slash')
    expect(normalizeKey('[')).toBe('bracketleft')
  })

  it('passes through an unrecognized multi-character name unchanged (lowercased)', () => {
    expect(normalizeKey('SomeUnknownKey')).toBe('someunknownkey')
  })
})

describe('parseCombo', () => {
  it('splits modifiers from the trailing non-modifier key', () => {
    expect(parseCombo(['ctrl', 'shift', 't'])).toEqual({
      modifiers: ['control', 'shift'],
      key: 't',
    })
  })

  it('normalizes every key in the combo, not just the last one', () => {
    expect(parseCombo(['CMD', 'Q'])).toEqual({ modifiers: ['command'], key: 'q' })
  })

  it('uses the last non-modifier key when several are given (only one real "key" makes sense)', () => {
    expect(parseCombo(['ctrl', 'a', 'b'])).toEqual({ modifiers: ['control'], key: 'b' })
  })

  it('defaults to "enter" for an empty combo', () => {
    expect(parseCombo([])).toEqual({ modifiers: [], key: 'enter' })
  })

  it('treats a lone modifier as the key itself (tapping just that key), not a no-op', () => {
    expect(parseCombo(['ctrl'])).toEqual({ modifiers: [], key: 'control' })
  })

  it('treats several lone modifiers as: all but the last are held, the last is tapped', () => {
    expect(parseCombo(['ctrl', 'shift'])).toEqual({ modifiers: ['control'], key: 'shift' })
  })

  it('handles a plain single key with no modifiers', () => {
    expect(parseCombo(['enter'])).toEqual({ modifiers: [], key: 'enter' })
  })
})

describe('MODIFIERS', () => {
  it('contains exactly the four canonical modifier names', () => {
    expect(MODIFIERS).toEqual(new Set(['control', 'command', 'alt', 'shift']))
  })
})

describe('primaryModifier', () => {
  const REAL_PLATFORM = process.platform
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: REAL_PLATFORM, configurable: true })
  })

  it('is command on darwin', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    expect(primaryModifier()).toBe('command')
  })

  it('is control on other platforms', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    expect(primaryModifier()).toBe('control')
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    expect(primaryModifier()).toBe('control')
  })
})
