// Eraser: drag over pen strokes to delete them (other items are left alone).
import { pathHit } from '../../core/geometry.ts'
import type { PathItem, Point } from '../../core/types.ts'
import type { Tool, ToolContext } from './index.ts'

export function createEraserTool(ctx: ToolContext): Tool {
  return {
    id: 'eraser',
    cursor: 'crosshair',
    down(_e, start) {
      ctx.store.stopCapturing()
      const erase = (p: Point) => {
        const r = ctx.px(8)
        const hit = ctx.list().filter((it): it is PathItem => it.type === 'path' && !it.locked && pathHit(it, p, r))
        if (hit.length) ctx.store.remove(hit.map((it) => it.id))
      }
      erase(start)
      return {
        move: (_e, p) => erase(p),
        up: () => ctx.store.stopCapturing(),
      }
    },
  }
}
