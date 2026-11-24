// The board's tools. Each one is `{ id, cursor, down(e, p, hit) }`; `down` returns a gesture
// `{ move(e, p), up(e, p), cancel() }` that receives the rest of the drag, or null.
//
// Tools talk to the board through `ctx`:
//   store, view, getItem(id), list()
//   selection: ids(), items(), has(id), set(ids), clear()
//   overlay(patch)            marquee, guides, draft, target shown over the items
//   setTool(id), startEditing(id, { fresh }), colorFor(kind), withContents(ids)
//   itemAt(clientX, clientY)  the item under a screen point
//   px(n)                     n screen pixels in board units
//   pan(e)                    a gesture that pans the view
import { createSelectTool } from './select.js'
import { createHandTool } from './hand.js'
import { createNoteTool } from './note.js'
import { createTextTool } from './text.js'
import { createShapeTool } from './shape.js'
import { createConnectorTool } from './connector.js'
import { createPenTool } from './pen.js'
import { createEraserTool } from './eraser.js'
import { createFrameTool } from './frame.js'
import { SHAPES } from '../../core/schema.js'

export function createTools(ctx) {
  const tools = [
    createSelectTool(ctx),
    createHandTool(ctx),
    createNoteTool(ctx),
    createTextTool(ctx),
    ...SHAPES.map((type) => createShapeTool(ctx, type)),
    createConnectorTool(ctx),
    createPenTool(ctx),
    createEraserTool(ctx),
    createFrameTool(ctx),
  ]
  return new Map(tools.map((t) => [t.id, t]))
}
