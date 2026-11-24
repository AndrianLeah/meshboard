// Pan and zoom maths, and telling a mouse wheel from a trackpad.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createView, createWheelClassifier } from '../src/board/view.ts'

const noop = () => {}
function fakeElements(width = 800, height = 600) {
  const viewport = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
    style: { setProperty: noop },
    classList: { toggle: noop },
    addEventListener: noop,
    removeEventListener: noop,
  }
  const world = { style: { transform: '', setProperty: noop } }
  // only what the view touches: stand-ins, not real elements
  return { viewport: viewport as unknown as HTMLElement, world: world as unknown as HTMLElement }
}

test('zooming keeps the point under the cursor still', () => {
  const { viewport, world } = fakeElements()
  const view = createView(viewport, world)
  const before = view.toWorld(200, 150)
  view.zoomAt(2, 200, 150)
  const after = view.toWorld(200, 150)
  assert.equal(view.scale, 2)
  assert.deepEqual(after, before)
  view.zoomAt(1000)
  assert.equal(view.scale, 4, 'zoom stops at 400%')
})

test('zoom steps and fitting a box', () => {
  const { viewport, world } = fakeElements()
  const view = createView(viewport, world)
  view.stepZoom(1)
  assert.equal(view.scale, 1.25)
  view.stepZoom(-1)
  view.stepZoom(-1)
  assert.equal(view.scale, 0.75)
  view.fit({ x: 1000, y: 1000, w: 1280, h: 880 }, { pad: 0 })
  assert.equal(view.scale, 0.625)
  const c = view.toClient({ x: 1640, y: 1440 })
  assert.deepEqual([c.x, c.y], [400, 300], 'the box is centred')
  view.fit({ x: 0, y: 0, w: 10, h: 10 })
  assert.equal(view.scale, 1, 'never above 100% when fitting')
})

test('wheel: notches zoom, trackpad streams pan, a decision sticks for the stream', () => {
  let t = 0
  const classify = createWheelClassifier(() => t)
  const mouse = { deltaMode: 0, deltaX: 0, deltaY: 100, wheelDeltaY: -120 }
  const pad = { deltaMode: 0, deltaX: 0, deltaY: 4.5, wheelDeltaY: -13.5 }
  assert.equal(classify(mouse), 'mouse')
  t += 1000
  assert.equal(classify(pad), 'trackpad')
  t += 50
  assert.equal(classify(mouse), 'trackpad', 'inertia within a stream keeps the first decision')
  t += 1000
  assert.equal(classify({ deltaMode: 1, deltaX: 0, deltaY: 3 }), 'mouse', 'lines: a wheel')
  t += 1000
  assert.equal(classify({ deltaMode: 0, deltaX: 6, deltaY: 1 }), 'trackpad', 'two axes: a trackpad')
})
