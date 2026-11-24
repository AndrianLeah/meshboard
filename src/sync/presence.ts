// Who is here and where their cursor is. In memory only, never stored in the board.
import type { Peer, User } from '../core/types.ts'
import type { RoomLike } from './room.ts'

const PRESENCE_MS = 50

export type Peers = Map<string, Peer>
export type Presence = ReturnType<typeof createPresence>

/** A peer's announcement, validated: it comes from the network. */
function clean(data: Record<string, unknown>): Peer {
  return {
    uid: String(data.uid || '').slice(0, 64),
    name: String(data.name || '').slice(0, 40),
    x: typeof data.x === 'number' && Number.isFinite(data.x) ? data.x : null,
    y: typeof data.y === 'number' && Number.isFinite(data.y) ? data.y : null,
  }
}

/**
 * Presence on a room. `peers` maps peerId → who they are and where their cursor is.
 * onPeers fires when someone joins or leaves, onMove on every cursor update.
 */
export function createPresence(room: RoomLike, me: User) {
  const action = room.makeAction<Peer>('pres')
  const peers: Peers = new Map()
  const listeners = { peers: new Set<(peers: Peers) => void>(), move: new Set<(peers: Peers) => void>() }
  const emit = (kind: keyof typeof listeners) => listeners[kind].forEach((fn) => fn(peers))
  let mine: Peer = { uid: me.id, name: me.name, x: null, y: null }
  let timer: ReturnType<typeof setTimeout> | undefined
  let dirty = false

  const send = (target?: string) => action.send(mine, target ? { target } : undefined).catch(() => {})

  action.onMessage((data, { peerId }) => {
    if (!data || typeof data !== 'object') return
    const isNew = !peers.has(peerId)
    peers.set(peerId, clean(data as Record<string, unknown>))
    if (isNew) emit('peers')
    emit('move')
  })
  room.onPeerJoin(({ peerId }) => {
    send(peerId)
    emit('peers')
  })
  room.onPeerLeave(({ peerId }) => {
    peers.delete(peerId)
    emit('peers')
    emit('move')
  })

  /** Updates what others see (throttled). */
  function set(patch: Partial<Omit<Peer, 'uid'>>) {
    mine = { ...mine, ...patch }
    dirty = true
    if (timer) return
    timer = setTimeout(() => {
      timer = undefined
      if (dirty) {
        dirty = false
        send()
      }
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
    destroy: () => clearTimeout(timer),
  }
}
