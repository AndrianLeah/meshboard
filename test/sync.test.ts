// Sync over the peer-to-peer transport, with an in-memory room instead of the network.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createStore } from '../src/core/store.ts'
import type { Store } from '../src/core/store.ts'
import { get } from './helpers/items.ts'
import { joinBoardRoom } from '../src/sync/p2p.ts'
import { createPresence } from '../src/sync/presence.ts'
import { createHub, wait } from './helpers/fake-room.ts'

const token = { roomId: 'room-1', secret: 'secret-1' }
const texts = (s: Store) =>
  s
    .all()
    .map((it) => (it.type === 'note' ? it.text : ''))
    .sort()

test('a late joiner catches up, then edits flow both ways', async () => {
  const { joinRoom } = createHub()
  const anna = createStore({ id: 'anna', name: 'Anna' })
  anna.create({ type: 'note', x: 0, y: 0, text: 'before Marco' })
  const a = joinBoardRoom(anna.doc, token, { joinRoom })

  const marco = createStore({ id: 'marco', name: 'Marco' })
  const m = joinBoardRoom(marco.doc, token, { joinRoom })
  await wait(50)
  assert.deepEqual(texts(marco), ['before Marco'], 'state vectors bring the joiner up to date')

  const id = marco.create({ type: 'note', x: 300, y: 0, text: 'from Marco' })
  anna.create({ type: 'note', x: 600, y: 0, text: 'from Anna' })
  await wait(80) // past the 30 ms batching
  assert.deepEqual(texts(anna), ['before Marco', 'from Anna', 'from Marco'])
  assert.deepEqual(texts(marco), texts(anna))

  anna.toggleReaction(id, '🎉')
  marco.toggleReaction(id, '🎉')
  await wait(80)
  assert.deepEqual(Object.keys(get(marco, id, 'note').reactions['🎉']).sort(), ['anna', 'marco'])
  assert.equal(a.peerCount(), 1)

  await m.destroy()
  await wait(10)
  assert.equal(a.peerCount(), 0)
  await a.destroy()
})

test('without the secret nothing is shared', async () => {
  const { joinRoom } = createHub()
  const anna = createStore({ id: 'anna', name: 'Anna' })
  anna.create({ type: 'note', x: 0, y: 0, text: 'private' })
  const a = joinBoardRoom(anna.doc, token, { joinRoom })
  const eve = createStore({ id: 'eve', name: 'Eve' })
  const e = joinBoardRoom(eve.doc, { ...token, secret: 'guess' }, { joinRoom })
  await wait(50)
  assert.equal(eve.all().length, 0)
  await Promise.all([a.destroy(), e.destroy()])
})

test('a burst of edits travels as one merged update', async () => {
  const { joinRoom } = createHub()
  const anna = createStore({ id: 'anna', name: 'Anna' })
  const marco = createStore({ id: 'marco', name: 'Marco' })
  const a = joinBoardRoom(anna.doc, token, { joinRoom })
  const m = joinBoardRoom(marco.doc, token, { joinRoom })
  await wait(30)
  let received = 0
  marco.doc.on('update', () => received++)
  const id = anna.create({ type: 'note', x: 0, y: 0 })
  for (let x = 1; x <= 20; x++) anna.update({ [id]: { x } })
  await wait(80)
  assert.equal(get(marco, id, 'note').x, 20)
  assert.equal(received, 1, '21 local transactions, one message')
  await Promise.all([a.destroy(), m.destroy()])
})

test('presence: names and cursors arrive, and leave with the peer', async () => {
  const { joinRoom } = createHub()
  const ra = joinRoom({ appId: 'test', password: 's' }, 'r')
  const rb = joinRoom({ appId: 'test', password: 's' }, 'r')
  const anna = createPresence(ra, { id: 'anna', name: 'Anna' })
  const marco = createPresence(rb, { id: 'marco', name: 'Marco' })
  let joins = 0
  anna.onPeers(() => joins++)
  marco.set({ x: 10.5, y: 20, name: 'Marco R.' })
  await wait(100)
  const [seen] = [...anna.peers.values()]
  assert.deepEqual(seen, { uid: 'marco', name: 'Marco R.', x: 10.5, y: 20 })
  assert.ok(joins >= 1)
  await rb.leave()
  await wait(10)
  assert.equal(anna.peers.size, 0)
  anna.destroy()
  marco.destroy()
})
