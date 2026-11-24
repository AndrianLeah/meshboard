// Connectors: drag from an item (or from anywhere) to an item (or anywhere). The item under the
// pointer is highlighted and becomes the target. Also used by connection dots and end handles.
import { arrowEnds } from '../../core/geometry.js'

/** Gesture that draws a new connector from item `fromId` (or the free point `start`). */
export function drawConnector(ctx, { fromId = '', start }) {
  const color = ctx.colorFor('connector')
  const style = { color, start: 'none', end: 'arrow', dash: false }
  let end = start
  let target = null
  const update = (e, p) => {
    end = p
    const under = ctx.itemAt(e.clientX, e.clientY)
    target = under && under.id !== fromId ? under : null
    const ends = arrowEnds({ from: fromId, to: target?.id || '', x1: start.x, y1: start.y, x2: p.x, y2: p.y }, ctx.getItem)
    ctx.overlay({ draft: { kind: 'connector', ends, style }, target })
  }
  return {
    move: update,
    up(e, p) {
      update(e, p)
      ctx.overlay({ draft: null, target: null })
      const long = Math.hypot(end.x - start.x, end.y - start.y) > ctx.px(12)
      if (!(fromId && target) && !long) return
      ctx.store.stopCapturing()
      const id = ctx.store.create({ type: 'arrow', ...style, from: fromId, to: target?.id || '', x1: start.x, y1: start.y, x2: end.x, y2: end.y })
      ctx.setTool('select')
      ctx.selection.set([id])
    },
    cancel: () => ctx.overlay({ draft: null, target: null }),
  }
}

/** Gesture that drags one end of connector `arrow` to re-attach it, or to leave it free. */
export function moveConnectorEnd(ctx, arrow, which) {
  const other = which === 'start' ? arrow.to : arrow.from
  ctx.store.stopCapturing()
  return {
    move(e, p) {
      const under = ctx.itemAt(e.clientX, e.clientY)
      const target = under && under.id !== other ? under : null
      const patch =
        which === 'start' ? { from: target?.id || '', x1: p.x, y1: p.y } : { to: target?.id || '', x2: p.x, y2: p.y }
      ctx.store.update({ [arrow.id]: patch })
      ctx.overlay({ target })
    },
    up() {
      ctx.overlay({ target: null })
      ctx.store.stopCapturing()
    },
    cancel: () => ctx.overlay({ target: null }),
  }
}

export function createConnectorTool(ctx) {
  return {
    id: 'connector',
    cursor: 'crosshair',
    down: (e, p) => {
      const from = ctx.itemAt(e.clientX, e.clientY)
      return drawConnector(ctx, { fromId: from?.id || '', start: p })
    },
  }
}
