// Text: click to place a text box. Left empty, it disappears when editing stops.
import { DEFAULTS } from '../../core/schema.ts'
import type { Tool, ToolContext } from './index.ts'

export function createTextTool(ctx: ToolContext): Tool {
  return {
    id: 'text',
    cursor: 'text',
    down: () => ({
      up(_e, p) {
        const { w, h, fontSize } = DEFAULTS.text
        ctx.store.stopCapturing()
        const id = ctx.store.create({
          type: 'text',
          x: Math.round(p.x - 8),
          y: Math.round(p.y - h / 2),
          w,
          h,
          fontSize,
          color: ctx.colorFor('text'),
        })
        ctx.setTool('select')
        ctx.startEditing(id, { fresh: true })
      },
    }),
  }
}
