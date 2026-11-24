// The keyboard shortcuts: one table drives the key handler, the tooltips, the menus' hints and the
// shortcuts panel, so they can't drift apart. Keys are the ones established whiteboard tools share.
//
// A combo is "mod+shift+alt+key": `mod` is ⌘ on Apple platforms and Ctrl elsewhere; `key` is a
// lowercase letter, a digit, or a KeyboardEvent.key name (Enter, Escape, PageUp, ArrowUp, F1, ?…).

export const KEYMAP = [
  // tools
  { command: 'tool.select', keys: ['v'] },
  { command: 'tool.hand', keys: ['h'] },
  { command: 'tool.note', keys: ['n'] },
  { command: 'tool.text', keys: ['t'] },
  { command: 'tool.shapes', keys: ['s'] },
  { command: 'tool.rect', keys: ['r'] },
  { command: 'tool.ellipse', keys: ['o'] },
  { command: 'tool.connector', keys: ['l'] },
  { command: 'tool.pen', keys: ['p'] },
  { command: 'tool.eraser', keys: ['e'] },
  { command: 'tool.frame', keys: ['f'] },
  // edit
  { command: 'undo', keys: ['mod+z'] },
  { command: 'redo', keys: ['mod+shift+z', 'mod+y'] },
  // copy, cut and paste arrive as the browser's clipboard events: listed here, handled there
  { command: 'copy', keys: ['mod+c'], native: true },
  { command: 'cut', keys: ['mod+x'], native: true },
  { command: 'paste', keys: ['mod+v'], native: true },
  { command: 'duplicate', keys: ['mod+d'] },
  { command: 'select-all', keys: ['mod+a'] },
  { command: 'edit', keys: ['Enter'] },
  { command: 'escape', keys: ['Escape'] },
  { command: 'delete', keys: ['Backspace', 'Delete'] },
  { command: 'group', keys: ['mod+g'] },
  { command: 'ungroup', keys: ['mod+shift+g'] },
  { command: 'lock', keys: ['mod+shift+l'] },
  { command: 'add-reaction', keys: ['mod+shift+e'] },
  { command: 'front', keys: ['PageUp'] },
  { command: 'forward', keys: ['shift+PageUp', 'mod+]'] },
  { command: 'back', keys: ['PageDown'] },
  { command: 'backward', keys: ['shift+PageDown', 'mod+['] },
  { command: 'nudge-up', keys: ['ArrowUp'] },
  { command: 'nudge-down', keys: ['ArrowDown'] },
  { command: 'nudge-left', keys: ['ArrowLeft'] },
  { command: 'nudge-right', keys: ['ArrowRight'] },
  { command: 'nudge-up-far', keys: ['shift+ArrowUp'] },
  { command: 'nudge-down-far', keys: ['shift+ArrowDown'] },
  { command: 'nudge-left-far', keys: ['shift+ArrowLeft'] },
  { command: 'nudge-right-far', keys: ['shift+ArrowRight'] },
  { command: 'duplicate-up', keys: ['alt+ArrowUp'] },
  { command: 'duplicate-down', keys: ['alt+ArrowDown'] },
  { command: 'duplicate-left', keys: ['alt+ArrowLeft'] },
  { command: 'duplicate-right', keys: ['alt+ArrowRight'] },
  // view
  { command: 'zoom-in', keys: ['mod+=', 'mod++'] },
  { command: 'zoom-out', keys: ['mod+-'] },
  { command: 'zoom-reset', keys: ['mod+0'] },
  { command: 'zoom-fit', keys: ['shift+1', 'alt+1'] },
  { command: 'zoom-selection', keys: ['shift+2', 'alt+2'] },
  { command: 'toggle-grid', keys: ['g'] },
  { command: 'shortcuts', keys: ['?', 'F1'] },
]

/** The shortcuts panel: rows of commands (or plain gestures) per column. */
export const SHORTCUT_SECTIONS = [
  {
    title: 'Tools',
    rows: [
      { label: 'Select', commands: ['tool.select'] },
      { label: 'Hand (pan)', commands: ['tool.hand'] },
      { label: 'Sticky note', commands: ['tool.note'] },
      { label: 'Text', commands: ['tool.text'] },
      { label: 'Shapes · rectangle · oval', commands: ['tool.shapes', 'tool.rect', 'tool.ellipse'] },
      { label: 'Connection line', commands: ['tool.connector'] },
      { label: 'Pen · eraser', commands: ['tool.pen', 'tool.eraser'] },
      { label: 'Frame', commands: ['tool.frame'] },
      { label: 'Add reaction', commands: ['add-reaction'] },
    ],
  },
  {
    title: 'Edit',
    rows: [
      { label: 'Undo · redo', commands: ['undo', 'redo'] },
      { label: 'Copy · cut · paste', commands: ['copy', 'cut', 'paste'] },
      { label: 'Duplicate', commands: ['duplicate'], extra: ['alt+drag'] },
      { label: 'Duplicate next to', commands: [], extra: ['alt+arrows'] },
      { label: 'Select all', commands: ['select-all'] },
      { label: 'Edit text · stop editing', commands: ['edit', 'escape'] },
      { label: 'Delete', commands: ['delete'] },
      { label: 'Group · ungroup', commands: ['group', 'ungroup'] },
      { label: 'Lock · unlock', commands: ['lock'] },
    ],
  },
  {
    title: 'Arrange and view',
    rows: [
      { label: 'Bring to front · forward', commands: ['front', 'forward'] },
      { label: 'Send to back · backward', commands: ['back', 'backward'] },
      { label: 'Zoom in · out', commands: ['zoom-in', 'zoom-out'] },
      { label: 'Zoom to 100%', commands: ['zoom-reset'] },
      { label: 'Zoom to fit · to selection', commands: ['zoom-fit', 'zoom-selection'] },
      { label: 'Pan', commands: [], extra: ['Space+drag'] },
      { label: 'Move canvas or selection', commands: [], extra: ['Arrows'] },
      { label: 'Toggle grid', commands: ['toggle-grid'] },
      { label: 'This panel', commands: ['shortcuts'] },
    ],
  },
]

export const isApple = (platform = globalThis.navigator?.platform || '') => /Mac|iPhone|iPad|iPod/.test(platform)

const SYMBOLS = {
  apple: { mod: '⌘', shift: '⇧', alt: '⌥', join: '' },
  other: { mod: 'Ctrl', shift: 'Shift', alt: 'Alt', join: '+' },
}
const KEY_NAMES = {
  Backspace: '⌫',
  Delete: 'Del',
  Escape: 'Esc',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  '=': '+',
  '-': '−',
  drag: ' drag',
  arrows: ' + arrows',
}

function parse(combo) {
  const parts = combo.split('+')
  // "mod++" ends with an empty part: the key is "+"
  const key = parts[parts.length - 1] === '' ? '+' : parts[parts.length - 1]
  const mods = new Set(parts.slice(0, parts[parts.length - 1] === '' ? -2 : -1))
  return { key, mod: mods.has('mod'), shift: mods.has('shift'), alt: mods.has('alt') }
}

/** "mod+shift+z" → "⌘⇧Z" (Apple) or "Ctrl+Shift+Z". */
export function formatCombo(combo, apple = isApple()) {
  const s = apple ? SYMBOLS.apple : SYMBOLS.other
  const { key, mod, shift, alt } = parse(combo)
  if (key === 'drag' || key === 'arrows') return `${alt ? (apple ? s.alt : 'Alt') : ''}${KEY_NAMES[key]}`
  const name = KEY_NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key)
  const mods = [mod && s.mod, alt && s.alt, shift && s.shift].filter(Boolean)
  return [...mods, name].join(s.join)
}

/** The first key of a command, formatted (for tooltips and menus), or ''. */
export function shortcutFor(command, apple = isApple()) {
  const entry = KEYMAP.find((k) => k.command === command)
  return entry ? formatCombo(entry.keys[0], apple) : ''
}

/** All keys of a command, formatted and joined. */
export const allShortcutsFor = (command, apple = isApple()) =>
  (KEYMAP.find((k) => k.command === command)?.keys || []).map((c) => formatCombo(c, apple))

// keys typed with Shift on most layouts: Shift doesn't have to match
const SHIFTED = new Set(['?', '+'])

/** The keymap entry an event matches, or null. */
export function matchEvent(e, apple = isApple()) {
  const mod = apple ? e.metaKey : e.ctrlKey
  const other = apple ? e.ctrlKey : e.metaKey
  if (other) return null
  for (const entry of KEYMAP) {
    for (const combo of entry.keys) {
      const c = parse(combo)
      if (c.mod !== mod || c.alt !== e.altKey) continue
      if (!SHIFTED.has(c.key) && c.shift !== e.shiftKey) continue
      if (keyMatches(c.key, e)) return entry
    }
  }
  return null
}

function keyMatches(key, e) {
  if (/^[a-z]$/.test(key)) return e.key.toLowerCase() === key || e.code === `Key${key.toUpperCase()}`
  // Shift and ⌥ change what digits type: compare the physical key
  if (/^[0-9]$/.test(key)) return e.code === `Digit${key}` || e.code === `Numpad${key}` || e.key === key
  return e.key === key
}
