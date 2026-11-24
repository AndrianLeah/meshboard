// Shapes (rectangle, oval, triangle, diamond): drag to draw, click for the default size.
import { drawBox } from './draw-box.js'

export function createShapeTool(ctx, type) {
  return {
    id: type,
    cursor: 'crosshair',
    down: (_e, p) => {
      const color = ctx.colorFor('shape')
      return drawBox(ctx, p, { type, color, create: (box) => ctx.store.create({ type, color, ...box }) })
    },
  }
}
