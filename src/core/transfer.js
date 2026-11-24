// Board files: export to JSON and import back, as a new board or added to the current one.
import { DEFAULT_TITLE, EXPORT_FORMAT, EXPORT_VERSION, sanitizeItem } from './schema.js'
import { bounds, unionBounds } from './geometry.js'

export function exportBoard(store) {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    title: store.getTitle(),
    users: store.users.toJSON(),
    items: store.snapshot(store.all().map((it) => it.id)),
  }
}

export function isExport(data) {
  return Boolean(data && data.format === EXPORT_FORMAT && Array.isArray(data.items))
}

/**
 * Imports an export. `asNewBoard` keeps ids, positions and the title (a board created from a
 * file); otherwise the content gets new ids and lands to the right of what's already there.
 * Either way authors and reactions are kept. One undo step. Returns the created ids.
 */
export function importBoard(store, data, { asNewBoard = false } = {}) {
  if (!isExport(data)) throw new Error("This file isn't a Meshboard export.")
  const shift = asNewBoard ? { dx: 0, dy: 0 } : besideExisting(store, data.items)
  store.stopCapturing()
  let ids = []
  store.doc.transact(() => {
    if (data.users && typeof data.users === 'object') {
      for (const [uid, name] of Object.entries(data.users)) {
        if (typeof name === 'string' && /^[\w-]{1,64}$/.test(uid) && !store.users.has(uid)) {
          store.users.set(uid, name.slice(0, 40))
        }
      }
    }
    if (asNewBoard && typeof data.title === 'string' && data.title !== DEFAULT_TITLE) store.setTitle(data.title)
    ids = store.insert(data.items, { ...shift, preserve: true, keepIds: asNewBoard })
  })
  store.stopCapturing()
  return ids
}

/** Offset that places incoming items 160 px to the right of the current content, tops aligned. */
function besideExisting(store, raw) {
  const current = unionBounds(store.all().map((it) => bounds(it, store.get)))
  const incoming = unionBounds(
    raw
      .map(sanitizeItem)
      .filter(Boolean)
      .map((it) => bounds(it, () => null)),
  )
  if (!current || !incoming) return { dx: 0, dy: 0 }
  return {
    dx: Math.round(current.x + current.w + 160 - incoming.x),
    dy: Math.round(current.y - incoming.y),
  }
}
