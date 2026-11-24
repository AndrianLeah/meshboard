// Eraser: drag over pen strokes to delete them (other items are left alone).
import { pathHit } from '../../core/geometry.js'

export function createEraserTool(ctx) {
  return {
    id: 'eraser',
    cursor: 'crosshair',
    down(_e, start) {
      ctx.store.stopCapturing()
      const erase = (p) => {
        const r = ctx.px(8)
        const hit = ctx.list().filter((it) => it.type === 'path' && !it.locked && pathHit(it, p, r))
        if (hit.length) ctx.store.remove(hit.map((it) => it.id))
      }
      erase(start)
      return {
        move: (_e, p) => erase(p),
        up: () => ctx.store.stopCapturing(),
        cancel() {},
      }
    },
  }
}
