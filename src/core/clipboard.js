// Copy and paste, without the DOM: what goes on the clipboard and what a paste turns into.
// Board items travel as JSON inside the HTML flavour (so they survive between tabs and
// browsers), with their text as the plain flavour for other apps.
import { DEFAULTS, sanitizeItem } from './schema.js'
import { bounds, center, unionBounds } from './geometry.js'

const MARK = 'data-meshboard'
const MAX_LINES = 200

function toBase64(text) {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function fromBase64(b64) {
  const bin = atob(b64)
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

/** {text, html} for a list of snapshot() items. */
export function encodeClipboard(items) {
  const text = items
    .map((it) => (typeof it.text === 'string' ? it.text.trim() : ''))
    .filter(Boolean)
    .join('\n\n')
  const payload = toBase64(JSON.stringify({ v: 1, items }))
  const html = `<span ${MARK}="${payload}">${escapeHtml(text || 'Meshboard items')}</span>`
  return { text, html }
}

/**
 * What a paste contains: {items} (Meshboard items), {lines} (plain text, one sticky per line)
 * or null.
 */
export function decodeClipboard({ html = '', text = '' } = {}) {
  const m = html.match(new RegExp(`${MARK}="([A-Za-z0-9+/=]+)"`))
  if (m) {
    try {
      const data = JSON.parse(fromBase64(m[1]))
      if (Array.isArray(data?.items)) return { items: data.items }
    } catch {
      /* not ours after all: fall back to the text */
    }
  }
  const lines = String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, MAX_LINES)
  return lines.length ? { lines } : null
}

/** Offset that centres the pasted items on `at` (board coordinates). */
export function pasteOffset(items, at) {
  const box = unionBounds(
    items
      .map(sanitizeItem)
      .filter(Boolean)
      .map((it) => bounds(it, () => null)),
  )
  if (!box) return { dx: 0, dy: 0 }
  const c = center(box)
  return { dx: Math.round(at.x - c.x), dy: Math.round(at.y - c.y) }
}

/** One sticky note per line (insert()-ready), in a grid of up to 5 columns centred on `at`. */
export function notesFromLines(lines, at, color = 'yellow') {
  const { w, h } = DEFAULTS.note
  const gap = 24
  const cols = Math.min(5, lines.length)
  const rows = Math.ceil(lines.length / cols)
  const x0 = at.x - (cols * w + (cols - 1) * gap) / 2
  const y0 = at.y - (rows * h + (rows - 1) * gap) / 2
  return lines.map((text, i) => ({
    id: `line-${i}`,
    type: 'note',
    color,
    text,
    w,
    h,
    x: Math.round(x0 + (i % cols) * (w + gap)),
    y: Math.round(y0 + Math.floor(i / cols) * (h + gap)),
  }))
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}
