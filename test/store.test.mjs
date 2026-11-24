// The shared model: items, reactions, ordering, groups, copies and the v1 migration.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'

import { createStore } from '../src/core/store.js'

const sync = (from, to) => Y.applyUpdate(to.doc, Y.encodeStateAsUpdate(from.doc))

test('reactions: anyone, the author included, toggles any emoji', () => {
  const anna = createStore({ id: 'anna', name: 'Anna' })
  const n = anna.create({ type: 'note', x: 0, y: 0, text: 'hi' })
  anna.toggleReaction(n, '🎉')
  assert.deepEqual(Object.keys(anna.get(n).reactions), ['🎉'], 'authors can react to their own notes')

  const marco = createStore({ id: 'marco', name: 'Marco' })
  sync(anna, marco)
  marco.toggleReaction(n, '🎉')
  marco.toggleReaction(n, '👀')
  anna.toggleReaction(n, '👀') // concurrent with Marco's: both must survive
  sync(marco, anna)
  sync(anna, marco)
  for (const s of [anna, marco]) {
    const r = s.get(n).reactions
    assert.deepEqual(Object.keys(r['🎉']).sort(), ['anna', 'marco'])
    assert.deepEqual(Object.keys(r['👀']).sort(), ['anna', 'marco'])
  }
  marco.toggleReaction(n, '🎉')
  assert.deepEqual(Object.keys(marco.get(n).reactions['🎉']), ['anna'], 'a second click takes it back')
})

test('reactions only exist on sticky notes', () => {
  const s = createStore({ id: 'a', name: 'A' })
  const r = s.create({ type: 'rect', x: 0, y: 0 })
  s.toggleReaction(r, '👍')
  assert.equal(s.get(r).reactions, undefined)
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
  const r = s.get('old').reactions
  assert.deepEqual(Object.keys(r['👍']).sort(), ['u1', 'u3'])
  assert.deepEqual(Object.keys(r['👎']), ['u2'])
  assert.equal(s.items.get('old').get('votes'), undefined)
})

test('z-order: front, back, one step forward and backward; frames stay below', () => {
  const s = createStore({ id: 'a', name: 'A' })
  const [a, b, c, d] = ['A', 'B', 'C', 'D'].map((text) => s.create({ type: 'note', x: 0, y: 0, text }))
  const f = s.create({ type: 'frame', x: -50, y: -50, w: 600, h: 600 })
  const order = () => s.all().map((it) => it.text || 'frame')
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
  assert.equal(s.get(c).locked, true)
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
  const note = items.find((it) => it.type === 'note')
  const rect = items.find((it) => it.type === 'rect')
  const conn = items.find((it) => it.type === 'arrow')
  assert.equal(conn.from, note.id)
  assert.equal(conn.to, rect.id)
  assert.equal(note.x, 24)
  assert.deepEqual(note.reactions, {}, 'copies start without reactions')
  assert.ok(note.group && note.group === rect.group && note.group !== s.get(a).group, 'a new group')
})

test('a connector copied without its targets keeps its drawn ends', () => {
  const s = createStore({ id: 'a', name: 'A' })
  const a = s.create({ type: 'rect', x: 0, y: 0, w: 100, h: 100 })
  const b = s.create({ type: 'rect', x: 400, y: 0, w: 100, h: 100 })
  const arrow = s.create({ type: 'arrow', from: a, to: b, x1: 0, y1: 0, x2: 0, y2: 0 })
  const [copy] = s.duplicate([arrow], 0)
  const c = s.get(copy)
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
  s.update({ [n]: { type: 'rect', author: 'mallory', x: 50 } })
  const it = s.get(n)
  assert.equal(it.type, 'note')
  assert.equal(it.author, 'a')
  assert.equal(it.x, 50)
})
