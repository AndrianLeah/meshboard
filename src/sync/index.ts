// Everything that keeps a board alive outside this tab: the local copy, the peers, presence.
import { openLocalCopy } from './persistence.ts'
import { joinBoardRoom } from './p2p.ts'
import type { TransportOptions } from './p2p.ts'
import { createPresence } from './presence.ts'
import type { Store } from '../core/store.ts'
import type { BoardToken } from '../core/types.ts'

export type Connection = ReturnType<typeof connect>

export function connect(store: Store, token: BoardToken, options: TransportOptions = {}) {
  const local = openLocalCopy(store.doc, token.roomId)
  const net = joinBoardRoom(store.doc, token, options)
  const presence = createPresence(net.room, store.me)
  return {
    /** resolves once the copy stored in this browser is loaded */
    ready: local.ready,
    presence,
    peerCount: net.peerCount,
    onError: net.onError,
    async destroy() {
      presence.destroy()
      await net.destroy()
      await local.destroy()
    },
  }
}
