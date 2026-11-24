// The board's actions on a real store, with a minimal stand-in for the canvas.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { get } from './helpers/items.ts'
import { createStore } from '../src/core/store.ts'
import { contains, bounds } from '../src/core/geometry.ts'
import { createActions, colorKind } from '../src/board/actions.ts'
import type { ColorKind, ToolContext } from '../src/board/tools/index.ts'
import type { ColorKey, Item } from '../src/core/types.ts'

function setup() {
  const store = createStore({ id: 'me', name: 'Me' })
  let selected: string[] = []
  const panned: Array<[number, number]> = []
  const colors: Partial<Record<ColorKind, ColorKey>> = {}
  const unused = () => {
    throw new Error('not used by the actions')
  }
  const ctx: ToolContext = {
    store,
    // only what the actions use of the view
    view: { panBy: (dx: number, dy: number) => void panned.push([dx, dy]) } as unknown as ToolContext['view'],
    getItem: (id) => store.get(id) || undefined,
    list: () => store.all(),
    selection: {
      ids: () => selected.filter((id) => store.get(id)),
      items: () => selected.map(store.get).filter((it): it is Item => it !== null),
      has: (id) => selected.includes(id),
      set: (ids) => void (selected = [...ids]),
      clear: () => void (selected = []),
    },
    withContents(ids) {
      const out = new Set(ids)
      for (const f of ids.map(store.get)) {
        if (f?.type !== 'frame') continue
        for (const it of store.all()) if (it.id !== f.id && contains(f, bounds(it, store.get))) out.add(it.id)
      }
      return [...out]
    },
    colorFor: (kind) => colors[kind] || 'yellow',
    measure() {},
    overlay: unused,
    setTool: unused,
    startEditing: unused,
    itemAt: unused,
    px: (n) => n,
    pan: unused,
  }
  const actions = createActions(ctx, {
    rememberColor: (kind, color) => void (colors[kind] = color),
    pasteAt: () => ({ x: 1000, y: 1000 }),
  })
  return { store, actions, select: ctx.selection.set, selected: () => selected, panned, colors }
}

test('delete takes frames with their contents and leaves locked items', () => {
  const { store, actions, select } = setup()
  const frame = store.create({ type: 'frame', x: 0, y: 0, w: 500, h: 500 })
  const inside = store.create({ type: 'note', x: 50, y: 50 })
  const locked = store.create({ type: 'note', x: 900, y: 0 })
  store.setLocked([locked], true)
  select([frame, locked])
  actions.deleteSelection()
  assert.equal(store.get(frame), null)
  assert.equal(store.get(inside), null, 'what sat in the frame goes with it')
  assert.ok(store.get(locked), 'locked items stay')
})

test('⌥ + arrow duplicates next to the selection', () => {
  const { store, actions, select, selected } = setup()
  const a = store.create({ type: 'note', x: 0, y: 0, w: 200, h: 200 })
  select([a])
  actions.duplicateBeside(1, 0)
  const copy = get(store, selected()[0], 'note')
  assert.equal(copy.x, 224)
  assert.equal(copy.y, 0)
})

test('arrows move the selection, or the view when nothing is selected', () => {
  const { store, actions, select, panned } = setup()
  actions.nudge(1, 0)
  assert.deepEqual(panned, [[-8, -0]])
  const a = store.create({ type: 'note', x: 0, y: 0 })
  const locked = store.create({ type: 'note', x: 0, y: 0 })
  store.setLocked([locked], true)
  select([a, locked])
  actions.nudge(0, 10)
  assert.equal(get(store, a, 'note').y, 10)
  assert.equal(get(store, locked, 'note').y, 0)
})

test('colour: frames keep theirs, the choice becomes the next default', () => {
  const { store, actions, select, colors } = setup()
  const note = store.create({ type: 'note', x: 0, y: 0 })
  const rect = store.create({ type: 'rect', x: 0, y: 0 })
  const frame = store.create({ type: 'frame', x: 0, y: 0 })
  select([note, rect, frame])
  actions.setColor('green')
  assert.equal(get(store, note).color, 'green')
  assert.equal(get(store, rect).color, 'green')
  assert.equal(get(store, frame).color, 'gray')
  assert.deepEqual(colors, { note: 'green', shape: 'green' })
  assert.equal(colorKind('diamond'), 'shape')
})

test('lock toggles the whole selection', () => {
  const { store, actions, select } = setup()
  const a = store.create({ type: 'note', x: 0, y: 0 })
  const b = store.create({ type: 'note', x: 0, y: 0 })
  store.setLocked([a], true)
  select([a, b])
  actions.toggleLock()
  assert.ok(get(store, a).locked && get(store, b).locked, 'some unlocked: lock all')
  actions.toggleLock()
  assert.ok(!get(store, a).locked && !get(store, b).locked, 'all locked: unlock all')
})

test('copy and paste: items centred on the paste point; text as stickies', () => {
  const { store, actions, select, selected } = setup()
  const a = store.create({ type: 'note', x: 0, y: 0, w: 200, h: 200, text: 'hi' })
  select([a])
  const copied = actions.copySelection()
  assert.equal(actions.paste({ items: copied }), true)
  const copy = get(store, selected()[0], 'note')
  assert.deepEqual([copy.x, copy.y, copy.text], [900, 900, 'hi'])
  assert.equal(actions.paste({ text: 'one\ntwo' }), true)
  assert.deepEqual(
    selected().map((id) => get(store, id, 'note').text),
    ['one', 'two'],
  )
  assert.equal(actions.paste({ text: '   ' }), false)
  store.undo()
  assert.equal(store.all().length, 2, 'a paste is one undo step')
})
