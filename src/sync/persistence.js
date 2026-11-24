// The board's local copy in IndexedDB: it survives closing the tab and works offline.
import { IndexeddbPersistence } from 'y-indexeddb'

/** Returns {ready, destroy}; `ready` resolves once the stored copy is loaded into `doc`. */
export function openLocalCopy(doc, roomId) {
  const local = new IndexeddbPersistence(`meshboard-${roomId}`, doc)
  return { ready: local.whenSynced, destroy: () => local.destroy() }
}
