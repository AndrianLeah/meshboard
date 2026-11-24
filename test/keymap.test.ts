// The shortcut table: no clashes, sane formatting, events match the right command.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { KEYMAP, SHORTCUT_SECTIONS, formatCombo, matchEvent } from '../src/commands/keymap.ts'
import type { KeyInput } from '../src/commands/keymap.ts'

const key = (k: string, extra: Partial<KeyInput> = {}): KeyInput => ({
  key: k,
  code: '',
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...extra,
})

test('no key combination is bound twice', () => {
  const seen = new Map()
  for (const { command, keys } of KEYMAP) {
    for (const combo of keys) {
      assert.ok(!seen.has(combo), `${combo} is bound to ${seen.get(combo)} and ${command}`)
      seen.set(combo, command)
    }
  }
})

test('the shortcuts panel only lists commands that have keys', () => {
  const bound = new Set(KEYMAP.map((k) => k.command))
  for (const section of SHORTCUT_SECTIONS) {
    for (const row of section.rows) for (const c of row.commands) assert.ok(bound.has(c), `${c} has no key`)
  }
})

test('formatting follows the platform', () => {
  assert.equal(formatCombo('mod+shift+z', true), '⌘⇧Z')
  assert.equal(formatCombo('mod+shift+z', false), 'Ctrl+Shift+Z')
  assert.equal(formatCombo('mod+=', true), '⌘+')
  assert.equal(formatCombo('mod+-', false), 'Ctrl+−')
  assert.equal(formatCombo('shift+PageUp', true), '⇧PgUp')
  assert.equal(formatCombo('alt+drag', true), '⌥ drag')
})

test('events match commands', () => {
  const cmd = (e: KeyInput, apple = true) => matchEvent(e, apple)?.command
  assert.equal(cmd(key('z', { metaKey: true })), 'undo')
  assert.equal(cmd(key('Z', { metaKey: true, shiftKey: true })), 'redo')
  assert.equal(cmd(key('z', { ctrlKey: true }), false), 'undo')
  assert.equal(cmd(key('z', { ctrlKey: true }), true), undefined, 'Ctrl isn’t ⌘ on a Mac')
  assert.equal(cmd(key('!', { code: 'Digit1', shiftKey: true })), 'zoom-fit')
  assert.equal(cmd(key('¡', { code: 'Digit1', altKey: true })), 'zoom-fit', '⌥1 types ¡ on a Mac')
  assert.equal(cmd(key('?', { shiftKey: true })), 'shortcuts')
  assert.equal(cmd(key('+', { metaKey: true, shiftKey: true })), 'zoom-in')
  assert.equal(cmd(key('ArrowUp', { altKey: true })), 'duplicate-up')
  assert.equal(cmd(key('l')), 'tool.connector')
  assert.equal(cmd(key('a')), undefined, 'A is free: connectors moved to L')
})
