// Sticky note: click to place one, centred on the pointer, ready to type.
import { DEFAULTS } from '../../core/schema.js'

/** Creates a sticky note centred on `p` and starts editing it. */
export function placeNote(ctx, p, color = ctx.colorFor('note'), size = DEFAULTS.note) {
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

export function createNoteTool(ctx) {
  return {
    id: 'note',
    cursor: 'crosshair',
    // placed on release: focusing the new note on press would lose focus to the click that follows
    down: () => ({ move() {}, up: (_e, p) => placeNote(ctx, p), cancel() {} }),
  }
}
