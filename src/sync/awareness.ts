// Presence on a self-hosted board: who is here and where their cursor is, carried by Yjs awareness
// through the server. The same shape as the peer-to-peer presence, so the board page doesn't care.
import type { Awareness } from 'y-protocols/awareness'
import { clean } from './presence.ts'
import type { Peers } from './presence.ts'
import type { Peer, User } from '../core/types.ts'

const PRESENCE_MS = 50

/** Presence over awareness, with the same shape as the peer-to-peer one. */
export function createAwarenessPresence(awareness: Awareness, me: User) {
  const peers: Peers = new Map()
  const listeners = { peers: new Set<(peers: Peers) => void>(), move: new Set<(peers: Peers) => void>() }
  const emit = (kind: keyof typeof listeners) => listeners[kind].forEach((fn) => fn(peers))
  let mine: Peer = { uid: me.id, name: me.name, x: null, y: null }
  let timer: ReturnType<typeof setTimeout> | undefined
  awareness.setLocalStateField('peer', mine)

  function read() {
    const next: Peers = new Map()
    for (const [clientId, state] of awareness.getStates()) {
      if (clientId === awareness.clientID) continue
      const peer = (state as Record<string, unknown>)?.peer
      // what others put in their awareness is untrusted, like everything from the network
      if (peer && typeof peer === 'object') next.set(String(clientId), clean(peer as Record<string, unknown>))
    }
    return next
  }

  function onChange({ added, removed }: { added: number[]; updated: number[]; removed: number[] }) {
    const next = read()
    peers.clear()
    for (const [k, v] of next) peers.set(k, v)
    if (added.length || removed.length) emit('peers')
    emit('move')
  }
  awareness.on('change', onChange)

  function set(patch: Partial<Omit<Peer, 'uid'>>) {
    mine = { ...mine, ...patch }
    if (timer) return
    timer = setTimeout(() => {
      timer = undefined
      awareness.setLocalStateField('peer', mine)
    }, PRESENCE_MS)
  }

  const on = (kind: keyof typeof listeners) => (fn: (peers: Peers) => void) => {
    listeners[kind].add(fn)
    return () => void listeners[kind].delete(fn)
  }

  return {
    peers,
    set,
    onPeers: on('peers'),
    onMove: on('move'),
    destroy() {
      clearTimeout(timer)
      awareness.off('change', onChange)
    },
  }
}
