// The shared board model on Yjs. Every item is a Y.Map inside `items`, so concurrent edits to
// different fields merge cleanly. Reactions are a flat Y.Map keyed "<userId>:<emoji>" (value: the
// time of the reaction), so two people reacting at once never overwrite each other.
import * as Y from 'yjs'
import { DEFAULT_TITLE, TYPES, sanitizeItem } from './schema.js'
import { arrowEnds } from './geometry.js'
import { randomId } from './identity.js'

const READ_ONLY = new Set(['id', 'type', 'author', 'created', 'reactions'])
const reactionKey = (uid, emoji) => `${uid}:${emoji}`

/** {"uid:emoji": time} → {emoji: {uid: time}}, emoji in the order they were first used. */
function groupReactions(flat) {
  const entries = Object.entries(flat || {})
    .map(([key, t]) => {
      const i = key.indexOf(':')
      return i > 0 ? { uid: key.slice(0, i), emoji: key.slice(i + 1), t: Number(t) || 0 } : null
    })
    .filter(Boolean)
    .sort((a, b) => a.t - b.t)
  const out = {}
  for (const { uid, emoji, t } of entries) (out[emoji] ??= {})[uid] = t
  return out
}

export function createStore(me) {
  const doc = new Y.Doc()
  const items = doc.getMap('items')
  const meta = doc.getMap('meta')
  const users = doc.getMap('users')
  const undoManager = new Y.UndoManager([items, meta], { captureTimeout: 400 })

  function read(id, m) {
    if (!(m instanceof Y.Map) || !TYPES.includes(m.get('type'))) return null
    const it = m.toJSON()
    it.id = id
    if (it.type === 'note') it.reactions = groupReactions(it.reactions)
    else delete it.reactions
    return it
  }

  const get = (id) => read(id, items.get(id))

  /** Every item, bottom to top. Frames always sit below everything else. */
  function all() {
    const out = []
    items.forEach((m, id) => {
      const it = read(id, m)
      if (it) out.push(it)
    })
    const layer = (it) => (it.type === 'frame' ? 0 : 1)
    return out.sort((a, b) => layer(a) - layer(b) || a.z - b.z || (a.id < b.id ? -1 : 1))
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
      if (k !== 'id' && k !== 'reactions') m.set(k, v)
    }
    if (it.type === 'note') {
      const r = new Y.Map()
      m.set('reactions', r)
      for (const [emoji, byUser] of Object.entries(it.reactions || {})) {
        for (const [uid, t] of Object.entries(byUser)) r.set(reactionKey(uid, emoji), Number(t) || 1)
      }
    }
  }

  const transact = (fn) => doc.transact(fn)

  function create(partial) {
    const it = sanitizeItem({ ...partial, z: zRange().max + 1, author: me.id, created: Date.now(), reactions: {} })
    if (!it) throw new Error(`Invalid item: ${partial?.type}`)
    const id = randomId(8)
    transact(() => writeItem(id, it))
    return id
  }

  /** patches: {id: {field: value}}, applied as one transaction. */
  function update(patches) {
    transact(() => {
      for (const [id, patch] of Object.entries(patches)) {
        const m = items.get(id)
        if (!(m instanceof Y.Map)) continue
        for (const [k, v] of Object.entries(patch)) {
          if (READ_ONLY.has(k)) continue
          if (m.get(k) !== v) m.set(k, v)
        }
      }
    })
  }

  /** Deletes items and the connectors attached to them. Returns every deleted id. */
  function remove(ids) {
    const gone = new Set(ids)
    transact(() => {
      items.forEach((m, id) => {
        if (m.get('type') === 'arrow' && (gone.has(m.get('from')) || gone.has(m.get('to')))) gone.add(id)
      })
      for (const id of gone) items.delete(id)
    })
    return gone
  }

  // ---------- reactions ----------

  /** Adds my `emoji` to a sticky note, or takes it back if it's already there. */
  function toggleReaction(id, emoji) {
    const m = items.get(id)
    if (!(m instanceof Y.Map) || m.get('type') !== 'note') return
    const key = reactionKey(me.id, emoji)
    transact(() => {
      let r = m.get('reactions')
      if (!(r instanceof Y.Map)) {
        r = new Y.Map()
        m.set('reactions', r)
      }
      if (r.has(key)) r.delete(key)
      else r.set(key, Date.now())
    })
  }

  // ---------- arrangement ----------

  /** mode: 'front' | 'back' | 'forward' | 'backward'. Frames are ordered among frames. */
  function reorder(ids, mode) {
    const chosen = new Set(ids)
    const list = all()
    const patches = {}
    for (const isFrame of [false, true]) {
      const layer = list.filter((it) => (it.type === 'frame') === isFrame)
      const picked = layer.filter((it) => chosen.has(it.id))
      if (!picked.length) continue
      const zs = layer.map((it) => it.z)
      const max = Math.max(...zs)
      const min = Math.min(...zs)
      if (mode === 'front') picked.forEach((it, i) => (patches[it.id] = { z: max + 1 + i }))
      else if (mode === 'back') picked.forEach((it, i) => (patches[it.id] = { z: min - picked.length + i }))
      else {
        // one step: hop over the nearest item that isn't selected
        const up = mode === 'forward'
        const order = up ? [...picked].reverse() : picked
        const z = new Map(layer.map((it) => [it.id, it.z]))
        const seq = [...layer]
        for (const it of order) {
          const i = seq.findIndex((s) => s.id === it.id)
          const j = up ? i + 1 : i - 1
          if (j < 0 || j >= seq.length || chosen.has(seq[j].id)) continue
          const k = up ? j + 1 : j - 1
          const past = z.get(seq[j].id)
          const beyond = k >= 0 && k < seq.length ? z.get(seq[k].id) : past + (up ? 2 : -2)
          const nz = (past + beyond) / 2
          z.set(it.id, nz)
          patches[it.id] = { z: nz }
          ;[seq[i], seq[j]] = [seq[j], seq[i]]
        }
      }
    }
    update(patches)
  }

  function group(ids) {
    if (ids.length < 2) return ''
    const gid = randomId(6)
    update(Object.fromEntries(ids.map((id) => [id, { group: gid }])))
    return gid
  }

  const ungroup = (ids) => update(Object.fromEntries(ids.map((id) => [id, { group: '' }])))
  const setLocked = (ids, locked) => update(Object.fromEntries(ids.map((id) => [id, { locked }])))

  /** Every member of the groups that `ids` belong to. */
  function withGroups(ids) {
    const groups = new Set(ids.map((id) => items.get(id)?.get('group')).filter(Boolean))
    if (!groups.size) return [...ids]
    const out = new Set(ids)
    items.forEach((m, id) => groups.has(m.get('group')) && out.add(id))
    return [...out]
  }

  // ---------- copies (clipboard, duplicate, import) ----------

  /**
   * Plain copies of `ids`, ready for insert(). A connector whose end is attached to an item
   * outside the set keeps that end where it is now drawn.
   */
  function snapshot(ids) {
    const set = new Set(ids)
    return all()
      .filter((it) => set.has(it.id))
      .map((it) => {
        if (it.type !== 'arrow') return it
        const out = { ...it, ...arrowEnds(it, get) }
        if (!set.has(it.from)) out.from = ''
        if (!set.has(it.to)) out.to = ''
        return out
      })
  }

  /**
   * Adds `list` (snapshot() items, or items read from a file) to the board, moved by dx/dy,
   * above everything else. New ids, with connectors and groups remapped to the copies.
   * `preserve` keeps authors and reactions (an import); otherwise the copies are mine.
   * Returns the new ids.
   */
  function insert(list, { dx = 0, dy = 0, preserve = false, keepIds = false } = {}) {
    const raw = list.filter((r) => r && typeof r.id === 'string').slice(0, 5000)
    const idMap = new Map(raw.map((r) => [r.id, keepIds ? r.id.slice(0, 64) : randomId(8)]))
    const groupMap = new Map()
    const zs = raw.map((r) => Number(r.z) || 0)
    const zBase = keepIds ? 0 : zRange().max + 1 - (zs.length ? Math.min(...zs) : 0)
    const created = []
    transact(() => {
      for (const r of raw) {
        const it = sanitizeItem(r)
        if (!it) continue
        it.z += zBase
        if (it.group) {
          if (!groupMap.has(it.group)) groupMap.set(it.group, keepIds ? it.group : randomId(6))
          it.group = groupMap.get(it.group)
        }
        if (!preserve) {
          it.author = me.id
          it.created = Date.now()
          if (it.type === 'note') it.reactions = {}
        }
        if (it.type === 'arrow') {
          it.from = idMap.get(it.from) || ''
          it.to = idMap.get(it.to) || ''
          it.x1 += dx
          it.x2 += dx
          it.y1 += dy
          it.y2 += dy
        } else {
          it.x += dx
          it.y += dy
        }
        const id = idMap.get(r.id)
        writeItem(id, it)
        created.push(id)
      }
    })
    return created
  }

  const duplicate = (ids, offset = 24) => insert(snapshot(withGroups(ids)), { dx: offset, dy: offset })

  // ---------- title and people ----------

  const getTitle = () => meta.get('title') || DEFAULT_TITLE
  function setTitle(title) {
    const t = String(title || '').trim().slice(0, 80)
    if (t !== (meta.get('title') || '')) transact(() => meta.set('title', t))
  }

  function userName(id) {
    const n = users.get(id)
    return typeof n === 'string' && n ? n : 'Anonymous'
  }
  function registerUser(id, name) {
    if (name && users.get(id) !== name) doc.transact(() => users.set(id, String(name).slice(0, 40)), 'user')
  }

  // ---------- migrations ----------

  /** v1 boards stored thumbs up/down in `votes`: turn them into 👍 / 👎 reactions. */
  function migrate() {
    doc.transact(() => {
      items.forEach((m) => {
        const votes = m.get('votes')
        if (!(votes instanceof Y.Map)) return
        let r = m.get('reactions')
        if (!(r instanceof Y.Map)) {
          r = new Y.Map()
          m.set('reactions', r)
        }
        votes.forEach((v, uid) => {
          if (v === 1) r.set(reactionKey(uid, '👍'), 1)
          else if (v === -1) r.set(reactionKey(uid, '👎'), 1)
        })
        m.delete('votes')
      })
    }, 'migrate')
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
    toggleReaction,
    reorder,
    group,
    ungroup,
    setLocked,
    withGroups,
    snapshot,
    insert,
    duplicate,
    getTitle,
    setTitle,
    userName,
    registerUser,
    migrate,
    undo: () => undoManager.undo(),
    redo: () => undoManager.redo(),
    canUndo: () => undoManager.undoStack.length > 0,
    canRedo: () => undoManager.redoStack.length > 0,
    onHistoryChange(fn) {
      const events = ['stack-item-added', 'stack-item-popped', 'stack-cleared']
      events.forEach((e) => undoManager.on(e, fn))
      return () => events.forEach((e) => undoManager.off(e, fn))
    },
    stopCapturing: () => undoManager.stopCapturing(),
    clearHistory: () => undoManager.clear(),
  }
}
