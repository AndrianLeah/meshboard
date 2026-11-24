// Test del modello dati: export/import, voti, frecce, sanificazione.
import assert from 'node:assert/strict'
import * as Y from 'yjs'

import { createStore } from '../src/store.js'

const anna = createStore({ id: 'anna', name: 'Anna' })
anna.registerUser('anna', 'Anna')
anna.setTitle('Retro')
const n1 = anna.create({ type: 'note', x: 0, y: 0, w: 200, h: 200, text: 'ciao', color: 'yellow' })
const r1 = anna.create({ type: 'rect', x: 400, y: 0, w: 100, h: 80, color: 'blue' })
const a1 = anna.create({ type: 'arrow', x1: 0, y1: 0, x2: 1, y2: 1, from: n1, to: r1 })

// voti: niente voto sul proprio post-it
anna.vote(n1, 1)
assert.deepEqual(anna.get(n1).votes, {}, 'autore non può votare')

// Marco riceve lo stato e vota
const marco = createStore({ id: 'marco', name: 'Marco' })
Y.applyUpdate(marco.doc, Y.encodeStateAsUpdate(anna.doc))
marco.vote(n1, 1)
assert.equal(marco.get(n1).votes.marco, 1)
marco.vote(n1, 1)
assert.equal(marco.get(n1).votes.marco, undefined, 'secondo clic toglie il voto')
marco.vote(n1, -1)
Y.applyUpdate(anna.doc, Y.encodeStateAsUpdate(marco.doc))
assert.equal(anna.get(n1).votes.marco, -1, 'il voto arriva ad Anna')

// export
const data = JSON.parse(JSON.stringify(anna.exportData()))
assert.equal(data.format, 'meshboard')
assert.equal(data.title, 'Retro')
assert.equal(data.items.length, 3)
const exportedArrow = data.items.find((i) => i.type === 'arrow')
assert.ok(exportedArrow.x1 > 0, 'la freccia esportata ha le coordinate reali')

// import in una lavagna nuova (stessi id)
const fresh = createStore({ id: 'luca', name: 'Luca' })
fresh.importData(data, { keepIds: true })
assert.equal(fresh.getTitle(), 'Retro')
assert.equal(fresh.all().length, 3)
assert.equal(fresh.get(a1).from, n1)
assert.equal(fresh.get(n1).votes.marco, -1, 'i voti sopravvivono')
assert.equal(fresh.userName('anna'), 'Anna')

// import aggiunto a una lavagna esistente (id nuovi, frecce rimappate)
const ids = anna.importData(data)
assert.equal(ids.length, 3)
assert.equal(anna.all().length, 6)
const newArrow = anna.get(ids.find((id) => anna.get(id).type === 'arrow'))
assert.ok(ids.includes(newArrow.from) && ids.includes(newArrow.to), 'frecce agganciate alle copie')
anna.undo()
assert.equal(anna.all().length, 3, 'import annullabile')

// eliminare un elemento elimina le frecce agganciate
anna.remove([r1])
assert.equal(anna.get(a1), null)

// sanificazione di input ostili
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
assert.throws(() => s.importData({ format: 'altro', items: [] }))

console.log('OK: tutti i test del modello dati passano')
