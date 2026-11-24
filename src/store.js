// Shared data model (Yjs). Every board item is a Y.Map inside `items`, so
// concurrent edits to different fields merge cleanly.
import * as Y from 'yjs'
import { arrowEnds, bounds, normRect } from './geometry.js'
import { randomId } from './identity.js'

export const COLORS = {
  yellow: { fill: '#fff59d', stroke: '#f9a825' },
  orange: { fill: '#ffcc80', stroke: '#ef6c00' },
  red: { fill: '#ef9a9a', stroke: '#d32f2f' },
  pink: { fill: '#f8bbd0', stroke: '#c2185b' },
  purple: { fill: '#d1c4e9', stroke: '#5e35b1' },
  blue: { fill: '#90caf9', stroke: '#1565c0' },
  green: { fill: '#a5d6a7', stroke: '#2e7d32' },
  gray: { fill: '#e0e0e0', stroke: '#37474f' },
}
export const COLOR_KEYS = Object.keys(COLORS)
export const TYPES = ['note', 'rect', 'ellipse', 'text', 'arrow']
export const DEFAULT_TITLE = 'Untitled board'
export const EXPORT_FORMAT = 'meshboard'
export const EXPORT_VERSION = 1

const BOX_FIELDS = ['x', 'y', 'w', 'h']
const ARROW_FIELDS = ['x1', 'y1', 'x2', 'y2']
const MAX_TEXT = 5000
const LIMIT = 1e6

const num = (v, d = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(-LIMIT, Math.min(LIMIT, n)) : d
}
const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '')

/** Normalises an item read from a file or from another peer. */
export function sanitizeItem(raw) {
  if (!raw || typeof raw !== 'object' || !TYPES.includes(raw.type)) return null
  const it = {
    type: raw.type,
    color: COLOR_KEYS.includes(raw.color) ? raw.color : raw.type === 'note' ? 'yellow' : 'gray',
    z: num(raw.z),
    author: str(raw.author, 64),
    created: num(raw.created, Date.now()),
  }
  if (it.type === 'arrow') {
    for (const k of ARROW_FIELDS) it[k] = num(raw[k])
    it.from = str(raw.from, 64)
    it.to = str(raw.to, 64)
  } else {
    for (const k of BOX_FIELDS) it[k] = num(raw[k])
    it.w = Math.max(20, it.w || 160)
    it.h = Math.max(20, it.h || 100)
    it.text = str(raw.text, MAX_TEXT)
  }
  if (it.type === 'note') {
    it.votes = {}
    if (raw.votes && typeof raw.votes === 'object') {
      for (const [uid, v] of Object.entries(raw.votes)) {
        if ((v === 1 || v === -1) && uid.length <= 64) it.votes[uid] = v
      }
    }
  }
  return it
}

export function createStore(me) {
  const doc = new Y.Doc()
  const items = doc.getMap('items')
  const meta = doc.getMap('meta')
  const users = doc.getMap('users')
  const undoManager = new Y.UndoManager([items, meta], { captureTimeout: 400 })

  const read = (m) => (m instanceof Y.Map ? m.toJSON() : null)

  function get(id) {
    const it = read(items.get(id))
    if (it) it.id = id
    return it
  }

  function all() {
    const out = []
    items.forEach((m, id) => {
      const it = read(m)
      if (it && TYPES.includes(it.type)) {
        it.id = id
        out.push(it)
      }
    })
    return out.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1))
  }

  function zRange() {
    let min = 0
    let max = 0
    items.forEach((m) => {
      const z = m.get('z') || 0
      if (z < min) min = z
      if (z > max) max = z
    })
    return { min, max }
  }

  function writeItem(id, it) {
    const m = new Y.Map()
    items.set(id, m)
    for (const [k, v] of Object.entries(it)) {
      if (k === 'id' || k === 'votes') continue
      m.set(k, v)
    }
    if (it.type === 'note') {
      const votes = new Y.Map()
      m.set('votes', votes)
      for (const [uid, v] of Object.entries(it.votes || {})) votes.set(uid, v)
    }
  }

  function create(partial) {
    const id = randomId(8)
    const it = sanitizeItem({
      ...partial,
      z: zRange().max + 1,
      author: me.id,
      created: Date.now(),
    })
    doc.transact(() => writeItem(id, it))
    return id
  }

  /** patches: {id: {field: value}} applied in a single transaction. */
  function update(patches) {
    doc.transact(() => {
      for (const [id, patch] of Object.entries(patches)) {
        const m = items.get(id)
        if (!(m instanceof Y.Map)) continue
        for (const [k, v] of Object.entries(patch)) {
          if (k === 'id' || k === 'votes' || k === 'type' || k === 'author') continue
          if (m.get(k) !== v) m.set(k, v)
        }
      }
    })
  }

  function remove(ids) {
    const gone = new Set(ids)
    doc.transact(() => {
      // arrows attached to a deleted item go with it
      items.forEach((m, id) => {
        if (m.get('type') === 'arrow' && (gone.has(m.get('from')) || gone.has(m.get('to')))) {
          gone.add(id)
        }
      })
      for (const id of gone) items.delete(id)
    })
    return gone
  }

  function vote(id, value) {
    const m = items.get(id)
    if (!(m instanceof Y.Map) || m.get('type') !== 'note') return
    if (m.get('author') === me.id) return // no votes on your own notes
    doc.transact(() => {
      let votes = m.get('votes')
      if (!(votes instanceof Y.Map)) {
        votes = new Y.Map()
        m.set('votes', votes)
      }
      if (votes.get(me.id) === value) votes.delete(me.id)
      else votes.set(me.id, value)
    })
  }

  function reorder(ids, toFront) {
    const { min, max } = zRange()
    const sorted = all().filter((it) => ids.includes(it.id))
    const patches = {}
    sorted.forEach((it, i) => {
      patches[it.id] = { z: toFront ? max + 1 + i : min - sorted.length + i }
    })
    update(patches)
  }

  function duplicate(ids, offset = 24) {
    const src = all().filter((it) => ids.includes(it.id))
    const idMap = new Map(src.map((it) => [it.id, randomId(8)]))
    let z = zRange().max
    doc.transact(() => {
      for (const it of src) {
        const copy = { ...it, z: ++z, author: me.id, created: Date.now(), votes: {} }
        if (it.type === 'arrow') {
          for (const k of ARROW_FIELDS) copy[k] += offset
          copy.from = idMap.get(it.from) || ''
          copy.to = idMap.get(it.to) || ''
          if (!copy.from || !copy.to) Object.assign(copy, freeEnds(it, copy, offset))
        } else {
          copy.x += offset
          copy.y += offset
        }
        writeItem(idMap.get(it.id), sanitizeItem(copy))
      }
    })
    return [...idMap.values()]
  }

  // an end that loses its attachment stays where it was drawn
  function freeEnds(orig, copy, offset) {
    const e = arrowEnds(orig, get)
    const out = {}
    if (!copy.from) Object.assign(out, { x1: e.x1 + offset, y1: e.y1 + offset })
    if (!copy.to) Object.assign(out, { x2: e.x2 + offset, y2: e.y2 + offset })
    return out
  }

  const getTitle = () => meta.get('title') || DEFAULT_TITLE
  function setTitle(title) {
    const t = String(title || '').trim().slice(0, 80)
    if (t !== (meta.get('title') || '')) doc.transact(() => meta.set('title', t))
  }

  const userName = (id) => {
    const n = users.get(id)
    return typeof n === 'string' && n ? n : 'Anonymous'
  }
  function registerUser(id, name) {
    if (name && users.get(id) !== name) doc.transact(() => users.set(id, name), 'user')
  }

  function exportData() {
    const list = all().map((it) => {
      const out = { ...it }
      if (it.type === 'arrow') Object.assign(out, arrowEnds(it, get)) // actual positions
      return out
    })
    return {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      title: getTitle(),
      users: users.toJSON(),
      items: list,
    }
  }

  /**
   * Imports an export. With `keepIds` (a new board) ids and positions are kept
   * from the file; otherwise the content is added with new ids, to the right of
   * what's already there. Returns the created ids.
   */
  function importData(data, { keepIds = false } = {}) {
    if (!data || data.format !== EXPORT_FORMAT || !Array.isArray(data.items)) {
      throw new Error("This file isn't a Meshboard export.")
    }
    const raw = data.items.filter((r) => r && typeof r.id === 'string').slice(0, 5000)
    const idMap = new Map(raw.map((r) => [r.id, keepIds ? r.id.slice(0, 64) : randomId(8)]))
    const created = []
    const zBase = keepIds ? 0 : zRange().max + 1
    const shift = keepIds ? { dx: 0, dy: 0 } : besideExisting(raw)
    undoManager.stopCapturing() // an import is an undo step of its own
    doc.transact(() => {
      if (data.users && typeof data.users === 'object') {
        for (const [uid, name] of Object.entries(data.users)) {
          if (typeof name === 'string' && !users.has(uid)) users.set(uid.slice(0, 64), name.slice(0, 40))
        }
      }
      if (keepIds && typeof data.title === 'string') meta.set('title', data.title.slice(0, 80))
      for (const r of raw) {
        const it = sanitizeItem(r)
        if (!it) continue
        it.z += zBase
        if (it.type === 'arrow') {
          it.from = idMap.get(it.from) || ''
          it.to = idMap.get(it.to) || ''
          it.x1 += shift.dx
          it.x2 += shift.dx
          it.y1 += shift.dy
          it.y2 += shift.dy
        } else {
          it.x += shift.dx
          it.y += shift.dy
        }
        const id = idMap.get(r.id)
        writeItem(id, it)
        created.push(id)
      }
    })
    undoManager.stopCapturing()
    return created
  }

  // offset that places imported content to the right of the existing content
  function besideExisting(raw) {
    const box = (list, rectOf) => {
      let x1 = Infinity
      let y1 = Infinity
      let x2 = -Infinity
      for (const it of list) {
        const b = rectOf(it)
        if (!b) continue
        x1 = Math.min(x1, b.x)
        y1 = Math.min(y1, b.y)
        x2 = Math.max(x2, b.x + b.w)
      }
      return Number.isFinite(x1) ? { x1, y1, x2 } : null
    }
    const current = box(all(), (it) => bounds(it, get))
    const incoming = box(raw.map(sanitizeItem).filter(Boolean), (it) =>
      it.type === 'arrow' ? normRect(it.x1, it.y1, it.x2, it.y2) : it,
    )
    if (!current || !incoming) return { dx: 0, dy: 0 }
    return { dx: Math.round(current.x2 + 160 - incoming.x1), dy: Math.round(current.y1 - incoming.y1) }
  }

  return {
    doc,
    items,
    meta,
    users,
    me,
    get,
    all,
    create,
    update,
    remove,
    vote,
    reorder,
    duplicate,
    getTitle,
    setTitle,
    userName,
    registerUser,
    exportData,
    importData,
    undo: () => undoManager.undo(),
    redo: () => undoManager.redo(),
    stopCapturing: () => undoManager.stopCapturing(),
    clearHistory: () => undoManager.clear(),
  }
}
