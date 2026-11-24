// The board's local copy in IndexedDB: it survives closing the tab and works offline.
import { IndexeddbPersistence } from 'y-indexeddb'
import type * as Y from 'yjs'

/** `ready` resolves once the stored copy is loaded into `doc`. */
export function openLocalCopy(doc: Y.Doc, roomId: string): { ready: Promise<unknown>; destroy: () => Promise<void> } {
  const local = new IndexeddbPersistence(`meshboard-${roomId}`, doc)
  return { ready: local.whenSynced, destroy: () => local.destroy() }
}
