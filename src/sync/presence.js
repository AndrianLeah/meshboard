// Who is here and where their cursor is. In memory only, never stored in the board.
const PRESENCE_MS = 50

const clean = (data) => ({
  uid: String(data.uid || '').slice(0, 64),
  name: String(data.name || '').slice(0, 40),
  x: Number.isFinite(data.x) ? data.x : null,
  y: Number.isFinite(data.y) ? data.y : null,
})

/**
 * Presence on a Trystero room. `peers` maps peerId → {uid, name, x, y}.
 * onPeers fires when someone joins or leaves, onMove on every cursor update.
 */
export function createPresence(room, me) {
  const action = room.makeAction('pres')
  const peers = new Map()
  const listeners = { peers: new Set(), move: new Set() }
  const emit = (kind) => listeners[kind].forEach((fn) => fn(peers))
  let mine = { uid: me.id, name: me.name, x: null, y: null }
  let timer = 0
  let dirty = false

  const send = (target) => action.send(mine, target ? { target } : undefined).catch(() => {})

  action.onMessage((data, { peerId }) => {
    if (!data || typeof data !== 'object') return
    const isNew = !peers.has(peerId)
    peers.set(peerId, clean(data))
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
  function set(patch) {
    mine = { ...mine, ...patch }
    dirty = true
    if (timer) return
    timer = setTimeout(() => {
      timer = 0
      if (dirty) {
        dirty = false
        send()
      }
    }, PRESENCE_MS)
  }

  const on = (kind) => (fn) => {
    listeners[kind].add(fn)
    return () => listeners[kind].delete(fn)
  }

  return {
    peers,
    set,
    onPeers: on('peers'),
    onMove: on('move'),
    destroy: () => clearTimeout(timer),
  }
}
