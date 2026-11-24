// Select: click and shift-click, marquee (also inside frames), move with smart guides
// (⌘ to move freely), ⌥-drag to duplicate, resize handles, connector end handles,
// connection dots and the quick-add "+" of a selected sticky.
import { bounds, contains, intersects, normRect, resizeBox, snap, unionBounds } from '../../core/geometry.js'
import { drawConnector, moveConnectorEnd } from './connector.js'
import { placeNote } from './note.js'

const DRAG_START = 3 // screen px before a press becomes a drag
const SNAP = 6 // screen px
const GAP = 24 // between a sticky and the one quick-add creates

export function createSelectTool(ctx) {
  const { store } = ctx

  function marquee(e, start) {
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

  function move(e, start) {
    let moving = null // id → item as it was when the drag started
    let others = []
    const begin = (alt) => {
      store.stopCapturing()
      let ids = ctx.withContents(ctx.selection.ids()).filter((id) => !ctx.getItem(id)?.locked)
      if (alt) {
        ids = store.duplicate(ids, 0)
        ctx.selection.set(ids)
      }
      moving = new Map(ids.map((id) => [id, ctx.getItem(id)]).filter(([, it]) => it))
      const view = ctx.view.visibleRect()
      others = ctx
        .list()
        .filter((it) => it.type !== 'arrow' && !moving.has(it.id))
        .map((it) => bounds(it, ctx.getItem))
        .filter((b) => intersects(b, view))
    }
    return {
      move(ev, p) {
        let dx = p.x - start.x
        let dy = p.y - start.y
        if (!moving) {
          if (Math.hypot(dx, dy) < ctx.px(DRAG_START)) return
          begin(ev.altKey)
          if (!moving.size) return
        }
        const boxes = [...moving.values()].filter((it) => it.type !== 'arrow')
        let guides = []
        if (boxes.length && !(ev.metaKey || ev.ctrlKey)) {
          const box = unionBounds(boxes.map((it) => bounds(it, ctx.getItem)))
          const s = snap({ ...box, x: box.x + dx, y: box.y + dy }, others, ctx.px(SNAP))
          dx += s.dx
          dy += s.dy
          guides = s.guides
        }
        const patches = {}
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
      get dragging() {
        return Boolean(moving)
      },
    }
  }

  function resize(it, pos) {
    store.stopCapturing()
    const keepCorners = it.type === 'note' || it.type === 'path'
    return {
      move(e, p) {
        const r = resizeBox(it, pos, p, { keepRatio: keepCorners || e.shiftKey, min: it.type === 'path' ? 4 : 20 })
        if (it.type === 'text') delete r.h
        store.update({ [it.id]: r })
        if (it.type === 'text') ctx.measure(it.id)
      },
      up: () => store.stopCapturing(),
      cancel() {},
    }
  }

  function quickAdd(side) {
    const [it] = ctx.selection.items()
    if (!it) return
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
          return it ? resize(it, hit.value) : null
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
          return move(e, p)
        }
        default:
          return marquee(e, p)
      }
    },
  }
}
