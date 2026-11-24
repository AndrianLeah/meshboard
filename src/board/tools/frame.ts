// Frame: drag to draw a titled sheet that carries what's inside it.
import { drawBox } from './draw-box.ts'
import type { Tool, ToolContext } from './index.ts'

export function createFrameTool(ctx: ToolContext): Tool {
  return {
    id: 'frame',
    cursor: 'crosshair',
    down: (_e, p) =>
      drawBox(ctx, p, {
        type: 'frame',
        color: 'gray',
        create: (box) => {
          const n = ctx.list().filter((it) => it.type === 'frame').length + 1
          return ctx.store.create({ type: 'frame', text: `Frame ${n}`, ...box })
        },
      }),
  }
}
