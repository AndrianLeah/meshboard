// The shared model: items, reactions, ordering, groups, copies and the v1 migration.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'

import { find, get } from './helpers/items.ts'
import { createStore } from '../src/core/store.ts'
import type { Store } from '../src/core/store.ts'
import type { Item } from '../src/core/types.ts'

const sync = (from: Store, to: Store) => Y.applyUpdate(to.doc, Y.encodeStateAsUpdate(from.doc))

test('reactions: anyone, the author included, toggles any emoji', () => {
  const anna = createStore({ id: 'anna', name: 'Anna' })
  const n = anna.create({ type: 'note', x: 0, y: 0, text: 'hi' })
  anna.toggleReaction(n, '🎉')
  assert.deepEqual(Object.keys(get(anna, n, 'note').reactions), ['🎉'], 'authors can react to their own notes')

  const marco = createStore({ id: 'marco', name: 'Marco' })
  sync(anna, marco)
  marco.toggleReaction(n, '🎉')
  marco.toggleReaction(n, '👀')
  anna.toggleReaction(n, '👀') // concurrent with Marco's: both must survive
  sync(marco, anna)
  sync(anna, marco)
  for (const s of [anna, marco]) {
    const r = get(s, n, 'note').reactions
    assert.deepEqual(Object.keys(r['🎉']).sort(), ['anna', 'marco'])
    assert.deepEqual(Object.keys(r['👀']).sort(), ['anna', 'marco'])
  }
  marco.toggleReaction(n, '🎉')
  assert.deepEqual(Object.keys(get(marco, n, 'note').reactions['🎉']), ['anna'], 'a second click takes it back')
})

test('reactions only exist on sticky notes', () => {
  const s = createStore({ id: 'a', name: 'A' })
  const r = s.create({ type: 'rect', x: 0, y: 0 })
  s.toggleReaction(r, '👍')
  assert.equal('reactions' in get(s, r), false)
})

test('v1 votes become 👍 / 👎 reactions', () => {
  const s = createStore({ id: 'a', name: 'A' })
  s.doc.transact(() => {
    const m = new Y.Map()
    s.items.set('old', m)
    m.set('type', 'note')
    m.set('x', 0)
    m.set('y', 0)
    m.set('w', 200)
    m.set('h', 200)
    m.set('z', 1)
    const votes = new Y.Map()
    m.set('votes', votes)
    votes.set('u1', 1)
    votes.set('u2', -1)
    votes.set('u3', 1)
  })
  s.migrate()
  const r = get(s, 'old', 'note').reactions
  assert.deepEqual(Object.keys(r['👍']).sort(), ['u1', 'u3'])
  assert.deepEqual(Object.keys(r['👎']), ['u2'])
  assert.equal(s.items.get('old')?.get('votes'), undefined)
})

test('z-order: front, back, one step forward and backward; frames stay below', () => {
  const s = createStore({ id: 'a', name: 'A' })
  const [a, b, c, d] = ['A', 'B', 'C', 'D'].map((text) => s.create({ type: 'note', x: 0, y: 0, text }))
  const f = s.create({ type: 'frame', x: -50, y: -50, w: 600, h: 600 })
  const order = () => s.all().map((it) => (it.type === 'note' ? it.text : 'frame'))
  assert.deepEqual(order(), ['frame', 'A', 'B', 'C', 'D'], 'a frame created last is still below')
  s.reorder([a], 'front')
  assert.deepEqual(order(), ['frame', 'B', 'C', 'D', 'A'])
  s.reorder([a], 'back')
  assert.deepEqual(order(), ['frame', 'A', 'B', 'C', 'D'])
  s.reorder([a], 'forward')
  assert.deepEqual(order(), ['frame', 'B', 'A', 'C', 'D'])
  s.reorder([d], 'backward')
  assert.deepEqual(order(), ['frame', 'B', 'A', 'D', 'C'])
  s.reorder([b, a], 'forward')
  assert.deepEqual(order(), ['frame', 'D', 'B', 'A', 'C'], 'a block moves together')
  s.reorder([c], 'forward')
  assert.deepEqual(order(), ['frame', 'D', 'B', 'A', 'C'], 'the top item stays on top')
  assert.ok(s.get(f))
})

test('groups and locks', () => {
  const s = createStore({ id: 'a', name: 'A' })
  const a = s.create({ type: 'note', x: 0, y: 0 })
  const b = s.create({ type: 'rect', x: 300, y: 0 })
  const c = s.create({ type: 'rect', x: 600, y: 0 })
  const gid = s.group([a, b])
  assert.ok(gid)
  assert.deepEqual(s.withGroups([a]).sort(), [a, b].sort())
  assert.deepEqual(s.withGroups([c]), [c])
  s.ungroup([a, b])
  assert.deepEqual(s.withGroups([a]), [a])
  s.setLocked([c], true)
  assert.equal(get(s, c).locked, true)
})

test('duplicate: new ids, connectors and groups follow the copies', () => {
  const s = createStore({ id: 'a', name: 'A' })
  const a = s.create({ type: 'note', x: 0, y: 0, text: 'a' })
  const b = s.create({ type: 'rect', x: 400, y: 0 })
  const arrow = s.create({ type: 'arrow', from: a, to: b, x1: 0, y1: 0, x2: 1, y2: 1 })
  s.group([a, b])
  s.toggleReaction(a, '🔥')
  const copies = s.duplicate([a, b, arrow])
  assert.equal(copies.length, 3)
  const items = copies.map(s.get)
  const note = find(items, 'note')
  const rect = find(items, 'rect')
  const conn = find(items, 'arrow')
  assert.equal(conn.from, note.id)
  assert.equal(conn.to, rect.id)
  assert.equal(note.x, 24)
  assert.deepEqual(note.reactions, {}, 'copies start without reactions')
  assert.ok(note.group && note.group === rect.group && note.group !== get(s, a).group, 'a new group')
})

test('a connector copied without its targets keeps its drawn ends', () => {
  const s = createStore({ id: 'a', name: 'A' })
  const a = s.create({ type: 'rect', x: 0, y: 0, w: 100, h: 100 })
  const b = s.create({ type: 'rect', x: 400, y: 0, w: 100, h: 100 })
  const arrow = s.create({ type: 'arrow', from: a, to: b, x1: 0, y1: 0, x2: 0, y2: 0 })
  const [copy] = s.duplicate([arrow], 0)
  const c = get(s, copy, 'arrow')
  assert.equal(c.from, '')
  assert.equal(c.to, '')
  assert.ok(c.x1 > 100 && c.x2 < 400, 'ends sit on the outlines of the original targets')
})

test('remove takes attached connectors along; undo restores them', () => {
  const s = createStore({ id: 'a', name: 'A' })
  const a = s.create({ type: 'note', x: 0, y: 0 })
  const b = s.create({ type: 'note', x: 400, y: 0 })
  s.stopCapturing()
  const arrow = s.create({ type: 'arrow', from: a, to: b })
  s.stopCapturing()
  const gone = s.remove([b])
  assert.ok(gone.has(arrow))
  assert.equal(s.get(arrow), null)
  s.undo()
  assert.ok(s.get(arrow) && s.get(b))
})

test('update ignores fields that identify an item', () => {
  const s = createStore({ id: 'a', name: 'A' })
  const n = s.create({ type: 'note', x: 0, y: 0 })
  // what a misbehaving peer or a bug could send: the store must drop the identity fields
  s.update({ [n]: { type: 'rect', author: 'mallory', x: 50 } as Record<string, unknown> })
  const it = get(s, n, 'note')
  assert.equal(it.type, 'note')
  assert.equal(it.author, 'a')
  assert.equal(it.x, 50)
})

// ---------- what other peers send ----------

/** A hostile peer: writes whatever it likes into its copy of the doc, and the update reaches `to`. */
function fromPeer(to: Store, write: (items: Y.Map<unknown>) => void) {
  const peer = new Y.Doc()
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(to.doc))
  const seen = Y.encodeStateVector(peer)
  peer.transact(() => write(peer.getMap('items')))
  Y.applyUpdate(to.doc, Y.encodeStateAsUpdate(peer, seen))
}

/** A new Y.Map with `fields`, under `key` in `parent`. */
function setMap(parent: Y.Map<unknown>, key: string, fields: Record<string, unknown>): Y.Map<unknown> {
  const m = new Y.Map<unknown>()
  parent.set(key, m)
  for (const [k, v] of Object.entries(fields)) m.set(k, v)
  return m
}

test("a peer's items get the same limits as a file's; the ones that can't be repaired are skipped", () => {
  const s = createStore({ id: 'anna', name: 'Anna' })
  fromPeer(s, (items) => {
    setMap(items, 'note', {
      type: 'note',
      x: NaN,
      y: 1e12,
      w: -5,
      h: Infinity,
      z: 'top',
      text: 'x'.repeat(100_000),
      color: 'chartreuse',
      locked: 'yes',
      author: 'm'.repeat(500),
      group: 42,
      created: 5,
      onclick: 'alert(1)',
    })
    setMap(items, 'pen', { type: 'path', x: 1, y: 2, w: 1e12, h: 10, points: ['1', 2, null, 'x', 5e9, 6, 7], width: 0 })
    setMap(items, 'long-pen', { type: 'path', x: 0, y: 0, points: Array.from({ length: 20_001 }, (_, i) => i) })
    setMap(items, 'line', {
      type: 'arrow',
      x1: Infinity,
      y1: -1e12,
      x2: 3,
      y2: 4,
      from: 'f'.repeat(100),
      to: 7,
      start: 'boom',
      end: 'none',
      dash: 1,
    })
    // beyond repair
    setMap(items, 'no-points', { type: 'path', x: 0, y: 0, points: 'lots' })
    setMap(items, 'one-point', { type: 'path', x: 0, y: 0, points: [1, 2, 3] })
    setMap(items, 'script', { type: 'script', x: 0, y: 0 })
    setMap(items, 'k'.repeat(65), { type: 'rect', x: 0, y: 0 })
    setMap(items, '', { type: 'rect', x: 0, y: 0 })
    items.set('plain', { type: 'note', x: 0, y: 0 })
  })

  assert.deepEqual(
    s.all().map((it) => it.id),
    ['line', 'long-pen', 'note', 'pen'],
  )
  const note = get(s, 'note', 'note')
  assert.deepEqual([note.x, note.y, note.w, note.h, note.z], [0, 1e6, 20, 200, 0], 'finite, within ±1e6')
  assert.equal(note.text.length, 5000)
  assert.deepEqual([note.color, note.locked, note.author.length, note.group], ['yellow', false, 64, ''])
  assert.deepEqual(note.reactions, {})
  assert.equal('onclick' in note, false, 'unknown fields are dropped')
  assert.ok(Object.isFrozen(note))

  const pen = get(s, 'pen', 'path')
  assert.deepEqual(pen.points, [1, 2, 0, 0, 1e6, 6], 'numbers, clamped, in pairs')
  assert.deepEqual([pen.w, pen.ow, pen.width], [1e6, 1e6, 1])
  assert.equal(get(s, 'long-pen', 'path').points.length, 8000, 'at most 4000 points')

  const line = get(s, 'line', 'arrow')
  assert.deepEqual([line.x1, line.y1, line.x2, line.y2], [0, -1e6, 3, 4])
  assert.deepEqual([line.from.length, line.to, line.start, line.end, line.dash], [64, '', 'none', 'none', false])
})

test("a peer's reactions: only real emoji from real ids, at most 40 emoji, in the order they were used", () => {
  const s = createStore({ id: 'anna', name: 'Anna' })
  const id = s.create({ type: 'note', x: 0, y: 0 })
  fromPeer(s, (items) => {
    const r = (items.get(id) as Y.Map<unknown>).get('reactions') as Y.Map<unknown>
    r.set('marco:👍', 200)
    r.set('anna:🎉', 100)
    r.set('carol:👍', 'soon')
    r.set('eve:<img src=x>', 300)
    r.set('no-emoji-here', 300)
    r.set(':👍', 300)
    r.set('bad uid:👍', 300)
    r.set(`${'u'.repeat(65)}:👍`, 300)
    for (let i = 0; i < 50; i++) r.set(`spam:e${i}`, 1000 + i)
  })
  const r = get(s, id, 'note').reactions
  assert.equal(Object.keys(r).length, 40)
  assert.deepEqual(Object.keys(r).slice(0, 3), ['👍', '🎉', 'e0'], 'the earliest first')
  assert.deepEqual(r['👍'], { carol: 1, marco: 200 }, 'a time that is not a number becomes 1')
  assert.deepEqual(r['🎉'], { anna: 100 })
  assert.equal('e38' in r, false)
})

test('a peer cannot break an item that is there; a stroke it empties is skipped until repaired', () => {
  const s = createStore({ id: 'anna', name: 'Anna' })
  const n = s.create({ type: 'note', x: 10, y: 20, text: 'hi' })
  const p = s.create({ type: 'path', x: 0, y: 0, w: 10, h: 10, points: [0, 0, 10, 10] })
  fromPeer(s, (items) => {
    const note = items.get(n) as Y.Map<unknown>
    note.set('x', NaN)
    note.set('y', -Infinity)
    note.set('text', 'x'.repeat(100_000))
    ;(items.get(p) as Y.Map<unknown>).set('points', [])
  })
  const note = get(s, n, 'note')
  assert.deepEqual([note.x, note.y, note.text.length], [0, 0, 5000])
  assert.equal(s.get(p), null)
  assert.deepEqual(
    s.all().map((it) => it.id),
    [n],
  )
  s.update({ [p]: { points: [0, 0, 5, 5] } })
  assert.deepEqual(get(s, p, 'path').points, [0, 0, 5, 5])
})

test('valid items come back exactly as written, and a moved stroke keeps its points', () => {
  const s = createStore({ id: 'anna', name: 'Anna' })
  const base = { author: 'marco', created: 1_700_000_000_000, locked: false, group: '' }
  const list: Item[] = [
    {
      ...base,
      id: 'n',
      type: 'note',
      x: 1.5,
      y: -2,
      w: 220,
      h: 180,
      z: 3,
      color: 'pink',
      text: 'hello',
      locked: true,
      group: 'g1',
      reactions: { '👍': { marco: 100 }, '🎉': { anna: 200, marco: 300 } },
    },
    { ...base, id: 't', type: 'text', x: 0, y: 0, w: 280, h: 40, z: 1, color: 'gray', text: 'title', fontSize: 36 },
    { ...base, id: 'f', type: 'frame', x: -50, y: -50, w: 640, h: 440, z: 0.5, color: 'gray', text: 'Ideas' },
    {
      ...base,
      id: 'p',
      type: 'path',
      x: 5,
      y: 5,
      w: 20,
      h: 10,
      z: 2,
      color: 'blue',
      points: [0, 0, 10, 10, 20, 5],
      ow: 20,
      oh: 10,
      width: 3,
    },
    {
      ...base,
      id: 'a',
      type: 'arrow',
      z: 4,
      color: 'gray',
      x1: 0,
      y1: 0,
      x2: 100,
      y2: 50,
      from: 'n',
      to: 't',
      start: 'none',
      end: 'arrow',
      dash: true,
    },
  ]
  s.insert(list, { preserve: true, keepIds: true })
  for (const it of list) assert.deepEqual(s.get(it.id), it, `${it.type} ${it.id}`)

  const note = s.get('n')
  const before = get(s, 'p', 'path')
  s.update({ p: { x: 50 } })
  const after = get(s, 'p', 'path')
  assert.notEqual(after, before, 'a new object for the renderers')
  assert.equal(after.points, before.points, "a drag doesn't sanitise the points again")
  assert.ok(Object.isFrozen(after.points))
  assert.equal(s.get('n'), note, 'items the change did not touch keep their object')
})
