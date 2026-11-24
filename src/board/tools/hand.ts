// Hand: drag to pan.
import type { Tool, ToolContext } from './index.ts'

export function createHandTool(ctx: ToolContext): Tool {
  return { id: 'hand', cursor: 'grab', down: (e) => ctx.pan(e) }
}
