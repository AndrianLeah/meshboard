// The shared board model on Yjs. Every item is a Y.Map inside `items`, so concurrent edits to
// different fields merge cleanly. Reactions are a flat Y.Map keyed "<userId>:<emoji>" (value: the
// time of the reaction), so two people reacting at once never overwrite each other.
import * as Y from 'yjs'
import { DEFAULT_TITLE, isItemId, sanitizeItem } from './schema.ts'
import type { ItemData } from './types.ts'
import { arrowEnds } from './geometry.ts'
import { randomId } from './identity.ts'
import type { Item, ItemPatch, NewItem, Reactions, User } from './types.ts'

export type ReorderMode = 'front' | 'back' | 'forward' | 'backward'
export type Store = ReturnType<typeof createStore>

const READ_ONLY = new Set(['id', 'type', 'author', 'created', 'reactions'])
const reactionKey = (uid: string, emoji: string) => `${uid}:${emoji}`

/** {"uid:emoji": time} → {emoji: {uid: time}}, emoji in the order they were first used. */
function groupReactions(flat: Record<string, unknown> | undefined): Reactions {
  const entries = Object.entries(flat || {})
    .map(([key, t]) => {
      const i = key.indexOf(':')
      return i > 0 ? { uid: key.slice(0, i), emoji: key.slice(i + 1), t: Number(t) || 0 } : null
    })
    .filter((e) => e !== null)
    .sort((a, b) => a.t - b.t)
  const out: Reactions = {}
  for (const { uid, emoji, t } of entries) (out[emoji] ??= {})[uid] = t
  return out
}

type ItemMap = Y.Map<unknown>

export interface InsertOptions {
  /** offset applied to every inserted item */
  dx?: number
  dy?: number
  /** keep authors and reactions (an import); otherwise the copies are mine */
  preserve?: boolean
  /** keep the ids from the list (a board created from a file) */
  keepIds?: boolean
}

export function createStore(me: User) {
  const doc = new Y.Doc()
  const items = doc.getMap<ItemMap>('items')
  const meta = doc.getMap<string>('meta')
  const users = doc.getMap<string>('users')
  const undoManager = new Y.UndoManager([items, meta], { captureTimeout: 400 })

  /**
   * The item under `id` as everyone sees it. Other peers can write anything into the doc, so it
   * goes through the same limits as a file or the clipboard; an item that can't be repaired (bad
   * id, unknown type, a stroke without points) is skipped.
   */
  function read(id: string, m: unknown): Item | null {
    if (!(m instanceof Y.Map) || !isItemId(id)) return null
    // a shallow copy: nested Yjs types stay as they are, so a field nobody reads costs nothing
    const raw: Record<string, unknown> = {}
    m.forEach((v, k) => {
      raw[k] = v
    })
    const r = raw.reactions
    raw.reactions = r instanceof Y.Map ? groupReactions(r.toJSON()) : {}
    delete raw.votes // v1 votes count once migrate() has turned them into reactions
    const it = sanitizeItem(raw)
    return it && Object.freeze({ ...it, id })
  }

  // Plain, frozen copies of the items, refreshed only for the items a change touches: a drag that
  // moves one sticky re-reads that sticky, not the whole board. Unchanged items keep their object,
  // so renderers can skip them by identity.
  const cache = new Map<string, Item>()
  let sorted: readonly Item[] | null = null
  function refresh(id: string) {
    const it = read(id, items.get(id))
    if (it) cache.set(id, it)
    else cache.delete(id)
    sorted = null
  }
  items.observeDeep((events) => {
    for (const event of events) {
      // a change to the items map itself names the ids; a change inside an item starts its path
      if (event.target === items) for (const id of event.changes.keys.keys()) refresh(id)
      else refresh(String(event.path[0]))
    }
  })

  const get = (id: string): Item | null => cache.get(id) || null

  /** Every item, bottom to top (frames always below everything else). The array is read-only. */
  function all(): readonly Item[] {
    if (!sorted) {
      const layer = (it: Item) => (it.type === 'frame' ? 0 : 1)
      sorted = Object.freeze(
        [...cache.values()].sort((a, b) => layer(a) - layer(b) || a.z - b.z || (a.id < b.id ? -1 : 1)),
      )
    }
    return sorted
  }

  function zRange() {
    let min = 0
    let max = 0
    items.forEach((m) => {
      const z = Number(m.get('z')) || 0
      if (z < min) min = z
      if (z > max) max = z
    })
    return { min, max }
  }

  function writeItem(id: string, it: ItemData) {
    const m: ItemMap = new Y.Map()
    items.set(id, m)
    for (const [k, v] of Object.entries(it)) {
      if (k !== 'id' && k !== 'reactions') m.set(k, v)
    }
    if (it.type === 'note') {
      const r = new Y.Map<number>()
      m.set('reactions', r)
      for (const [emoji, byUser] of Object.entries(it.reactions || {})) {
        for (const [uid, t] of Object.entries(byUser)) r.set(reactionKey(uid, emoji), Number(t) || 1)
      }
    }
  }

  const transact = (fn: () => void) => doc.transact(fn)

  /** Adds an item on top of everything, as mine. Returns its id. */
  function create(partial: NewItem): string {
    const it = sanitizeItem({ ...partial, z: zRange().max + 1, author: me.id, created: Date.now(), reactions: {} })
    if (!it) throw new Error(`Invalid item: ${partial?.type}`)
    const id = randomId(8)
    transact(() => writeItem(id, it))
    return id
  }

  /** Changes fields of several items, as one transaction. */
  function update(patches: Record<string, ItemPatch>) {
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
  function remove(ids: Iterable<string>): Set<string> {
    const gone = new Set(ids)
    transact(() => {
      items.forEach((m, id) => {
        if (m.get('type') === 'arrow' && (gone.has(String(m.get('from'))) || gone.has(String(m.get('to')))))
          gone.add(id)
      })
      for (const id of gone) items.delete(id)
    })
    return gone
  }

  // ---------- reactions ----------

  /** Adds my `emoji` to a sticky note, or takes it back if it's already there. */
  function toggleReaction(id: string, emoji: string) {
    const m = items.get(id)
    if (!(m instanceof Y.Map) || m.get('type') !== 'note') return
    const key = reactionKey(me.id, emoji)
    transact(() => {
      const r = reactionsOf(m)
      if (r.has(key)) r.delete(key)
      else r.set(key, Date.now())
    })
  }

  /** A note's reactions map, created if it's missing (call inside a transaction). */
  function reactionsOf(m: ItemMap): Y.Map<number> {
    const r = m.get('reactions')
    if (r instanceof Y.Map) return r as Y.Map<number>
    const fresh = new Y.Map<number>()
    m.set('reactions', fresh)
    return fresh
  }

  // ---------- arrangement ----------

  /** Moves items in the stacking order. Frames are ordered among frames. */
  function reorder(ids: readonly string[], mode: ReorderMode) {
    const chosen = new Set(ids)
    const list = all()
    const patches: Record<string, ItemPatch> = {}
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
          const past = z.get(seq[j].id)!
          const beyond = k >= 0 && k < seq.length ? z.get(seq[k].id)! : past + (up ? 2 : -2)
          const nz = (past + beyond) / 2
          z.set(it.id, nz)
          patches[it.id] = { z: nz }
          ;[seq[i], seq[j]] = [seq[j], seq[i]]
        }
      }
    }
    update(patches)
  }

  /** Groups `ids` under a new group id (returned), or does nothing for fewer than two. */
  function group(ids: readonly string[]): string {
    if (ids.length < 2) return ''
    const gid = randomId(6)
    update(Object.fromEntries(ids.map((id) => [id, { group: gid }])))
    return gid
  }

  const ungroup = (ids: readonly string[]) => update(Object.fromEntries(ids.map((id) => [id, { group: '' }])))
  const setLocked = (ids: readonly string[], locked: boolean) =>
    update(Object.fromEntries(ids.map((id) => [id, { locked }])))

  /** Every member of the groups that `ids` belong to. */
  function withGroups(ids: readonly string[]): string[] {
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
  function snapshot(ids: Iterable<string>): Item[] {
    const set = new Set(ids)
    return all()
      .filter((it) => set.has(it.id))
      .map((it): Item => {
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
  function insert(
    list: readonly unknown[],
    { dx = 0, dy = 0, preserve = false, keepIds = false }: InsertOptions = {},
  ): string[] {
    const raw = list
      .filter((r): r is { id: string; z?: unknown } => Boolean(r) && typeof (r as { id?: unknown }).id === 'string')
      .slice(0, 5000)
    const idMap = new Map(raw.map((r) => [r.id, keepIds ? r.id.slice(0, 64) : randomId(8)]))
    const groupMap = new Map<string, string>()
    const zs = raw.map((r) => Number(r.z) || 0)
    const zBase = keepIds ? 0 : zRange().max + 1 - (zs.length ? Math.min(...zs) : 0)
    const created: string[] = []
    transact(() => {
      for (const r of raw) {
        const it = sanitizeItem(r)
        if (!it) continue
        it.z += zBase
        if (it.group) {
          if (!groupMap.has(it.group)) groupMap.set(it.group, keepIds ? it.group : randomId(6))
          it.group = groupMap.get(it.group)!
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
        const id = idMap.get(r.id)!
        writeItem(id, it)
        created.push(id)
      }
    })
    return created
  }

  const duplicate = (ids: readonly string[], offset = 24) =>
    insert(snapshot(withGroups(ids)), { dx: offset, dy: offset })

  // ---------- title and people ----------

  const getTitle = (): string => meta.get('title') || DEFAULT_TITLE
  function setTitle(title: string) {
    const t = String(title || '')
      .trim()
      .slice(0, 80)
    if (t !== (meta.get('title') || '')) transact(() => meta.set('title', t))
  }

  function userName(id: string): string {
    const n = users.get(id)
    return typeof n === 'string' && n ? n : 'Anonymous'
  }
  function registerUser(id: string, name: string) {
    if (name && users.get(id) !== name) doc.transact(() => users.set(id, String(name).slice(0, 40)), 'user')
  }

  // ---------- migrations ----------

  /** v1 boards stored thumbs up/down in `votes`: turn them into 👍 / 👎 reactions. */
  function migrate() {
    doc.transact(() => {
      items.forEach((m) => {
        const votes = m.get('votes')
        if (!(votes instanceof Y.Map)) return
        const r = reactionsOf(m)
        votes.forEach((v: unknown, uid: string) => {
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
    /** Calls `fn` whenever undo or redo become (un)available. Returns the unsubscribe function. */
    onHistoryChange(fn: () => void) {
      const events = ['stack-item-added', 'stack-item-popped', 'stack-cleared'] as const
      events.forEach((e) => undoManager.on(e, fn))
      return () => events.forEach((e) => undoManager.off(e, fn))
    },
    stopCapturing: () => undoManager.stopCapturing(),
    clearHistory: () => undoManager.clear(),
  }
}
