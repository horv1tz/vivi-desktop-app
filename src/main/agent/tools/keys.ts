/** Normalizes human key names ("ctrl", "cmd", "enter", "pgdn") to canonical names used by the drivers. */
const ALIASES: Record<string, string> = {
  ctrl: 'control', ctl: 'control', control: 'control',
  cmd: 'command', command: 'command', super: 'command', win: 'command', meta: 'command',
  alt: 'alt', option: 'alt', opt: 'alt',
  shift: 'shift',
  enter: 'enter', return: 'enter',
  esc: 'escape', escape: 'escape',
  tab: 'tab', space: 'space', backspace: 'backspace', bksp: 'backspace', del: 'delete', delete: 'delete', ins: 'insert', insert: 'insert',
  up: 'up', down: 'down', left: 'left', right: 'right',
  home: 'home', end: 'end', pgup: 'pageup', pageup: 'pageup', pgdn: 'pagedown', pagedown: 'pagedown',
  printscreen: 'printscreen', capslock: 'capslock', numlock: 'numlock',
  '+': 'plus', '-': 'minus', '=': 'equals', ',': 'comma', '.': 'period', '/': 'slash', '\\': 'backslash', ';': 'semicolon', "'": 'quote', '`': 'grave', '[': 'bracketleft', ']': 'bracketright',
}

export const MODIFIERS = new Set(['control', 'command', 'alt', 'shift'])

export interface KeyCombo {
  modifiers: string[]
  key: string
}

export function normalizeKey(k: string): string {
  const lower = k.trim().toLowerCase()
  if (ALIASES[lower]) return ALIASES[lower]!
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) return lower
  if (lower.length === 1) return lower
  return lower
}

export function parseCombo(keys: string[]): KeyCombo {
  const norm = keys.map(normalizeKey)
  const modifiers = norm.filter((k) => MODIFIERS.has(k))
  const rest = norm.filter((k) => !MODIFIERS.has(k))
  return { modifiers, key: rest[rest.length - 1] ?? modifiers.pop() ?? 'enter' }
}

/** Platform-specific primary modifier (cmd on macOS, ctrl elsewhere). */
export function primaryModifier(): string {
  return process.platform === 'darwin' ? 'command' : 'control'
}
