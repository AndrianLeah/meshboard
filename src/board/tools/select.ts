// Select: click and shift-click, marquee (also inside frames), move with smart guides
// (⌘ to move freely), ⌥-drag to duplicate, resize handles, connector end handles,
// connection dots and the quick-add "+" of a selected sticky.
import { bounds, contains, intersects, normRect, resizeBox, snap, unionBounds } from '../../core/geometry.ts'
import type { Guide, HandlePosition } from '../../core/geometry.ts'
import { drawConnector, moveConnectorEnd } from './connector.ts'
import { placeNote } from './note.ts'
import type { BoxItem, Item, ItemPatch, Point, Rect } from '../../core/types.ts'
import type { Gesture, QuickAddSide, Tool, ToolContext } from './index.ts'

const DRAG_START = 3 // screen px before a press becomes a drag
const SNAP = 6 // screen px
const GAP = 24 // between a sticky and the one quick-add creates

export function createSelectTool(ctx: ToolContext): Tool {
  const { store } = ctx

  function marquee(e: PointerEvent, start: Point): Gesture {
    const base = e.shiftKey || e.metaKey || e.ctrlKey ? ctx.selection.ids() : []
    if (!base.length) ctx.selection.clear()
    return {
      move(_e, p) {
        const m = normRect(start.x, start.y, p.x, p.y)
        const hits = ctx
          .list()
          .filter((it) => (it.type === 'frame' ? contains(m, it) : intersects(m, bounds(it, ctx.getItem))))
          .map((it) => it.id)
        ctx.selection.set(store.withGroups([...new Set([...base, ...hits])]))
        ctx.overlay({ marquee: m })
      },
      up: () => ctx.overlay({ marquee: null }),
      cancel: () => ctx.overlay({ marquee: null }),
    }
  }

  function move(start: Point): Gesture {
    let moving: Map<string, Item> | null = null // id → item as it was when the drag started
    let others: Rect[] = []
    const begin = (alt: boolean): Map<string, Item> => {
      store.stopCapturing()
      let ids = ctx.withContents(ctx.selection.ids()).filter((id) => !ctx.getItem(id)?.locked)
      if (alt) {
        ids = store.duplicate(ids, 0)
        ctx.selection.set(ids)
      }
      const picked = new Map<string, Item>()
      for (const id of ids) {
        const it = ctx.getItem(id)
        if (it) picked.set(id, it)
      }
      const view = ctx.view.visibleRect()
      others = ctx
        .list()
        .filter((it) => it.type !== 'arrow' && !picked.has(it.id))
        .map((it) => bounds(it, ctx.getItem))
        .filter((b) => intersects(b, view))
      return picked
    }
    return {
      move(ev, p) {
        let dx = p.x - start.x
        let dy = p.y - start.y
        if (!moving) {
          if (Math.hypot(dx, dy) < ctx.px(DRAG_START)) return
          moving = begin(ev.altKey)
        }
        if (!moving.size) return
        const boxes = [...moving.values()].filter((it): it is BoxItem => it.type !== 'arrow')
        let guides: Guide[] = []
        const box = unionBounds(boxes.map((it) => bounds(it, ctx.getItem)))
        if (box && !(ev.metaKey || ev.ctrlKey)) {
          const s = snap({ ...box, x: box.x + dx, y: box.y + dy }, others, ctx.px(SNAP))
          dx += s.dx
          dy += s.dy
          guides = s.guides
        }
        const patches: Record<string, ItemPatch> = {}
        for (const [id, o] of moving) {
          if (o.type === 'arrow') {
            const all = !o.from && !o.to
            if (!o.from || all) Object.assign((patches[id] ??= {}), { x1: o.x1 + dx, y1: o.y1 + dy })
            if (!o.to || all) Object.assign((patches[id] ??= {}), { x2: o.x2 + dx, y2: o.y2 + dy })
          } else patches[id] = { x: Math.round(o.x + dx), y: Math.round(o.y + dy) }
        }
        store.update(patches)
        ctx.overlay({ guides })
      },
      up() {
        ctx.overlay({ guides: [] })
        if (moving) store.stopCapturing()
      },
      cancel: () => ctx.overlay({ guides: [] }),
    }
  }

  function resize(it: BoxItem, pos: HandlePosition): Gesture {
    store.stopCapturing()
    const keepCorners = it.type === 'note' || it.type === 'path'
    return {
      move(e, p) {
        const r = resizeBox(it, pos, p, { keepRatio: keepCorners || e.shiftKey, min: it.type === 'path' ? 4 : 20 })
        // a text box's height follows its text
        const patch: ItemPatch = it.type === 'text' ? { x: r.x, y: r.y, w: r.w } : r
        store.update({ [it.id]: patch })
        if (it.type === 'text') ctx.measure(it.id)
      },
      up: () => store.stopCapturing(),
    }
  }

  function quickAdd(side: QuickAddSide) {
    const [it] = ctx.selection.items()
    if (!it || it.type === 'arrow') return
    const offset = { e: [it.w + GAP, 0], s: [0, it.h + GAP], w: [-(it.w + GAP), 0] }[side]
    placeNote(ctx, { x: it.x + it.w / 2 + offset[0], y: it.y + it.h / 2 + offset[1] }, it.color, { w: it.w, h: it.h })
  }

  return {
    id: 'select',
    cursor: 'default',
    down(e, p, hit) {
      switch (hit.kind) {
        case 'handle': {
          const [it] = ctx.selection.items()
          return it && it.type !== 'arrow' ? resize(it, hit.value) : null
        }
        case 'end': {
          const [it] = ctx.selection.items()
          return it?.type === 'arrow' ? moveConnectorEnd(ctx, it, hit.value) : null
        }
        case 'dot':
          return hit.item ? drawConnector(ctx, { fromId: hit.item.id, start: p }) : null
        case 'quick-add':
          quickAdd(hit.value)
          return null
        case 'item': {
          const id = hit.item.id
          if (e.shiftKey || e.metaKey || e.ctrlKey) {
            const group = store.withGroups([id])
            const ids = ctx.selection.ids()
            const next = ctx.selection.has(id) ? ids.filter((x) => !group.includes(x)) : [...ids, ...group]
            ctx.selection.set(next)
            if (!ctx.selection.has(id)) return null
          } else if (!ctx.selection.has(id)) {
            ctx.selection.set(store.withGroups([id]))
          }
          return move(p)
        }
        default:
          return marquee(e, p)
      }
    },
  }
}
