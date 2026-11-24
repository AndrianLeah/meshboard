// The part of a peer-to-peer room Meshboard uses, and the adapter that provides it with Trystero.
// Everything else in sync/ depends only on `RoomLike`, so tests can swap in an in-memory room.
import { joinRoom } from 'trystero'

export interface RoomAction<T> {
  send(data: T, options?: { target?: string }): Promise<void>
  /** What arrives over the wire is untrusted: validate it before use. */
  onMessage(handler: (data: unknown, meta: { peerId: string }) => void): void
}

export interface RoomError {
  code: string
  message: string
}

export interface RoomLike {
  makeAction<T>(name: string): RoomAction<T>
  getPeers(): Record<string, unknown>
  onPeerJoin(handler: (e: { peerId: string }) => void): void
  onPeerLeave(handler: (e: { peerId: string }) => void): void
  onError(handler: (error: RoomError) => void): void
  leave(): Promise<void>
}

export interface RoomConfig {
  appId: string
  /** encrypts the handshake: only peers with the same password meet */
  password: string
  turnConfig?: RTCIceServer[]
}

export type JoinRoom = (config: RoomConfig, roomId: string) => RoomLike

/** Joins a room through public Nostr relays, then connects to its peers over WebRTC. */
export const joinTrysteroRoom: JoinRoom = (config, roomId) => {
  const room = joinRoom(config, roomId)
  return {
    makeAction<T>(name: string) {
      const action = room.makeAction(name)
      return {
        send: (data: T, options?: { target?: string }) => action.send(data as never, options),
        onMessage: (handler) => void action.onMessage((data, meta) => handler(data, meta)),
      }
    },
    getPeers: () => room.getPeers(),
    onPeerJoin: (handler) => void room.onPeerJoin(handler),
    onPeerLeave: (handler) => void room.onPeerLeave(handler),
    onError: (handler) => void room.onError(handler),
    leave: () => room.leave(),
  }
}
