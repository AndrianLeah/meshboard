// Everything that keeps a board alive outside this tab: the local copy, the peers, presence.
import { openLocalCopy } from './persistence.js'
import { joinBoardRoom } from './p2p.js'
import { createPresence } from './presence.js'

/** Returns {ready, presence, peerCount, onError, destroy}. */
export function connect(store, token, options = {}) {
  const local = openLocalCopy(store.doc, token.roomId)
  const net = joinBoardRoom(store.doc, token, options)
  const presence = createPresence(net.room, store.me)
  return {
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
