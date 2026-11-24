// Pure geometry: bounds, hit tests, connector ends, snapping. No DOM, no shared state.
import type { ArrowItem, Item, ItemData, PathItem, Point, Rect, Segment } from './types.ts'

/** Finds an item by id (the board's cache or the store). */
export type Lookup = (id: string) => Item | null | undefined

/** A guide line to draw while snapping. */
export type Guide = Segment

type ConnectorEnds = Pick<ArrowItem, 'from' | 'to' | 'x1' | 'y1' | 'x2' | 'y2'>

export const center = (b: Rect): Point => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })

export function normRect(x1: number, y1: number, x2: number, y2: number): Rect {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) }
}

export const intersects = (a: Rect, b: Rect): boolean =>
  a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h

export const contains = (outer: Rect, inner: Rect): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.w <= outer.x + outer.w &&
  inner.y + inner.h <= outer.y + outer.h

/** The smallest box around `rects`, or null when there are none. */
export function unionBounds(rects: Iterable<Rect>): Rect | null {
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  for (const r of rects) {
    x1 = Math.min(x1, r.x)
    y1 = Math.min(y1, r.y)
    x2 = Math.max(x2, r.x + r.w)
    y2 = Math.max(y2, r.y + r.h)
  }
  return Number.isFinite(x1) ? { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : null
}

/** Point on the outline of `it`, on the line from its centre towards `toward`, `gap` outside it. */
export function edgePoint(it: Rect & { type: string }, toward: Point, gap = 6): Point {
  const c = center(it)
  const dx = toward.x - c.x
  const dy = toward.y - c.y
  if (!dx && !dy) return c
  const hw = it.w / 2 + gap
  const hh = it.h / 2 + gap
  let t: number
  if (it.type === 'ellipse') t = 1 / Math.hypot(dx / hw, dy / hh)
  else if (it.type === 'diamond') t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh)
  else t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity)
  return { x: c.x + dx * t, y: c.y + dy * t }
}

/** Actual end points of a connector: an end attached to an item follows it, a free end keeps its point. */
export function arrowEnds(a: ConnectorEnds, getItem: Lookup): Segment {
  const attached = (id: string) => {
    const it = id ? getItem(id) : null
    return it && it.type !== 'arrow' ? it : null
  }
  const from = attached(a.from)
  const to = attached(a.to)
  const free1 = { x: a.x1, y: a.y1 }
  const free2 = { x: a.x2, y: a.y2 }
  const aim1 = from ? center(from) : free1
  const aim2 = to ? center(to) : free2
  const p1 = from ? edgePoint(from, aim2) : free1
  const p2 = to ? edgePoint(to, aim1) : free2
  return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }
}

/** The box an item covers. */
export function bounds(it: Item | ItemData, getItem: Lookup): Rect {
  if (it.type === 'arrow') {
    const e = arrowEnds(it, getItem)
    return normRect(e.x1, e.y1, e.x2, e.y2)
  }
  return { x: it.x, y: it.y, w: it.w, h: it.h }
}

export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = dx * dx + dy * dy
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Whether a pen stroke passes within `radius` of point `p` (board coordinates). */
export function pathHit(
  it: Pick<PathItem, 'x' | 'y' | 'w' | 'h' | 'ow' | 'oh' | 'points' | 'width'>,
  p: Point,
  radius: number,
): boolean {
  const pad = radius + it.width
  if (p.x < it.x - pad || p.x > it.x + it.w + pad || p.y < it.y - pad || p.y > it.y + it.h + pad) return false
  const sx = it.w / it.ow
  const sy = it.h / it.oh
  const pts = it.points
  let prev = { x: it.x + pts[0] * sx, y: it.y + pts[1] * sy }
  for (let i = 2; i < pts.length; i += 2) {
    const cur = { x: it.x + pts[i] * sx, y: it.y + pts[i + 1] * sy }
    if (distToSegment(p, prev, cur) <= pad) return true
    prev = cur
  }
  return false
}

/** Ramer–Douglas–Peucker: fewer points, same stroke. */
export function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    let max = 0
    let index = -1
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(points[i], points[a], points[b])
      if (d > max) {
        max = d
        index = i
      }
    }
    if (max > tolerance && index > 0) {
      keep[index] = 1
      stack.push([a, index], [index, b])
    }
  }
  return points.filter((_, i) => keep[i])
}

/**
 * Smart guides: moves `box` so that its left/centre/right and top/middle/bottom line up with
 * the same lines of `others` when within `threshold`. Returns the correction and the guide lines.
 */
export function snap(box: Rect, others: Rect[], threshold: number): { dx: number; dy: number; guides: Guide[] } {
  const xs = [box.x, box.x + box.w / 2, box.x + box.w]
  const ys = [box.y, box.y + box.h / 2, box.y + box.h]
  let bestX: { d: number; line: number } | null = null
  let bestY: { d: number; line: number } | null = null
  for (const o of others) {
    for (const ox of [o.x, o.x + o.w / 2, o.x + o.w]) {
      for (const x of xs) {
        const d = ox - x
        if (Math.abs(d) <= threshold && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, line: ox }
      }
    }
    for (const oy of [o.y, o.y + o.h / 2, o.y + o.h]) {
      for (const y of ys) {
        const d = oy - y
        if (Math.abs(d) <= threshold && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, line: oy }
      }
    }
  }
  const dx = bestX ? bestX.d : 0
  const dy = bestY ? bestY.d : 0
  const moved = { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h }
  const guides: Guide[] = []
  const eq = (a: number, b: number) => Math.abs(a - b) < 0.5
  if (bestX) {
    const line = bestX.line
    const touching = others.filter((o) => [o.x, o.x + o.w / 2, o.x + o.w].some((v) => eq(v, line)))
    const span = unionBounds([moved, ...touching])!
    guides.push({ x1: line, y1: span.y, x2: line, y2: span.y + span.h })
  }
  if (bestY) {
    const line = bestY.line
    const touching = others.filter((o) => [o.y, o.y + o.h / 2, o.y + o.h].some((v) => eq(v, line)))
    const span = unionBounds([moved, ...touching])!
    guides.push({ x1: span.x, y1: line, x2: span.x + span.w, y2: line })
  }
  return { dx, dy, guides }
}

/** A resize handle: a corner or the middle of a side. */
export type HandlePosition = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'

/**
 * Resizes box `o` by dragging the handle at `pos` to point `p`. `keepRatio` keeps o's
 * proportions (corner handles only); `min` is the smallest side.
 */
export function resizeBox(
  o: Rect,
  pos: HandlePosition,
  p: Point,
  { keepRatio = false, min = 20 }: { keepRatio?: boolean; min?: number } = {},
): Rect {
  let x1 = o.x
  let y1 = o.y
  let x2 = o.x + o.w
  let y2 = o.y + o.h
  if (pos.includes('w')) x1 = Math.min(p.x, x2 - min)
  if (pos.includes('e')) x2 = Math.max(p.x, x1 + min)
  if (pos.includes('n')) y1 = Math.min(p.y, y2 - min)
  if (pos.includes('s')) y2 = Math.max(p.y, y1 + min)
  if (keepRatio && pos.length === 2 && o.w > 0 && o.h > 0) {
    const ratio = o.w / o.h
    let w = x2 - x1
    let h = y2 - y1
    if (w / h > ratio) w = h * ratio
    else h = w / ratio
    if (pos.includes('w')) x1 = x2 - w
    else x2 = x1 + w
    if (pos.includes('n')) y1 = y2 - h
    else y2 = y1 + h
  }
  return { x: Math.round(x1), y: Math.round(y1), w: Math.round(x2 - x1), h: Math.round(y2 - y1) }
}

/** The box dragged from `a` to `b`; `square` forces equal sides (Shift). */
export function dragBox(a: Point, b: Point, square = false): Rect {
  let w = b.x - a.x
  let h = b.y - a.y
  if (square) {
    const s = Math.max(Math.abs(w), Math.abs(h))
    w = Math.sign(w || 1) * s
    h = Math.sign(h || 1) * s
  }
  return normRect(a.x, a.y, a.x + w, a.y + h)
}
