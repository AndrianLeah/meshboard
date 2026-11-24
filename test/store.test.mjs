// Data model tests: export/import, votes, arrows, sanitising.
import assert from 'node:assert/strict'
import * as Y from 'yjs'

import { createStore } from '../src/store.js'

const anna = createStore({ id: 'anna', name: 'Anna' })
anna.registerUser('anna', 'Anna')
anna.setTitle('Retro')
const n1 = anna.create({ type: 'note', x: 0, y: 0, w: 200, h: 200, text: 'ciao', color: 'yellow' })
const r1 = anna.create({ type: 'rect', x: 400, y: 0, w: 100, h: 80, color: 'blue' })
const a1 = anna.create({ type: 'arrow', x1: 0, y1: 0, x2: 1, y2: 1, from: n1, to: r1 })

// votes: no voting on your own note
anna.vote(n1, 1)
assert.deepEqual(anna.get(n1).votes, {}, 'authors cannot vote on their own notes')

// Marco receives the state and votes
const marco = createStore({ id: 'marco', name: 'Marco' })
Y.applyUpdate(marco.doc, Y.encodeStateAsUpdate(anna.doc))
marco.vote(n1, 1)
assert.equal(marco.get(n1).votes.marco, 1)
marco.vote(n1, 1)
assert.equal(marco.get(n1).votes.marco, undefined, 'a second click removes the vote')
marco.vote(n1, -1)
Y.applyUpdate(anna.doc, Y.encodeStateAsUpdate(marco.doc))
assert.equal(anna.get(n1).votes.marco, -1, 'the vote reaches Anna')

// export
const data = JSON.parse(JSON.stringify(anna.exportData()))
assert.equal(data.format, 'meshboard')
assert.equal(data.title, 'Retro')
assert.equal(data.items.length, 3)
const exportedArrow = data.items.find((i) => i.type === 'arrow')
assert.ok(exportedArrow.x1 > 0, 'the exported arrow has its actual coordinates')

// import into a new board (same ids)
const fresh = createStore({ id: 'luca', name: 'Luca' })
fresh.importData(data, { keepIds: true })
assert.equal(fresh.getTitle(), 'Retro')
assert.equal(fresh.all().length, 3)
assert.equal(fresh.get(a1).from, n1)
assert.equal(fresh.get(n1).votes.marco, -1, 'votes survive')
assert.equal(fresh.userName('anna'), 'Anna')

// import added to an existing board (new ids, arrows remapped)
const ids = anna.importData(data)
assert.equal(ids.length, 3)
assert.equal(anna.all().length, 6)
const newArrow = anna.get(ids.find((id) => anna.get(id).type === 'arrow'))
assert.ok(ids.includes(newArrow.from) && ids.includes(newArrow.to), 'arrows attached to the copies')
anna.undo()
assert.equal(anna.all().length, 3, 'an import can be undone')

// deleting an item deletes the arrows attached to it
anna.remove([r1])
assert.equal(anna.get(a1), null)

// sanitising hostile input
const evil = {
  format: 'meshboard',
  items: [
    { id: 'x', type: 'script', x: 0 },
    { id: 'y', type: 'note', x: 'NaN', y: 1e99, w: -5, color: '<img onerror>', text: 42, votes: { a: 5, b: 1 } },
  ],
}
const s = createStore({ id: 's', name: 'S' })
const created = s.importData(evil)
assert.equal(created.length, 1)
const y = s.get(created[0])
assert.equal(y.x, 0)
assert.equal(y.y, 1e6)
assert.equal(y.w, 20)
assert.equal(y.color, 'yellow')
assert.equal(y.text, '')
assert.deepEqual(y.votes, { b: 1 })
assert.throws(() => s.importData({ format: 'other', items: [] }))

console.log('OK: all data model tests pass')
