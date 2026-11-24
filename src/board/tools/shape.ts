// Shapes (rectangle, oval, triangle, diamond): drag to draw, click for the default size.
import { drawBox } from './draw-box.ts'
import type { ShapeType } from '../../core/types.ts'
import type { Tool, ToolContext } from './index.ts'

export function createShapeTool(ctx: ToolContext, type: ShapeType): Tool {
  return {
    id: type,
    cursor: 'crosshair',
    down: (_e, p) => {
      const color = ctx.colorFor('shape')
      return drawBox(ctx, p, { type, color, create: (box) => ctx.store.create({ type, color, ...box }) })
    },
  }
}
