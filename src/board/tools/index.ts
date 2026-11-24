// The board's tools. Each one is `{ id, cursor, down(e, p, hit) }`; `down` returns a gesture
// that receives the rest of the drag, or nothing.
import { createSelectTool } from './select.ts'
import { createHandTool } from './hand.ts'
import { createNoteTool } from './note.ts'
import { createTextTool } from './text.ts'
import { createShapeTool } from './shape.ts'
import { createConnectorTool } from './connector.ts'
import { createPenTool } from './pen.ts'
import { createEraserTool } from './eraser.ts'
import { createFrameTool } from './frame.ts'
import { SHAPES } from '../../core/schema.ts'
import type { Store } from '../../core/store.ts'
import type { HandlePosition } from '../../core/geometry.ts'
import type { ColorKey, Item, Point, ShapeType } from '../../core/types.ts'
import type { View } from '../view.ts'
import type { OverlayPatch } from '../render/overlay.ts'

export type ToolId = 'select' | 'hand' | 'note' | 'text' | ShapeType | 'connector' | 'pen' | 'eraser' | 'frame'

/** Kinds of item that remember the last colour used for them. */
export type ColorKind = 'note' | 'shape' | 'text' | 'connector' | 'pen'

/** The rest of a drag, after `down`. */
export interface Gesture {
  move?(e: PointerEvent, p: Point): void
  up?(e: PointerEvent, p: Point): void
  cancel?(): void
}

/** What a press landed on. A frame's inside counts as canvas: a drag there draws a marquee. */
export type Hit =
  | { kind: 'canvas'; frame?: string }
  | { kind: 'item'; item: Item }
  | { kind: 'handle'; value: HandlePosition }
  | { kind: 'end'; value: 'start' | 'end' }
  | { kind: 'dot'; value: string; item: Item | undefined }
  | { kind: 'quick-add'; value: QuickAddSide }

export type QuickAddSide = 'e' | 's' | 'w'

export interface Selection {
  ids(): string[]
  items(): Item[]
  has(id: string): boolean
  set(ids: readonly string[]): void
  clear(): void
}

/** What a tool may ask of the board. */
export interface ToolContext {
  store: Store
  view: View
  getItem(id: string): Item | undefined
  /** every item, bottom to top */
  list(): readonly Item[]
  selection: Selection
  /** shows a marquee, guides, a draft or a target over the items */
  overlay(patch: OverlayPatch): void
  setTool(id: ToolId): void
  startEditing(id: string, options?: { fresh?: boolean }): void
  /** the last colour used for a kind of item */
  colorFor(kind: ColorKind): ColorKey
  /** `ids` plus what's inside the frames among them */
  withContents(ids: readonly string[]): string[]
  /** the item a connector can attach to under a screen point */
  itemAt(clientX: number, clientY: number): Item | null
  /** stores the height a text box takes */
  measure(id: string): void
  /** n screen pixels in board units */
  px(n: number): number
  pan(e: { clientX: number; clientY: number }): Gesture
}

export interface Tool {
  id: ToolId
  cursor: string
  down(e: PointerEvent, p: Point, hit: Hit): Gesture | null | void
}

export function createTools(ctx: ToolContext): Map<ToolId, Tool> {
  const tools: Tool[] = [
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
