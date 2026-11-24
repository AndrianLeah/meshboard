// Geometry: outlines, connector ends, strokes and smart-guide snapping.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { arrowEnds, dragBox, edgePoint, pathHit, resizeBox, simplify, snap, unionBounds } from '../src/core/geometry.ts'

import { sanitizeItem } from '../src/core/schema.ts'
import type { Item } from '../src/core/types.ts'

const close = (a: number, b: number, msg: string) => assert.ok(Math.abs(a - b) < 0.01, `${msg}: ${a} ≠ ${b}`)

test('edge points follow each outline', () => {
  const box = { x: 0, y: 0, w: 200, h: 100 }
  const right = { x: 1000, y: 50 }
  close(edgePoint({ ...box, type: 'rect' }, right, 0).x, 200, 'rect')
  close(edgePoint({ ...box, type: 'ellipse' }, right, 0).x, 200, 'ellipse, on the axis')
  const diag = { x: 200, y: 100 }
  const e = edgePoint({ ...box, type: 'ellipse' }, diag, 0)
  close(((e.x - 100) / 100) ** 2 + ((e.y - 50) / 50) ** 2, 1, 'ellipse, on the curve')
  const d = edgePoint({ ...box, type: 'diamond' }, diag, 0)
  close(Math.abs(d.x - 100) / 100 + Math.abs(d.y - 50) / 50, 1, 'diamond')
})

test('connector ends attach to item outlines', () => {
  const rect = (id: string, x: number) => ({ ...sanitizeItem({ type: 'rect', x, y: 0, w: 100, h: 100 }), id }) as Item
  const items: Record<string, Item> = { a: rect('a', 0), b: rect('b', 300) }
  const e = arrowEnds({ from: 'a', to: 'b', x1: 0, y1: 0, x2: 0, y2: 0 }, (id) => items[id])
  close(e.x1, 106, 'start, with the gap')
  close(e.x2, 294, 'end, with the gap')
  close(e.y1, 50, 'centre line')
})

test('pen strokes: hit testing and simplification', () => {
  const stroke = { x: 0, y: 0, w: 100, h: 100, ow: 100, oh: 100, width: 2, points: [0, 0, 100, 100] }
  assert.ok(pathHit(stroke, { x: 50, y: 52 }, 2))
  assert.ok(!pathHit(stroke, { x: 50, y: 80 }, 2))
  const line = Array.from({ length: 50 }, (_, i) => ({ x: i, y: i % 2 ? 0.1 : 0 }))
  assert.equal(simplify(line, 0.5).length, 2)
})

test('snapping lines up edges and centres within the threshold', () => {
  const others = [{ x: 100, y: 0, w: 100, h: 100 }]
  const r = snap({ x: 103, y: 300, w: 100, h: 50 }, others, 6)
  assert.equal(r.dx, -3, 'left edges')
  assert.equal(r.dy, 0)
  assert.equal(r.guides.length, 1)
  const far = snap({ x: 120, y: 300, w: 50, h: 50 }, others, 6)
  assert.equal(far.dx, 5, 'centres: 145 → 150')
  assert.deepEqual(snap({ x: 500, y: 500, w: 10, h: 10 }, others, 6), { dx: 0, dy: 0, guides: [] })
  assert.equal(unionBounds([]), null)
})

test('resizing: free, proportional, and never below the minimum', () => {
  const o = { x: 0, y: 0, w: 200, h: 100 }
  assert.deepEqual(resizeBox(o, 'e', { x: 300, y: 999 }), { x: 0, y: 0, w: 300, h: 100 })
  assert.deepEqual(resizeBox(o, 'nw', { x: 150, y: 90 }, { min: 20 }), { x: 150, y: 80, w: 50, h: 20 })
  assert.deepEqual(resizeBox(o, 'se', { x: 400, y: 120 }, { keepRatio: true }), { x: 0, y: 0, w: 240, h: 120 })
  assert.deepEqual(dragBox({ x: 10, y: 10 }, { x: 0, y: 40 }, true), { x: -20, y: 10, w: 30, h: 30 })
})
