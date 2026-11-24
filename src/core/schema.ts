// What a board item is: types, defaults, limits and how untrusted data (files, other peers,
// the clipboard) is normalised. No DOM, no Yjs.
import type { ColorKey, ItemData, ItemType, Reactions, ShapeType, LineEnd } from './types.ts'

export const COLOR_KEYS: readonly ColorKey[] = ['yellow', 'orange', 'red', 'pink', 'purple', 'blue', 'green', 'gray']
export const SHAPES: readonly ShapeType[] = ['rect', 'ellipse', 'triangle', 'diamond']
export const TYPES: readonly ItemType[] = ['note', ...SHAPES, 'text', 'frame', 'path', 'image', 'arrow']
/** Items a connector can attach to. */
export const CONNECTABLE: readonly ItemType[] = ['note', ...SHAPES, 'text', 'image']
export const TEXT_SIZES = [16, 24, 36, 56] as const

interface Defaults {
  color: ColorKey
  w?: number
  h?: number
  fontSize?: number
  width?: number
}

export const DEFAULTS = {
  note: { w: 200, h: 200, color: 'yellow' },
  rect: { w: 180, h: 110, color: 'blue' },
  ellipse: { w: 170, h: 120, color: 'green' },
  triangle: { w: 160, h: 140, color: 'orange' },
  diamond: { w: 170, h: 140, color: 'purple' },
  text: { w: 280, h: 40, color: 'gray', fontSize: 24 },
  frame: { w: 640, h: 440, color: 'gray' },
  path: { color: 'gray', width: 3 },
  image: { w: 320, h: 240, color: 'gray' },
  arrow: { color: 'gray' },
} as const satisfies Record<ItemType, Defaults>

export const DEFAULT_TITLE = 'Untitled board'
export const EXPORT_FORMAT = 'meshboard'
export const EXPORT_VERSION = 2

const LIMIT = 1e6
const MAX_TEXT = 5000
const MAX_POINTS = 4000
const MAX_REACTIONS = 40
const ID_MAX = 64

/** A finite number within ±1e6, or `d`. */
const num = (v: unknown, d = 0): number => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(-LIMIT, Math.min(LIMIT, n)) : d
}
const clamp = (v: unknown, lo: number, hi: number, d: number): number => Math.max(lo, Math.min(hi, num(v, d)))
/** A time in ms since 1970, up to the last one a Date can hold, or now. */
const time = (v: unknown): number => {
  const n = Number(v)
  return n > 0 && n <= 8.64e15 ? n : Date.now()
}
const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.slice(0, max) : '')
const isEmoji = (s: unknown): s is string =>
  typeof s === 'string' && s.length > 0 && s.length <= 32 && !/[<>&"'\s]/.test(s)
const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object'

/** What an item id may be: the store skips items under any other key. */
export const isItemId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= ID_MAX
export const isItemType = (t: unknown): t is ItemType => TYPES.includes(t as ItemType)
export const isShapeType = (t: unknown): t is ShapeType => SHAPES.includes(t as ShapeType)
export const isShape = (it: { type: string } | null | undefined): boolean => Boolean(it) && isShapeType(it!.type)

/**
 * Who reacted with what, and when (the time orders the chips). Accepts v1 `votes`
 * ({userId: 1 | -1}) too, as 👍 / 👎.
 */
export function sanitizeReactions(raw: unknown, legacyVotes?: unknown): Reactions {
  const out: Reactions = {}
  const add = (emoji: string, uid: string, t: unknown) => {
    if (!isEmoji(emoji) || !/^[\w-]{1,64}$/.test(uid)) return
    if (!out[emoji] && Object.keys(out).length >= MAX_REACTIONS) return
    ;(out[emoji] ??= {})[uid] = typeof t === 'number' && Number.isFinite(t) && t > 0 ? t : 1
  }
  if (isObject(raw)) {
    for (const [emoji, users] of Object.entries(raw)) {
      if (isObject(users)) for (const [uid, t] of Object.entries(users)) add(emoji, uid, t)
    }
  }
  if (isObject(legacyVotes)) {
    for (const [uid, v] of Object.entries(legacyVotes)) {
      if (v === 1) add('👍', uid, 1)
      else if (v === -1) add('👎', uid, 1)
    }
  }
  return out
}

// The store sanitises an item again on every change to it, and a stroke's points stay the same
// array while it's moved or resized: remember each array's result (a frozen copy, recognised too)
// so a drag doesn't walk thousands of numbers per frame. Point arrays are never changed in place.
const pointsDone = new WeakMap<readonly unknown[], number[]>()

function sanitizePoints(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  let pts = pointsDone.get(raw)
  if (!pts) {
    pts = raw.slice(0, MAX_POINTS * 2).map((v) => num(v))
    if (pts.length % 2) pts.pop()
    Object.freeze(pts)
    pointsDone.set(raw, pts)
    pointsDone.set(pts, pts)
  }
  return pts
}

const lineEnd = (v: unknown, fallback: LineEnd): LineEnd => (v === 'arrow' || v === 'none' ? v : fallback)

const MAX_SRC = 2048

/**
 * An image address anyone on the board may load: https only (no data:, blob:, javascript: or
 * plain http), no credentials in it, and not too long. The normalised address, or null.
 */
export function imageSrc(v: unknown): string | null {
  if (typeof v !== 'string' || !v || v.length > MAX_SRC) return null
  let url: URL
  try {
    url = new URL(v.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) return null
  return url.href.length <= MAX_SRC ? url.href : null
}

/** Normalises an item read from a file, another peer or the clipboard. Returns null when unusable. */
export function sanitizeItem(raw: unknown): ItemData | null {
  if (!isObject(raw) || !isItemType(raw.type)) return null
  const type = raw.type
  const def: Defaults = DEFAULTS[type]
  const base = {
    color: COLOR_KEYS.includes(raw.color as ColorKey) ? (raw.color as ColorKey) : def.color,
    z: num(raw.z),
    author: str(raw.author, ID_MAX),
    created: time(raw.created),
    locked: raw.locked === true,
    group: str(raw.group, ID_MAX),
  }
  if (type === 'arrow') {
    return {
      ...base,
      type,
      x1: num(raw.x1),
      y1: num(raw.y1),
      x2: num(raw.x2),
      y2: num(raw.y2),
      from: str(raw.from, ID_MAX),
      to: str(raw.to, ID_MAX),
      start: lineEnd(raw.start, 'none'),
      end: raw.end === 'none' ? 'none' : 'arrow',
      dash: raw.dash === true,
    }
  }
  const min = type === 'path' ? 1 : 20
  const box = {
    ...base,
    x: num(raw.x),
    y: num(raw.y),
    w: Math.max(min, num(raw.w, def.w ?? 100) || def.w || 100),
    h: Math.max(min, num(raw.h, def.h ?? 100) || def.h || 100),
  }
  if (type === 'path') {
    const points = sanitizePoints(raw.points)
    if (points.length < 4) return null
    return {
      ...box,
      type,
      points,
      ow: Math.max(1, num(raw.ow, box.w)),
      oh: Math.max(1, num(raw.oh, box.h)),
      width: clamp(raw.width, 1, 24, def.width ?? 3),
    }
  }
  if (type === 'image') {
    const src = imageSrc(raw.src)
    return src ? { ...box, type, src, alt: str(raw.alt, 200) } : null
  }
  const text = str(raw.text, MAX_TEXT)
  if (type === 'text') return { ...box, type, text, fontSize: clamp(raw.fontSize, 10, 120, def.fontSize ?? 24) }
  if (type === 'note') return { ...box, type, text, reactions: sanitizeReactions(raw.reactions, raw.votes) }
  return { ...box, type, text }
}
