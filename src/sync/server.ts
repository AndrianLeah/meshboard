// The self-hosted transport: one WebSocket to the server (Hocuspocus), which keeps the board and
// checks who may open and edit it. Presence travels as Yjs awareness. The board still has its copy
// in this browser, so it opens at once and survives going offline.
import { HocuspocusProvider } from '@hocuspocus/provider'
import { openLocalCopy } from './persistence.ts'
import { createAwarenessPresence } from './awareness.ts'
import type { Store } from '../core/store.ts'
import type { RoomError } from './room.ts'

export type ServerStatus = 'connecting' | 'connected' | 'offline'

export interface ServerConnectOptions {
  /** the WebSocket address of the server's /sync */
  url: string
}

/** Connects a board to the server. The same shape as `connect` (peer to peer), plus a status. */
export function connectServer(store: Store, boardId: string, { url }: ServerConnectOptions) {
  const local = openLocalCopy(store.doc, `s-${boardId}`)
  const errors = new Set<(error: RoomError) => void>()
  const statuses = new Set<(status: ServerStatus) => void>()
  let status: ServerStatus = 'connecting'
  const setStatus = (s: ServerStatus) => {
    if (s === status) return
    status = s
    statuses.forEach((fn) => fn(s))
  }

  const provider = new HocuspocusProvider({
    url,
    name: boardId,
    document: store.doc,
    // the session cookie goes with the WebSocket; the server ignores this token
    token: 'session',
    onAuthenticationFailed: ({ reason }) =>
      errors.forEach((fn) => fn({ code: reason || 'forbidden', message: reason })),
    onSynced: () => setStatus('connected'),
    onStatus: ({ status: s }) =>
      setStatus(
        s === 'connected'
          ? provider.isSynced
            ? 'connected'
            : 'connecting'
          : s === 'connecting'
            ? 'connecting'
            : 'offline',
      ),
  })
  const presence = createAwarenessPresence(provider.awareness!, store.me)

  return {
    ready: local.ready,
    presence,
    peerCount: () => presence.peers.size,
    onError(fn: (error: RoomError) => void) {
      errors.add(fn)
      return () => void errors.delete(fn)
    },
    status: () => status,
    onStatus(fn: (status: ServerStatus) => void) {
      statuses.add(fn)
      return () => void statuses.delete(fn)
    },
    /** edits made here that the server hasn't confirmed yet */
    unsynced: () => provider.unsyncedChanges,
    async destroy() {
      presence.destroy()
      provider.destroy()
      await local.destroy()
    },
  }
}

export type ServerConnection = ReturnType<typeof connectServer>

/** Forgets every server board kept in this browser (signing out on a shared computer). */
export async function forgetLocalCopies(): Promise<void> {
  const list = (await indexedDB.databases?.()) ?? []
  await Promise.all(
    list
      .map((db) => db.name)
      .filter((name): name is string => Boolean(name?.startsWith('meshboard-s-')))
      .map(
        (name) =>
          new Promise<void>((resolve) => {
            const req = indexedDB.deleteDatabase(name)
            req.onsuccess = req.onerror = req.onblocked = () => resolve()
          }),
      ),
  )
}
