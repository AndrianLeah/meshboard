// Peer-to-peer transport. Trystero connects browsers directly over WebRTC; public Nostr relays
// are only used for peers to find each other, and they see a handshake encrypted with the
// token's secret, never the board's content.
import * as Y from 'yjs'
import { joinTrysteroRoom } from './room.ts'
import type { JoinRoom, RoomError, RoomLike } from './room.ts'

const APP_ID = 'meshboard/v1'
const REMOTE = Symbol('remote')
const FLUSH_MS = 30

const toBytes = (data: unknown): Uint8Array | null => {
  if (data instanceof Uint8Array) return data
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return null
}

export interface TransportOptions {
  /** TURN servers for networks that block direct connections */
  turnConfig?: RTCIceServer[]
  /** replaces Trystero (the tests use an in-memory room) */
  joinRoom?: JoinRoom
}

export interface Transport {
  /** shared with presence */
  room: RoomLike
  peerCount: () => number
  onError: (fn: (error: RoomError) => void) => () => void
  destroy: () => Promise<void>
}

/** Joins the room of the token and keeps `doc` in sync with every peer in it. */
export function joinBoardRoom(
  doc: Y.Doc,
  { roomId, secret }: { roomId: string; secret: string },
  { turnConfig, joinRoom = joinTrysteroRoom }: TransportOptions = {},
): Transport {
  const errors = new Set<(error: RoomError) => void>()
  const room = joinRoom(
    {
      appId: APP_ID,
      password: secret,
      // optional TURN for locked-down networks, see the README
      ...(turnConfig ? { turnConfig } : {}),
    },
    roomId,
  )
  const updates = room.makeAction<Uint8Array>('upd')
  const vectors = room.makeAction<Uint8Array>('sv')

  // local updates → every peer, merged and sent every FLUSH_MS
  let pending: Uint8Array[] = []
  let flushTimer: ReturnType<typeof setTimeout> | undefined
  const flush = () => {
    flushTimer = undefined
    if (!pending.length) return
    const merged = pending.length === 1 ? pending[0] : Y.mergeUpdates(pending)
    pending = []
    if (Object.keys(room.getPeers()).length) updates.send(merged).catch(() => {})
  }
  const onDocUpdate = (update: Uint8Array, origin: unknown) => {
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

  // when a peer joins, both sides swap state vectors and reply with exactly what the other lacks
  vectors.onMessage((data, { peerId }) => {
    const sv = toBytes(data)
    if (!sv) return
    try {
      updates.send(Y.encodeStateAsUpdate(doc, sv), { target: peerId }).catch(() => {})
    } catch (err) {
      console.warn('Invalid state vector', err)
    }
  })
  room.onPeerJoin(({ peerId }) => {
    vectors.send(Y.encodeStateVector(doc), { target: peerId }).catch(() => {})
  })

  room.onError((err) => {
    console.warn('[meshboard]', err.code, err.message)
    errors.forEach((fn) => fn(err))
  })

  return {
    room,
    peerCount: () => Object.keys(room.getPeers()).length,
    onError(fn) {
      errors.add(fn)
      return () => errors.delete(fn)
    },
    async destroy() {
      clearTimeout(flushTimer)
      flush()
      doc.off('update', onDocUpdate)
      await room.leave().catch(() => {})
    },
  }
}
