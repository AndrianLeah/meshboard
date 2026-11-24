// Everything drawn over the items: selection outlines and handles, quick-add "+", connection
// dots, connector end handles, smart guides, the marquee, drafts of what's being drawn and the
// highlighted connector target. Sizes that must stay constant on screen use var(--inv).
import { h, svg, cls, icon } from '../../ui/ds/index.ts'
import { arrowEnds, bounds, unionBounds } from '../../core/geometry.ts'
import type { Guide, HandlePosition, Lookup } from '../../core/geometry.ts'
import { shapePath } from './items.ts'
import { connectorShape } from './connectors.ts'
import type { ConnectorStyle } from './connectors.ts'
import type { BoxItem, ColorKey, Item, Point, Rect, Segment, ShapeType } from '../../core/types.ts'

/** What's being drawn, before it exists. */
export type Draft =
  | { kind: 'box'; type: ShapeType | 'frame' | 'note'; color: ColorKey; rect: Rect }
  | { kind: 'connector'; ends: Segment; style: ConnectorStyle }
  | { kind: 'stroke'; d: string; color: ColorKey; width: number }

/** What the tools draw over the items while they work. */
export interface OverlayLayers {
  marquee: Rect | null
  guides: Guide[]
  draft: Draft | null
  target: Item | null
}
export type OverlayPatch = Partial<OverlayLayers>

export interface OverlayState extends OverlayLayers {
  selected: readonly Item[]
  getItem: Lookup
  editingId: string | undefined
  /** a gesture is running: no handles */
  busy: boolean
  hovered: Item | null | undefined
}

type Side = 'n' | 'e' | 's' | 'w'

const CORNERS: HandlePosition[] = ['nw', 'ne', 'se', 'sw']
const ALL: HandlePosition[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** Which resize handles an item gets. */
function handlesFor(it: BoxItem): HandlePosition[] {
  if (it.locked) return []
  if (it.type === 'note' || it.type === 'path') return CORNERS
  if (it.type === 'text') return ['e', 'w']
  return ALL
}

const SIDES: Record<Side, (b: Rect) => Point> = {
  n: (b) => ({ x: b.x + b.w / 2, y: b.y }),
  e: (b) => ({ x: b.x + b.w, y: b.y + b.h / 2 }),
  s: (b) => ({ x: b.x + b.w / 2, y: b.y + b.h }),
  w: (b) => ({ x: b.x, y: b.y + b.h / 2 }),
}

function handlePoint(b: Rect, pos: HandlePosition): Point {
  return {
    x: b.x + (pos.includes('e') ? b.w : pos.includes('w') ? 0 : b.w / 2),
    y: b.y + (pos.includes('s') ? b.h : pos.includes('n') ? 0 : b.h / 2),
  }
}

const at = <T extends HTMLElement>(el: T, p: Point): T => {
  el.style.left = `${p.x}px`
  el.style.top = `${p.y}px`
  return el
}

function box(className: string, r: Rect): HTMLDivElement {
  const el = h('div', { class: className })
  el.style.transform = `translate(${r.x}px, ${r.y}px)`
  el.style.width = `${r.w}px`
  el.style.height = `${r.h}px`
  return el
}

export function createOverlay(root: HTMLElement) {
  const lines = svg('svg', { class: 'overlay__svg', 'aria-hidden': 'true' })
  const layer = h('div', { class: 'overlay__layer' })
  root.append(lines, layer)

  function render(state: OverlayState) {
    const { selected, getItem, editingId, busy, hovered, marquee, guides = [], draft, target } = state
    const frag = document.createDocumentFragment()
    const svgFrag = document.createDocumentFragment()
    const single = selected.length === 1 ? selected[0] : null

    // selection
    if (selected.length > 1) {
      for (const it of selected) {
        if (it.type === 'arrow')
          svgFrag.append(connectorShape(arrowEnds(it, getItem), it, { class: 'overlay__connector' }))
        else frag.append(box('overlay__outline', bounds(it, getItem)))
      }
      const all = unionBounds(selected.map((it) => bounds(it, getItem)))
      if (all) frag.append(box('overlay__selection', all))
    } else if (single && single.type !== 'arrow') {
      const b = bounds(single, getItem)
      frag.append(box(cls('overlay__selection', single.locked && 'is-locked'), b))
      if (!busy && editingId !== single.id) {
        for (const pos of handlesFor(single)) {
          frag.append(at(h('div', { class: 'overlay__handle', dataset: { handle: pos } }), handlePoint(b, pos)))
        }
        if (single.locked) frag.append(at(h('div', { class: 'overlay__lock' }, icon('lock')), { x: b.x + b.w, y: b.y }))
        if (single.type === 'note' && !single.locked) {
          for (const side of ['e', 's', 'w'] as const) {
            frag.append(
              at(
                h(
                  'button',
                  {
                    type: 'button',
                    class: cls('overlay__quick-add', `overlay__quick-add--${side}`),
                    'aria-label': 'Add a sticky note here',
                    dataset: { quickAdd: side },
                  },
                  icon('plus'),
                ),
                SIDES[side](b),
              ),
            )
          }
        }
      }
    } else if (single?.type === 'arrow') {
      const e = arrowEnds(single, getItem)
      svgFrag.append(connectorShape(e, single, { class: 'overlay__connector' }))
      if (!busy && !single.locked) {
        frag.append(at(h('div', { class: 'overlay__end', dataset: { end: 'start' } }), { x: e.x1, y: e.y1 }))
        frag.append(at(h('div', { class: 'overlay__end', dataset: { end: 'end' } }), { x: e.x2, y: e.y2 }))
      }
    }

    // connection dots on the hovered item (not on a sticky that already shows its "+" buttons)
    const quickAdding = single?.type === 'note' && !single.locked && editingId !== single.id
    if (hovered && !busy && editingId !== hovered.id && !(quickAdding && hovered.id === single?.id)) {
      const b = bounds(hovered, getItem)
      for (const side of Object.keys(SIDES) as Side[]) {
        frag.append(
          at(h('div', { class: cls('overlay__dot', `overlay__dot--${side}`), dataset: { dot: side } }), SIDES[side](b)),
        )
      }
    }

    if (target) frag.append(box('overlay__target', bounds(target, getItem)))
    if (marquee) frag.append(box('overlay__marquee', marquee))

    for (const g of guides)
      svgFrag.append(svg('line', { class: 'overlay__guide', x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2 }))

    if (draft?.kind === 'box') {
      const r = draft.rect
      if (draft.type === 'frame') frag.append(box('overlay__draft-frame', r))
      else if (draft.type === 'note') frag.append(box('overlay__draft-note', r))
      else {
        const g = svg('g', { transform: `translate(${r.x} ${r.y})`, style: `--stroke: var(--stroke-${draft.color})` })
        g.append(
          svg('path', { class: 'overlay__draft-shape', d: shapePath(draft.type, Math.max(r.w, 2), Math.max(r.h, 2)) }),
        )
        svgFrag.append(g)
      }
    } else if (draft?.kind === 'connector') {
      svgFrag.append(connectorShape(draft.ends, draft.style, { class: 'overlay__draft-connector' }))
    } else if (draft?.kind === 'stroke') {
      svgFrag.append(
        svg('path', {
          class: 'overlay__draft-stroke',
          d: draft.d,
          style: `--stroke: var(--stroke-${draft.color})`,
          'stroke-width': draft.width,
        }),
      )
    }

    layer.replaceChildren(frag)
    lines.replaceChildren(svgFrag)
  }

  return { render, destroy: () => root.replaceChildren() }
}
