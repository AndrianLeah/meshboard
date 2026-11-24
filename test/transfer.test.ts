// Files and the clipboard: export, import, sanitising, paste.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { find, get } from './helpers/items.ts'
import { createStore } from '../src/core/store.ts'
import { exportBoard, importBoard } from '../src/core/transfer.ts'
import { decodeClipboard, encodeClipboard, notesFromLines, pasteOffset } from '../src/core/clipboard.ts'
import { sanitizeItem } from '../src/core/schema.ts'

function sample() {
  const s = createStore({ id: 'anna', name: 'Anna' })
  s.registerUser('anna', 'Anna')
  s.setTitle('Retro')
  const n = s.create({ type: 'note', x: 0, y: 0, text: 'Went well' })
  const r = s.create({ type: 'rect', x: 400, y: 0, w: 100, h: 80 })
  const a = s.create({ type: 'arrow', from: n, to: r, x1: 0, y1: 0, x2: 1, y2: 1 })
  s.toggleReaction(n, '🎉')
  return { s, n, r, a }
}

test('export → import as a new board keeps ids, title, people and reactions', () => {
  const { s, n, a } = sample()
  const data = JSON.parse(JSON.stringify(exportBoard(s)))
  assert.equal(data.format, 'meshboard')
  assert.equal(data.version, 2)
  assert.equal(data.items.length, 3)
  assert.ok(
    data.items.find((i: { type: string; x1: number }) => i.type === 'arrow').x1 > 0,
    'connectors carry their drawn ends',
  )

  const fresh = createStore({ id: 'luca', name: 'Luca' })
  importBoard(fresh, data, { asNewBoard: true })
  assert.equal(fresh.getTitle(), 'Retro')
  assert.equal(get(fresh, a, 'arrow').from, n)
  assert.deepEqual(Object.keys(get(fresh, n, 'note').reactions['🎉']), ['anna'])
  assert.equal(fresh.userName('anna'), 'Anna')
})

test('import into a board adds copies to the right, as one undo step', () => {
  const { s } = sample()
  const data = exportBoard(s)
  const ids = importBoard(s, data)
  assert.equal(s.all().length, 6)
  const copies = ids.map(s.get)
  const xs = copies.flatMap((it) => (it && it.type !== 'arrow' ? [it.x] : []))
  assert.ok(Math.min(...xs) >= 500 + 160)
  const conn = find(copies, 'arrow')
  assert.ok(ids.includes(conn.from) && ids.includes(conn.to))
  s.undo()
  assert.equal(s.all().length, 3)
})

test('v1 files: votes become reactions, arrows get default ends', () => {
  const s = createStore({ id: 'x', name: 'X' })
  const ids = importBoard(s, {
    format: 'meshboard',
    version: 1,
    items: [
      { id: 'n', type: 'note', x: 0, y: 0, w: 200, h: 200, votes: { u1: 1, u2: -1, u3: 7 } },
      { id: 'a', type: 'arrow', x1: 0, y1: 0, x2: 100, y2: 0 },
    ],
  })
  const note = get(s, ids[0], 'note')
  assert.deepEqual(Object.keys(note.reactions).sort(), ['👍', '👎'])
  const arrow = get(s, ids[1], 'arrow')
  assert.equal(arrow.end, 'arrow')
  assert.equal(arrow.start, 'none')
})

test('hostile input is cleaned up', () => {
  assert.equal(sanitizeItem({ type: 'script' }), null)
  const it = sanitizeItem({
    type: 'note',
    x: 'NaN',
    y: 1e99,
    w: -5,
    color: '<img onerror>',
    text: 42,
    reactions: { '<b>': { u: 1 }, '👍': { 'bad id!': 1, ok: 1 } },
  })
  assert.ok(it?.type === 'note')
  assert.equal(it.x, 0)
  assert.equal(it.y, 1e6)
  assert.equal(it.w, 20)
  assert.equal(it.color, 'yellow')
  assert.equal(it.text, '')
  assert.deepEqual(it.reactions, { '👍': { ok: 1 } })
  assert.equal(sanitizeItem({ type: 'path', points: [1, 2] }), null, 'a stroke needs two points')
  assert.throws(() => importBoard(createStore({ id: 'a', name: 'A' }), { format: 'other', items: [] }))
})

test('clipboard: items round-trip through HTML, text pastes as stickies', () => {
  const { s, n, r } = sample()
  const { text, html } = encodeClipboard(s.snapshot([n, r]))
  assert.equal(text, 'Went well')
  const back = decodeClipboard({ html, text })
  assert.ok(back && 'items' in back)
  assert.equal(back.items.length, 2)
  const off = pasteOffset(back.items, { x: 1000, y: 1000 })
  assert.deepEqual(off, { dx: 750, dy: 900 })

  const plain = decodeClipboard({ text: 'one\n\n two \nthree' })
  assert.ok(plain && 'lines' in plain)
  assert.deepEqual(plain.lines, ['one', 'two', 'three'])
  const notes = notesFromLines(plain.lines, { x: 0, y: 0 })
  assert.equal(notes.length, 3)
  assert.equal(notes[1].x - notes[0].x, 224)
  assert.equal(decodeClipboard({ text: '  ' }), null)
})
