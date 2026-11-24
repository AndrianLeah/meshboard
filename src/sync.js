// Serverless sync:
//  - IndexedDB keeps a local copy of the board (it survives closing the tab);
//  - Trystero connects browsers directly (WebRTC). Public Nostr relays are only
//    used for peers to find each other; they see a handshake encrypted with the
//    token's secret, never the board's content.
import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { joinRoom } from 'trystero'

const APP_ID = 'meshboard/v1'
const REMOTE = Symbol('remote')
const FLUSH_MS = 30
const PRESENCE_MS = 50

const toBytes = (data) => {
  if (data instanceof Uint8Array) return data
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return null
}

/**
 * Connects `store.doc` to the room identified by the token.
 * Returns {ready, setPresence, onPeers, onPresence, onError, peerCount, destroy}.
 */
export function connect(store, { roomId, secret }, options = {}) {
  const { doc } = store
  const listeners = { peers: new Set(), presence: new Set(), error: new Set() }
  const emit = (kind, ...args) => listeners[kind].forEach((fn) => fn(...args))

  // 1. local copy
  const local = new IndexeddbPersistence(`meshboard-${roomId}`, doc)
  const ready = local.whenSynced

  // 2. peer-to-peer network
  const room = joinRoom(
    {
      appId: APP_ID,
      password: secret,
      // optional TURN for locked-down networks, see the README
      ...(options.turnConfig ? { turnConfig: options.turnConfig } : {}),
    },
    roomId,
  )
  const updates = room.makeAction('upd')
  const vectors = room.makeAction('sv')
  const presence = room.makeAction('pres')

  // local updates → every peer, batched every FLUSH_MS
  let pending = []
  let flushTimer = 0
  const flush = () => {
    flushTimer = 0
    if (!pending.length) return
    const merged = pending.length === 1 ? pending[0] : Y.mergeUpdates(pending)
    pending = []
    if (Object.keys(room.getPeers()).length) updates.send(merged).catch(() => {})
  }
  const onDocUpdate = (update, origin) => {
    if (origin === REMOTE) return
    pending.push(update)
    if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS)
  }
  doc.on('update', onDocUpdate)

  updates.onMessage((data) => {
    const bytes = toBytes(data)
    if (!bytes) return
    try {
      Y.applyUpdate(doc, bytes, REMOTE)
    } catch (err) {
      console.warn('Invalid remote update', err)
    }
  })

  // when a peer joins we swap "state vectors":
  // each side replies with exactly what the other is missing
  vectors.onMessage((data, { peerId }) => {
    const sv = toBytes(data)
    if (!sv) return
    try {
      updates.send(Y.encodeStateAsUpdate(doc, sv), { target: peerId }).catch(() => {})
    } catch (err) {
      console.warn('Invalid state vector', err)
    }
  })

  // presence: name + cursor, in memory only
  const peers = new Map() // peerId -> {uid, name, x, y}
  let mine = { uid: store.me.id, name: store.me.name, x: null, y: null }
  let presenceTimer = 0
  let presenceDirty = false
  const sendPresence = (target) => presence.send(mine, target ? { target } : undefined).catch(() => {})

  presence.onMessage((data, { peerId }) => {
    if (!data || typeof data !== 'object') return
    const p = {
      uid: String(data.uid || '').slice(0, 64),
      name: String(data.name || '').slice(0, 40),
      x: Number.isFinite(data.x) ? data.x : null,
      y: Number.isFinite(data.y) ? data.y : null,
    }
    const isNew = !peers.has(peerId)
    peers.set(peerId, p)
    if (isNew) emit('peers', peers)
    emit('presence', peers)
  })

  room.onPeerJoin(({ peerId }) => {
    vectors.send(Y.encodeStateVector(doc), { target: peerId }).catch(() => {})
    sendPresence(peerId)
    emit('peers', peers)
  })

  room.onPeerLeave(({ peerId }) => {
    peers.delete(peerId)
    emit('peers', peers)
    emit('presence', peers)
  })

  room.onError((err) => {
    console.warn('[meshboard]', err.code, err.message)
    emit('error', err)
  })

  function setPresence(patch) {
    mine = { ...mine, ...patch }
    presenceDirty = true
    if (presenceTimer) return
    presenceTimer = setTimeout(() => {
      presenceTimer = 0
      if (presenceDirty) {
        presenceDirty = false
        sendPresence()
      }
    }, PRESENCE_MS)
  }

  const on = (kind) => (fn) => {
    listeners[kind].add(fn)
    return () => listeners[kind].delete(fn)
  }

  async function destroy() {
    clearTimeout(flushTimer)
    clearTimeout(presenceTimer)
    flush()
    doc.off('update', onDocUpdate)
    await room.leave().catch(() => {})
    await local.destroy()
  }

  return {
    ready,
    peers,
    setPresence,
    onPeers: on('peers'),
    onPresence: on('presence'),
    onError: on('error'),
    peerCount: () => Object.keys(room.getPeers()).length,
    destroy,
  }
}
