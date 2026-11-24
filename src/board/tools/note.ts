// Sticky note: click to place one, centred on the pointer, ready to type.
import { DEFAULTS } from '../../core/schema.ts'
import type { ColorKey, Point } from '../../core/types.ts'
import type { Tool, ToolContext } from './index.ts'

/** Creates a sticky note centred on `p` and starts editing it. Returns its id. */
export function placeNote(
  ctx: ToolContext,
  p: Point,
  color: ColorKey = ctx.colorFor('note'),
  size: { w: number; h: number } = DEFAULTS.note,
): string {
  ctx.store.stopCapturing()
  const id = ctx.store.create({
    type: 'note',
    x: Math.round(p.x - size.w / 2),
    y: Math.round(p.y - size.h / 2),
    w: size.w,
    h: size.h,
    color,
  })
  ctx.setTool('select')
  ctx.startEditing(id, { fresh: true })
  return id
}

export function createNoteTool(ctx: ToolContext): Tool {
  return {
    id: 'note',
    cursor: 'crosshair',
    // placed on release: focusing the new note on press would lose focus to the click that follows
    down: () => ({ up: (_e, p) => void placeNote(ctx, p) }),
  }
}
