// Geometria pura: nessun accesso al DOM né allo stato condiviso.

export function center(it) {
  return { x: it.x + it.w / 2, y: it.y + it.h / 2 }
}

/** Punto sul bordo di `it` lungo la retta dal suo centro verso `toward`. */
export function edgePoint(it, toward, gap = 6) {
  const c = center(it)
  const dx = toward.x - c.x
  const dy = toward.y - c.y
  if (dx === 0 && dy === 0) return c
  const hw = it.w / 2 + gap
  const hh = it.h / 2 + gap
  let t
  if (it.type === 'ellipse') {
    t = 1 / Math.sqrt((dx / hw) ** 2 + (dy / hh) ** 2)
  } else {
    t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity)
  }
  return { x: c.x + dx * t, y: c.y + dy * t }
}

/**
 * Estremi effettivi di una freccia. Un estremo agganciato a un elemento
 * segue l'elemento; uno libero usa le coordinate salvate.
 */
export function arrowEnds(a, getItem) {
  const from = a.from ? getItem(a.from) : null
  const to = a.to ? getItem(a.to) : null
  const free1 = { x: a.x1, y: a.y1 }
  const free2 = { x: a.x2, y: a.y2 }
  const aim1 = from ? center(from) : free1
  const aim2 = to ? center(to) : free2
  const p1 = from ? edgePoint(from, aim2) : free1
  const p2 = to ? edgePoint(to, aim1) : free2
  return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }
}

/** Rettangolo che contiene un elemento (frecce comprese). */
export function bounds(it, getItem) {
  if (it.type === 'arrow') {
    const e = arrowEnds(it, getItem)
    return {
      x: Math.min(e.x1, e.x2),
      y: Math.min(e.y1, e.y2),
      w: Math.abs(e.x2 - e.x1),
      h: Math.abs(e.y2 - e.y1),
    }
  }
  return { x: it.x, y: it.y, w: it.w, h: it.h }
}

export function intersects(a, b) {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h
}

export function normRect(x1, y1, x2, y2) {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) }
}
