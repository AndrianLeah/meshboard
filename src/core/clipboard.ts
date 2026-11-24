// Copy and paste, without the DOM: what goes on the clipboard and what a paste turns into.
// Board items travel as JSON inside the HTML flavour (so they survive between tabs and
// browsers), with their text as the plain flavour for other apps.
import { DEFAULTS, sanitizeItem } from './schema.ts'
import { bounds, center, unionBounds } from './geometry.ts'
import type { ColorKey, ItemData, NoteItem, Point } from './types.ts'

const MARK = 'data-meshboard'
const MAX_LINES = 200

/** What a paste holds: board items (untrusted until sanitised), or lines of plain text. */
export type ClipboardContent = { items: unknown[] } | { lines: string[] }

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function fromBase64(b64: string): string {
  const bin = atob(b64)
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** The plain and HTML flavours for a list of snapshot() items. */
export function encodeClipboard(items: readonly object[]): { text: string; html: string } {
  const text = items
    .map((it) => ('text' in it && typeof it.text === 'string' ? it.text.trim() : ''))
    .filter(Boolean)
    .join('\n\n')
  const payload = toBase64(JSON.stringify({ v: 1, items }))
  const html = `<span ${MARK}="${payload}">${escapeHtml(text || 'Meshboard items')}</span>`
  return { text, html }
}

/** What a paste contains, or null when there's nothing to paste. */
export function decodeClipboard({
  html = '',
  text = '',
}: { html?: string; text?: string } = {}): ClipboardContent | null {
  const m = html.match(new RegExp(`${MARK}="([A-Za-z0-9+/=]+)"`))
  if (m) {
    try {
      const data: unknown = JSON.parse(fromBase64(m[1]))
      const items = (data as { items?: unknown } | null)?.items
      if (Array.isArray(items)) return { items }
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

const sanitized = (items: readonly unknown[]) => items.map(sanitizeItem).filter((it): it is ItemData => it !== null)

/** Offset that centres the pasted items on `at` (board coordinates). */
export function pasteOffset(items: readonly unknown[], at: Point): { dx: number; dy: number } {
  const box = unionBounds(sanitized(items).map((it) => bounds(it, () => null)))
  if (!box) return { dx: 0, dy: 0 }
  const c = center(box)
  return { dx: Math.round(at.x - c.x), dy: Math.round(at.y - c.y) }
}

/** One sticky note per line (insert()-ready), in a grid of up to 5 columns centred on `at`. */
export function notesFromLines(
  lines: readonly string[],
  at: Point,
  color: ColorKey = 'yellow',
): Array<Pick<NoteItem, 'id' | 'type' | 'color' | 'text' | 'x' | 'y' | 'w' | 'h'>> {
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

export { sanitized as sanitizeAll }
