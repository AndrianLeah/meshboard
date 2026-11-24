// An in-memory stand-in for the peer-to-peer room: peers that join the same room id with the same
// password reach each other; messages arrive asynchronously, as on a network.
import type { JoinRoom, RoomAction, RoomError, RoomLike } from '../../src/sync/room.ts'

type Handler = (data: unknown, meta: { peerId: string }) => void

interface Member {
  receive(name: string, data: unknown, from: string): void
  joined(peerId: string): void
  left(peerId: string): void
}

export function createHub(): { joinRoom: JoinRoom } {
  const rooms = new Map<string, Map<string, Member>>() // "roomId/password" → peerId → member
  let next = 0

  const joinRoom: JoinRoom = ({ password }, roomId): RoomLike => {
    const key = `${roomId}/${password}`
    if (!rooms.has(key)) rooms.set(key, new Map())
    const members = rooms.get(key)!
    const selfId = `peer-${++next}`
    const handlers = {
      join: new Set<(e: { peerId: string }) => void>(),
      leave: new Set<(e: { peerId: string }) => void>(),
      error: new Set<(e: RoomError) => void>(),
    }
    const actions = new Map<string, Set<Handler>>()
    const deliver = (fn: () => void) => setTimeout(fn, 1)

    const self: Member = {
      receive(name, data, from) {
        for (const fn of actions.get(name) || []) fn(data, { peerId: from })
      },
      joined: (peerId) => handlers.join.forEach((fn) => fn({ peerId })),
      left: (peerId) => handlers.leave.forEach((fn) => fn({ peerId })),
    }

    const room: RoomLike = {
      makeAction<T>(name: string): RoomAction<T> {
        if (!actions.has(name)) actions.set(name, new Set())
        return {
          async send(data, { target } = {}) {
            for (const [id, peer] of members) {
              if (id === selfId || (target && id !== target)) continue
              // a copy, like bytes over the wire
              const copy = data instanceof Uint8Array ? new Uint8Array(data) : structuredClone(data)
              deliver(() => peer.receive(name, copy, selfId))
            }
          },
          onMessage: (fn) => void actions.get(name)!.add(fn),
        }
      },
      getPeers: () => Object.fromEntries([...members.keys()].filter((id) => id !== selfId).map((id) => [id, {}])),
      onPeerJoin: (fn) => void handlers.join.add(fn),
      onPeerLeave: (fn) => void handlers.leave.add(fn),
      onError: (fn) => void handlers.error.add(fn),
      async leave() {
        members.delete(selfId)
        for (const peer of members.values()) deliver(() => peer.left(selfId))
      },
    }

    // everyone already here meets the newcomer, and the newcomer meets them
    for (const [id, peer] of members) {
      deliver(() => peer.joined(selfId))
      deliver(() => self.joined(id))
    }
    members.set(selfId, self)
    return room
  }

  return { joinRoom }
}

export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
