// Drag to draw a box (shapes and frames), or click for the default size. Shift keeps it square.
import { dragBox } from '../../core/geometry.js'
import { DEFAULTS } from '../../core/schema.js'

export function drawBox(ctx, start, { type, color, create }) {
  let rect = null
  const boxFor = (e, p) => {
    const r = dragBox(start, p, e.shiftKey)
    if (r.w < ctx.px(6) && r.h < ctx.px(6)) return null
    return r
  }
  return {
    move(e, p) {
      rect = boxFor(e, p)
      ctx.overlay({ draft: rect && { kind: 'box', type, color, rect } })
    },
    up(e, p) {
      rect = boxFor(e, p)
      ctx.overlay({ draft: null })
      const { w, h } = DEFAULTS[type]
      const r = rect || { x: start.x - w / 2, y: start.y - h / 2, w, h }
      ctx.store.stopCapturing()
      const id = create({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(Math.max(r.w, 20)), h: Math.round(Math.max(r.h, 20)) })
      ctx.setTool('select')
      ctx.selection.set([id])
    },
    cancel: () => ctx.overlay({ draft: null }),
  }
}
