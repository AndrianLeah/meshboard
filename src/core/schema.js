// What a board item is: types, defaults, limits and how untrusted data (files, other peers,
// the clipboard) is normalised. No DOM, no Yjs.

export const COLOR_KEYS = ['yellow', 'orange', 'red', 'pink', 'purple', 'blue', 'green', 'gray']
export const SHAPES = ['rect', 'ellipse', 'triangle', 'diamond']
export const TYPES = ['note', ...SHAPES, 'text', 'frame', 'path', 'arrow']
/** Items a connector can attach to. */
export const CONNECTABLE = ['note', ...SHAPES, 'text']
export const TEXT_SIZES = [16, 24, 36, 56]

export const DEFAULTS = {
  note: { w: 200, h: 200, color: 'yellow' },
  rect: { w: 180, h: 110, color: 'blue' },
  ellipse: { w: 170, h: 120, color: 'green' },
  triangle: { w: 160, h: 140, color: 'orange' },
  diamond: { w: 170, h: 140, color: 'purple' },
  text: { w: 280, h: 40, color: 'gray', fontSize: 24 },
  frame: { w: 640, h: 440, color: 'gray' },
  path: { color: 'gray', width: 3 },
  arrow: { color: 'gray' },
}

export const DEFAULT_TITLE = 'Untitled board'
export const EXPORT_FORMAT = 'meshboard'
export const EXPORT_VERSION = 2

const LIMIT = 1e6
const MAX_TEXT = 5000
const MAX_POINTS = 4000
const MAX_REACTIONS = 40
const ID_MAX = 64

const num = (v, d = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(-LIMIT, Math.min(LIMIT, n)) : d
}
const clamp = (v, lo, hi, d) => Math.max(lo, Math.min(hi, num(v, d)))
const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '')
const isEmoji = (s) => typeof s === 'string' && s.length > 0 && s.length <= 32 && !/[<>&"'\s]/.test(s)

/**
 * {emoji: {userId: time}}: who reacted with what, and when (the time orders the chips).
 * Accepts v1 `votes` ({userId: 1 | -1}) too.
 */
export function sanitizeReactions(raw, legacyVotes) {
  const out = {}
  const add = (emoji, uid, t) => {
    if (!isEmoji(emoji) || typeof uid !== 'string' || !/^[\w-]{1,64}$/.test(uid)) return
    if (!out[emoji] && Object.keys(out).length >= MAX_REACTIONS) return
    ;(out[emoji] ??= {})[uid] = Number.isFinite(t) && t > 0 ? t : 1
  }
  if (raw && typeof raw === 'object') {
    for (const [emoji, users] of Object.entries(raw)) {
      if (users && typeof users === 'object') for (const [uid, t] of Object.entries(users)) add(emoji, uid, t)
    }
  }
  if (legacyVotes && typeof legacyVotes === 'object') {
    for (const [uid, v] of Object.entries(legacyVotes)) {
      if (v === 1) add('👍', uid, 1)
      else if (v === -1) add('👎', uid, 1)
    }
  }
  return out
}

function sanitizePoints(raw) {
  if (!Array.isArray(raw)) return []
  const pts = raw.slice(0, MAX_POINTS * 2).map((v) => num(v))
  return pts.length % 2 ? pts.slice(0, -1) : pts
}

/** Normalises an item read from a file, another peer or the clipboard. Returns null when unusable. */
export function sanitizeItem(raw) {
  if (!raw || typeof raw !== 'object' || !TYPES.includes(raw.type)) return null
  const type = raw.type
  const def = DEFAULTS[type]
  const it = {
    type,
    color: COLOR_KEYS.includes(raw.color) ? raw.color : def.color,
    z: num(raw.z),
    author: str(raw.author, ID_MAX),
    created: num(raw.created, Date.now()),
    locked: raw.locked === true,
    group: str(raw.group, ID_MAX),
  }
  if (type === 'arrow') {
    for (const k of ['x1', 'y1', 'x2', 'y2']) it[k] = num(raw[k])
    it.from = str(raw.from, ID_MAX)
    it.to = str(raw.to, ID_MAX)
    it.start = raw.start === 'arrow' ? 'arrow' : 'none'
    it.end = raw.end === 'none' ? 'none' : 'arrow'
    it.dash = raw.dash === true
    return it
  }
  it.x = num(raw.x)
  it.y = num(raw.y)
  const min = type === 'path' ? 1 : 20
  it.w = Math.max(min, num(raw.w, def.w ?? 100) || def.w || 100)
  it.h = Math.max(min, num(raw.h, def.h ?? 100) || def.h || 100)
  if (type === 'path') {
    it.points = sanitizePoints(raw.points)
    if (it.points.length < 4) return null
    it.ow = Math.max(1, num(raw.ow, it.w))
    it.oh = Math.max(1, num(raw.oh, it.h))
    it.width = clamp(raw.width, 1, 24, def.width)
    return it
  }
  it.text = str(raw.text, MAX_TEXT)
  if (type === 'text') it.fontSize = clamp(raw.fontSize, 10, 120, def.fontSize)
  if (type === 'note') it.reactions = sanitizeReactions(raw.reactions, raw.votes)
  return it
}

export const isShape = (it) => it && SHAPES.includes(it.type)
