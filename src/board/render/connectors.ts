// Draws connectors (and the one being drawn) as SVG: a wide transparent hit line, the line itself,
// and an arrowhead at each end that has one.
import { svg, cls } from '../../ui/ds/index.ts'
import { arrowEnds } from '../../core/geometry.ts'
import type { Lookup } from '../../core/geometry.ts'
import type { ArrowItem, ColorKey, Item, LineEnd, Point, Segment } from '../../core/types.ts'

export interface ConnectorStyle {
  color: ColorKey
  start: LineEnd
  end: LineEnd
  dash: boolean
}

const HEAD = 14

function head(tip: Point, ux: number, uy: number, size: number): SVGPolygonElement {
  const bx = tip.x - ux * size
  const by = tip.y - uy * size
  const pts = [
    [tip.x, tip.y],
    [bx - uy * size * 0.5, by + ux * size * 0.5],
    [bx + uy * size * 0.5, by - ux * size * 0.5],
  ]
  return svg('polygon', { class: 'connector__head', points: pts.map((p) => p.join(',')).join(' ') })
}

/** A connector between the points of `e`, as an SVG group. */
export function connectorShape(
  e: Segment,
  { start, end, dash, color }: ConnectorStyle,
  attrs: { class?: string | false; 'data-id'?: string } = {},
): SVGGElement {
  const dx = e.x2 - e.x1
  const dy = e.y2 - e.y1
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const size = Math.min(HEAD, len / 3)
  const a = start === 'arrow' ? { x: e.x1 + ux * size, y: e.y1 + uy * size } : { x: e.x1, y: e.y1 }
  const b = end === 'arrow' ? { x: e.x2 - ux * size, y: e.y2 - uy * size } : { x: e.x2, y: e.y2 }
  const g = svg(
    'g',
    {
      'data-id': attrs['data-id'],
      class: cls('connector', dash && 'connector--dashed', attrs.class),
      style: `--stroke: var(--stroke-${color})`,
    },
    svg('line', { class: 'connector__hit', x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2 }),
    svg('line', { class: 'connector__line', x1: a.x, y1: a.y, x2: b.x, y2: b.y }),
  )
  if (start === 'arrow') g.append(head({ x: e.x1, y: e.y1 }, -ux, -uy, size))
  if (end === 'arrow') g.append(head({ x: e.x2, y: e.y2 }, ux, uy, size))
  return g
}

export function createConnectorsRenderer(layer: SVGSVGElement) {
  const group = svg('g')
  layer.append(group)
  let last = ''

  function render(list: readonly Item[], { selection, getItem }: { selection: Set<string>; getItem: Lookup }) {
    const arrows: Array<[ArrowItem, Segment, boolean]> = []
    for (const it of list) {
      if (it.type !== 'arrow') continue
      arrows.push([it, arrowEnds(it, getItem), selection.has(it.id)])
    }
    const sig = JSON.stringify(arrows)
    if (sig === last) return
    last = sig
    group.replaceChildren(
      ...arrows.map(([it, e, selected]) =>
        connectorShape(e, it, { 'data-id': it.id, class: selected && 'is-selected' }),
      ),
    )
  }

  return { render, destroy: () => group.remove() }
}
