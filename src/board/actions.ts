// What the commands do to the selection: delete, duplicate, nudge, colour, order, group, lock,
// copy and paste. Built on the tools' context, so it runs (and is tested) without a DOM.
import { bounds, unionBounds } from '../core/geometry.ts'
import { isShape } from '../core/schema.ts'
import { decodeClipboard, notesFromLines, pasteOffset } from '../core/clipboard.ts'
import type { ClipboardContent } from '../core/clipboard.ts'
import type { ReorderMode } from '../core/store.ts'
import type { ArrowItem, ColorKey, Item, ItemPatch, ItemType, Point, Rect, TextItem } from '../core/types.ts'
import type { ColorKind, ToolContext } from './tools/index.ts'

export type Actions = ReturnType<typeof createActions>

const GAP = 24

/** Which "last colour" an item type updates: shapes share one, frames have none. */
export const colorKind = (type: ItemType): ColorKind | null =>
  type === 'note'
    ? 'note'
    : isShape({ type })
      ? 'shape'
      : type === 'arrow'
        ? 'connector'
        : type === 'path'
          ? 'pen'
          : type === 'text'
            ? 'text'
            : null

/** `pasteAt` is where pasted content is centred (the pointer, or the middle of the screen). */
export function createActions(
  ctx: ToolContext,
  { rememberColor, pasteAt }: { rememberColor: (kind: ColorKind, color: ColorKey) => void; pasteAt: () => Point },
) {
  const { store, selection } = ctx
  const ids = () => selection.ids()
  const editable = (list: readonly string[]): Item[] =>
    list.map(ctx.getItem).filter((it): it is Item => Boolean(it) && !it!.locked)
  const selectionBounds = (): Rect | null => unionBounds(selection.items().map((it) => bounds(it, ctx.getItem)))

  function moveBy(list: readonly string[], dx: number, dy: number) {
    const patches: Record<string, ItemPatch> = {}
    for (const it of editable(ctx.withContents(list))) {
      if (it.type === 'arrow') {
        if (!it.from) patches[it.id] = { x1: it.x1 + dx, y1: it.y1 + dy }
        if (!it.to) Object.assign((patches[it.id] ??= {}), { x2: it.x2 + dx, y2: it.y2 + dy })
      } else patches[it.id] = { x: it.x + dx, y: it.y + dy }
    }
    store.update(patches)
  }

  return {
    selectionBounds,

    /** Deletes the selection (frames with their contents), except what's locked. */
    deleteSelection() {
      const gone = editable(ctx.withContents(ids())).map((it) => it.id)
      if (!gone.length) return
      store.stopCapturing()
      store.remove(gone)
      selection.clear()
    },
    duplicateSelection() {
      if (!ids().length) return
      store.stopCapturing()
      selection.set(store.duplicate(ctx.withContents(ids())))
    },
    /** ⌥ + arrow: a copy right next to the selection, on that side. */
    duplicateBeside(dx: number, dy: number) {
      const b = selectionBounds()
      if (!b) return
      store.stopCapturing()
      const copies = store.insert(store.snapshot(store.withGroups(ctx.withContents(ids()))), {
        dx: dx * (b.w + GAP),
        dy: dy * (b.h + GAP),
      })
      selection.set(copies)
    },
    /** Arrow keys: move the selection, or the view when nothing is selected. */
    nudge(dx: number, dy: number) {
      if (ids().length) moveBy(ids(), dx, dy)
      else ctx.view.panBy(-dx * 8, -dy * 8)
    },
    setColor(color: ColorKey) {
      const patches: Record<string, ItemPatch> = {}
      for (const it of editable(ids())) {
        if (it.type === 'frame') continue
        patches[it.id] = { color }
        const kind = colorKind(it.type)
        if (kind) rememberColor(kind, color)
      }
      store.stopCapturing()
      store.update(patches)
    },
    setTextSize(fontSize: number) {
      const texts = editable(ids()).filter((it): it is TextItem => it.type === 'text')
      store.stopCapturing()
      store.update(Object.fromEntries(texts.map((it) => [it.id, { fontSize }])))
      // the height follows the new size once it's drawn
      requestAnimationFrame(() => texts.forEach((it) => ctx.measure(it.id)))
    },
    setConnectorStyle(patch: Partial<Pick<ArrowItem, 'start' | 'end' | 'dash'>>) {
      const arrows = editable(ids()).filter((it) => it.type === 'arrow')
      store.stopCapturing()
      store.update(Object.fromEntries(arrows.map((it) => [it.id, patch])))
    },
    reorder(mode: ReorderMode) {
      if (!ids().length) return
      store.stopCapturing()
      store.reorder(ids(), mode)
    },
    group() {
      store.stopCapturing()
      store.group(ids())
    },
    ungroup() {
      store.stopCapturing()
      store.ungroup(ids())
    },
    /** Locks everything selected, or unlocks it all when it's all locked already. */
    toggleLock() {
      const list = selection.items()
      if (!list.length) return
      store.stopCapturing()
      store.setLocked(
        list.map((it) => it.id),
        list.some((it) => !it.locked),
      )
    },
    /** Snapshot of the selection (frames with their contents) for the clipboard. */
    copySelection: () => store.snapshot(ctx.withContents(ids())),
    /**
     * Pastes clipboard content ({html, text} as read, or already decoded {items} / {lines}),
     * centred on `pasteAt()`. Returns whether anything was pasted.
     */
    paste(content: ClipboardContent | { html?: string; text?: string }): boolean {
      const data = 'items' in content || 'lines' in content ? (content as ClipboardContent) : decodeClipboard(content)
      if (!data) return false
      const at = pasteAt()
      store.stopCapturing()
      const pasted =
        'items' in data
          ? store.insert(data.items, pasteOffset(data.items, at))
          : store.insert(notesFromLines(data.lines, at, ctx.colorFor('note')))
      store.stopCapturing()
      selection.set(pasted)
      return pasted.length > 0
    },
    toggleReaction(id: string, emoji: string) {
      store.stopCapturing()
      store.toggleReaction(id, emoji)
    },
  }
}
