// Normalising items from files, peers and the clipboard.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { sanitizeItem, sanitizeReactions } from '../src/core/schema.ts'
import type { ItemData } from '../src/core/types.ts'

/** sanitizeItem, asserting the type it should come back as. */
function sanitized<T extends ItemData['type']>(
  raw: Record<string, unknown> & { type: T },
): Extract<ItemData, { type: T }> {
  const it = sanitizeItem(raw)
  assert.ok(it && it.type === raw.type, `a ${raw.type} comes back`)
  return it as Extract<ItemData, { type: T }>
}

test('defaults per type, and limits', () => {
  const text = sanitized({ type: 'text', x: 0, y: 0, fontSize: 999 })
  assert.equal(text.fontSize, 120)
  assert.equal(text.w, 280)
  const arrow = sanitized({ type: 'arrow', start: 'arrow', end: 'bogus', dash: 'yes' })
  assert.deepEqual([arrow.start, arrow.end, arrow.dash, arrow.from], ['arrow', 'arrow', false, ''])
  const frame = sanitized({ type: 'frame', text: 'x'.repeat(9000), locked: 'true', group: 42 })
  assert.equal(frame.text.length, 5000)
  assert.equal(frame.locked, false, 'only a real boolean locks')
  assert.equal(frame.group, '')
})

test('pen strokes keep an even list of points and their original box', () => {
  const p = sanitized({ type: 'path', x: 0, y: 0, w: 10, h: 10, points: [0, 0, 5, 5, 9], width: 99 })
  assert.deepEqual(p.points, [0, 0, 5, 5])
  assert.deepEqual([p.ow, p.oh, p.width], [10, 10, 24])
})

test('reactions: at most 40 different emoji, times kept', () => {
  const raw = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`e${i}`, { u: 100 + i }]))
  const r = sanitizeReactions(raw)
  assert.equal(Object.keys(r).length, 40)
  assert.equal(r.e0.u, 100)
  assert.deepEqual(sanitizeReactions({ '👍': { u: 'soon' } }), { '👍': { u: 1 } })
})
