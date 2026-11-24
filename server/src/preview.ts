// What the dashboard shows of a board: its title, and a small drawing of its items (no text). Items
// are read through the same sanitising the app uses, so nothing a client wrote ends up in the SVG
// unchecked: only numbers clamped by the schema and colours from a fixed palette.
import * as Y from 'yjs'
import { createStore } from '../../src/core/store.ts'
import { arrowEnds, bounds, unionBounds } from '../../src/core/geometry.ts'
import type { ColorKey, Item } from '../../src/core/types.ts'

const W = 320
const H = 180
const PAD = 12
const MAX_ITEMS = 1500

// the palette of mockup/tokens (note fill, stroke)
const PALETTE: Record<ColorKey, [string, string]> = {
  yellow: ['#fff1a1', '#d99a00'],
  orange: ['#ffd6a5', '#e8590c'],
  red: ['#ffc4c4', '#e03131'],
  pink: ['#fbc4dc', '#d6336c'],
  purple: ['#ddd3ff', '#7048e8'],
  blue: ['#c4dcff', '#1c6fd6'],
  green: ['#c6efcb', '#2b8a3e'],
  gray: ['#e7eaee', '#3d4654'],
}

const SERVER_USER = { id: 'meshboard', name: 'Meshboard' }

/** A store over a copy of `state`, to read a board on the server. */
export function storeFrom(state: Uint8Array | null) {
  const store = createStore(SERVER_USER)
  if (state && state.byteLength) Y.applyUpdate(store.doc, state)
  return store
}

const n = (v: number) => (Math.round(v * 10) / 10).toString()

/** The board's items as a small SVG, or null when it's empty. */
export function renderPreview(items: readonly Item[]): string | null {
  const list = items.slice(0, MAX_ITEMS)
  const byId = new Map(list.map((it) => [it.id, it]))
  const get = (id: string) => byId.get(id) ?? null
  const box = unionBounds(list.map((it) => bounds(it, get)))
  if (!box) return null
  const scale = Math.min((W - PAD * 2) / Math.max(box.w, 1), (H - PAD * 2) / Math.max(box.h, 1), 0.5)
  const ox = (W - box.w * scale) / 2 - box.x * scale
  const oy = (H - box.h * scale) / 2 - box.y * scale
  const X = (v: number) => n(v * scale + ox)
  const Y_ = (v: number) => n(v * scale + oy)
  const S = (v: number) => n(Math.max(v * scale, 0.5))

  // frames first, then by their order on the board
  const ordered = [...list].sort((a, b) => Number(b.type === 'frame') - Number(a.type === 'frame') || a.z - b.z)
  const shapes: string[] = []
  for (const it of ordered) {
    const [fill, stroke] = PALETTE[it.color] ?? PALETTE.gray
    if (it.type === 'arrow') {
      const e = arrowEnds(it, get)
      shapes.push(
        `<line x1="${X(e.x1)}" y1="${Y_(e.y1)}" x2="${X(e.x2)}" y2="${Y_(e.y2)}" stroke="${stroke}" stroke-width="1"/>`,
      )
      continue
    }
    const x = X(it.x)
    const y = Y_(it.y)
    const w = S(it.w)
    const h = S(it.h)
    switch (it.type) {
      case 'frame':
        shapes.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="#ffffff" stroke="#e3e6eb"/>`)
        break
      case 'note':
        shapes.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`)
        break
      case 'text':
        shapes.push(
          `<rect x="${x}" y="${Y_(it.y + it.h / 2 - 4)}" width="${w}" height="${S(8)}" rx="1" fill="#cdd2da"/>`,
        )
        break
      case 'ellipse':
        shapes.push(
          `<ellipse cx="${X(it.x + it.w / 2)}" cy="${Y_(it.y + it.h / 2)}" rx="${S(it.w / 2)}" ry="${S(it.h / 2)}" fill="${fill}" stroke="${stroke}"/>`,
        )
        break
      case 'triangle':
        shapes.push(
          `<polygon points="${X(it.x + it.w / 2)},${y} ${X(it.x + it.w)},${Y_(it.y + it.h)} ${x},${Y_(it.y + it.h)}" fill="${fill}" stroke="${stroke}"/>`,
        )
        break
      case 'diamond':
        shapes.push(
          `<polygon points="${X(it.x + it.w / 2)},${y} ${X(it.x + it.w)},${Y_(it.y + it.h / 2)} ${X(it.x + it.w / 2)},${Y_(it.y + it.h)} ${x},${Y_(it.y + it.h / 2)}" fill="${fill}" stroke="${stroke}"/>`,
        )
        break
      case 'path': {
        const pts: string[] = []
        const sx = it.ow ? it.w / it.ow : 1
        const sy = it.oh ? it.h / it.oh : 1
        for (let i = 0; i + 1 < it.points.length && pts.length < 400; i += 2)
          pts.push(`${X(it.x + it.points[i] * sx)},${Y_(it.y + it.points[i + 1] * sy)}`)
        if (pts.length > 1)
          shapes.push(
            `<polyline points="${pts.join(' ')}" fill="none" stroke="${stroke}" stroke-width="1" stroke-linecap="round"/>`,
          )
        break
      }
      default:
        // rect and anything added later
        shapes.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1" fill="${fill}" stroke="${stroke}"/>`)
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#f5f5f2"/>${shapes.join('')}</svg>`
}

/** Title, preview and size of a board's state. */
export function describe(state: Uint8Array): { title: string; preview: string | null } {
  const store = storeFrom(state)
  try {
    return { title: store.getTitle().slice(0, 200), preview: renderPreview(store.all()) }
  } finally {
    store.doc.destroy()
  }
}
