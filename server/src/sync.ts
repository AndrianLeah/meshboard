// Live sync: Hocuspocus keeps each open board in memory, merges everyone's edits (Yjs) and saves the
// board a couple of seconds after the last change. The HTTP server hands it WebSockets only after
// checking the Origin and the session; Hocuspocus then asks `authorize` about each board, and makes
// the connection read-only for viewers (it ignores their updates).
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { Hocuspocus } from '@hocuspocus/server'
import type { WebSocketLike } from '@hocuspocus/server'
import { WebSocketServer } from 'ws'
import type { RawData, WebSocket } from 'ws'
import * as Y from 'yjs'
import type { Config } from './config.ts'
import type { Db } from './db.ts'
import type { Role, Viewer } from './access.ts'
import { canEdit } from './access.ts'
import { describe } from './preview.ts'
import type { Logger } from './util.ts'

export const BOARD_ID = /^[A-Za-z0-9_-]{16,64}$/

/** What a connection carries: who opened it, or the server itself editing a board. */
export interface SyncContext {
  viewer?: Viewer
  role?: Role
  system?: boolean
}

export interface SyncDeps {
  db: Db
  config: Pick<Config, 'url' | 'maxBoardBytes' | 'maxMessageBytes'>
  log: Logger
  /** the viewer's role on a board; null when they can't open it (or it's in the trash) */
  authorize: (viewer: Viewer, boardId: string) => Promise<Role | null>
  onOpened?: (viewer: Viewer, boardId: string) => void
  onStored?: (boardId: string, info: { title: string; updatedBy: string | null }) => void
  /** save delays, shorter in tests */
  debounceMs?: number
  maxDebounceMs?: number
}

/** A refusal Hocuspocus passes to the client as is (no message: an expected refusal isn't logged). */
const denied = (reason: string) => ({ reason })

/** What one connection may send in a window: a client typing and dragging stays far below. */
const WINDOW_MS = 10_000
const MAX_MESSAGES_PER_WINDOW = 2000
const MAX_BOARDS_PER_SOCKET = 20
/** Sign-in from headers (gateway, webhook) is checked again this often: the app reconnects. */
const MAX_SOCKET_AGE_MS = 8 * 60 * 60_000
const SWEEP_MS = 60_000

/** A cursor coordinate, or nothing. */
const coordinate = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e7 ? Math.round(v) : null

const toBytes = (data: RawData): Uint8Array => {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data))
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

export function createSync(deps: SyncDeps) {
  const { db, config, log } = deps
  /** what each connection has sent lately, and the boards it has open (by Hocuspocus socket id) */
  const sockets = new Map<string, { bytes: number; messages: number; reset: number; boards: Set<string> }>()
  /** each open board's size: as last saved, plus everything received since */
  const sizes = new Map<string, number>()
  /** every live WebSocket and who opened it, to close them when a session ends */
  const live = new Set<{ ws: WebSocket; viewer: Viewer; opened: number }>()

  const socketStats = (id: string) => {
    let s = sockets.get(id)
    if (!s) sockets.set(id, (s = { bytes: 0, messages: 0, reset: Date.now() + WINDOW_MS, boards: new Set() }))
    return s
  }

  async function store(boardId: string, document: Y.Doc, context: SyncContext | undefined) {
    const state = Y.encodeStateAsUpdate(document)
    sizes.set(boardId, state.byteLength)
    if (state.byteLength > config.maxBoardBytes) {
      log('warn', 'Board over the size limit: not saved', { board: boardId, bytes: state.byteLength })
      for (const connection of hocuspocus.documents.get(boardId)?.getConnections() ?? [])
        connection.webSocket.close(4413, 'board-too-large')
      return
    }
    const { title, preview } = describe(state)
    const now = Date.now()
    const updatedBy = context?.viewer?.id ?? null
    const saved = await db.transaction().execute(async (trx) => {
      const result = await trx
        .updateTable('boards')
        .set({
          title,
          preview,
          size_bytes: state.byteLength,
          updated_at: now,
          ...(updatedBy ? { updated_by: updatedBy } : {}),
        })
        .where('id', '=', boardId)
        .executeTakeFirst()
      // deleted for good while it was open: nothing to keep
      if (!Number(result.numUpdatedRows)) return false
      await trx
        .insertInto('board_state')
        .values({ board_id: boardId, state, updated_at: now })
        .onConflict((oc) => oc.column('board_id').doUpdateSet({ state, updated_at: now }))
        .execute()
      return true
    })
    if (saved) deps.onStored?.(boardId, { title, updatedBy })
  }

  const hocuspocus = new Hocuspocus<SyncContext>({
    name: 'meshboard',
    quiet: true,
    debounce: deps.debounceMs ?? 2000,
    maxDebounce: deps.maxDebounceMs ?? 10_000,
    timeout: 30_000,
    authenticationTimeout: 10_000,
    unloadImmediately: false,
    async onAuthenticate({ documentName, context, connectionConfig, socketId }) {
      const viewer = context.viewer
      if (!viewer) throw denied('unauthorized')
      if (!BOARD_ID.test(documentName)) throw denied('not-found')
      const role = await deps.authorize(viewer, documentName)
      if (!role) throw denied('forbidden')
      const stats = socketStats(socketId)
      if (!stats.boards.has(documentName) && stats.boards.size >= MAX_BOARDS_PER_SOCKET) throw denied('too-many-boards')
      stats.boards.add(documentName)
      // Hocuspocus drops document updates from read-only connections
      connectionConfig.readOnly = !canEdit(role)
      deps.onOpened?.(viewer, documentName)
      return { role }
    },
    async onLoadDocument({ document, documentName }) {
      const row = await db
        .selectFrom('board_state')
        .select('state')
        .where('board_id', '=', documentName)
        .executeTakeFirst()
      if (row) Y.applyUpdate(document, row.state)
      sizes.set(documentName, row?.state.byteLength ?? 0)
      return document
    },
    async onDisconnect({ socketId, documentName }) {
      const stats = sockets.get(socketId)
      stats?.boards.delete(documentName)
      if (stats && !stats.boards.size) sockets.delete(socketId)
    },
    afterUnloadDocument: async ({ documentName }) => void sizes.delete(documentName),
    /**
     * Every message counts against its connection's rate, and against the board's size: a board
     * can't grow past MAX_BOARD_BYTES in memory between two saves.
     */
    async beforeHandleMessage({ socketId, documentName, update, connection }) {
      const stats = socketStats(socketId)
      const now = Date.now()
      if (now > stats.reset) {
        stats.bytes = 0
        stats.messages = 0
        stats.reset = now + WINDOW_MS
      }
      stats.bytes += update.byteLength
      stats.messages++
      if (stats.bytes > config.maxMessageBytes * 5 || stats.messages > MAX_MESSAGES_PER_WINDOW) {
        log('warn', 'A connection sent too much: closed', { board: documentName })
        connection.webSocket.close(4429, 'too-fast')
        throw denied('too-fast')
      }
      const size = (sizes.get(documentName) ?? 0) + update.byteLength
      sizes.set(documentName, size)
      if (size > config.maxBoardBytes) {
        log('warn', 'Board over the size limit: change refused', { board: documentName })
        connection.webSocket.close(4413, 'board-too-large')
        throw denied('board-too-large')
      }
    },
    /** Presence says who you are as the server knows you, never what the client claims. */
    async beforeHandleAwareness({ states, context }) {
      const viewer = context?.viewer
      if (!viewer) return
      for (const [clientId, state] of states) {
        const peer = (state?.peer ?? {}) as Record<string, unknown>
        states.set(clientId, {
          peer: { uid: viewer.id, name: viewer.name, x: coordinate(peer.x), y: coordinate(peer.y) },
        })
      }
    },
    async onStoreDocument({ document, documentName, lastContext }) {
      try {
        await store(documentName, document, lastContext)
      } catch (err) {
        log('error', 'Saving a board failed', { board: documentName, error: String(err) })
        throw err
      }
    },
  })

  /**
   * Sessions end while their sockets are open: expired, signed out elsewhere, deleted. Sockets
   * signed in from headers are closed after a while so the app reconnects and is checked again.
   */
  async function sweep(now = Date.now()) {
    const keys = new Set<string>()
    for (const entry of live) {
      const session = entry.viewer.session
      if (session && session.expiresAt <= now) entry.ws.close(4401, 'session-expired')
      else if (session) keys.add(session.key)
      else if (now - entry.opened > MAX_SOCKET_AGE_MS) entry.ws.close(4401, 'check-again')
    }
    const list = [...keys]
    const alive = new Set<string>()
    for (let i = 0; i < list.length; i += 500) {
      const rows = await db
        .selectFrom('sessions')
        .select('id_hash')
        .where('id_hash', 'in', list.slice(i, i + 500))
        .execute()
      for (const r of rows) alive.add(r.id_hash)
    }
    for (const entry of live)
      if (entry.viewer.session && !alive.has(entry.viewer.session.key)) entry.ws.close(4401, 'signed-out')
  }
  const sweeper = setInterval(
    () => void sweep().catch((err) => log('warn', 'Checking live sessions failed', { error: String(err) })),
    SWEEP_MS,
  )
  sweeper.unref()

  const wss = new WebSocketServer({ noServer: true, maxPayload: config.maxMessageBytes, perMessageDeflate: false })

  return {
    hocuspocus,

    /** Takes over an upgrade the HTTP server has already checked (Origin, session). */
    upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, viewer: Viewer) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        // Hocuspocus gets the address and harmless headers, never the cookies
        const headers = new Headers()
        for (const name of ['user-agent', 'origin']) {
          const v = req.headers[name]
          if (typeof v === 'string') headers.set(name, v)
        }
        const request = new Request(new URL(req.url || '/', config.url), { headers })
        const client = hocuspocus.handleConnection(ws as unknown as WebSocketLike, request, { viewer })
        const entry = { ws, viewer, opened: Date.now() }
        live.add(entry)
        ws.on('message', (data) => client.handleMessage(toBytes(data)))
        ws.on('close', (code, reason) => {
          live.delete(entry)
          client.handleClose({ code, reason: reason.toString() } as CloseEvent)
        })
        ws.on('pong', () => client.touch())
        ws.on('error', () => ws.terminate())
      })
    },

    sweep,

    /** Closes the WebSockets of a session that ended (signed out). */
    closeSession(key: string) {
      for (const entry of live) if (entry.viewer.session?.key === key) entry.ws.close(4401, 'signed-out')
    },

    /** How many people have a board open right now. */
    online: (boardId: string): number => hocuspocus.documents.get(boardId)?.getConnectionsCount() ?? 0,

    /**
     * Closes the WebSockets of everyone on a board (access changed): their apps reconnect and are
     * checked again, so they keep editing, become viewers, or are refused.
     */
    recheck(boardId: string) {
      for (const connection of hocuspocus.documents.get(boardId)?.getConnections() ?? [])
        connection.webSocket.close(4000, 'access-changed')
    },

    /** Changes a board from the server (title, import): open tabs see it live. */
    async edit(boardId: string, change: (doc: Y.Doc) => void) {
      const connection = await hocuspocus.openDirectConnection(boardId, { system: true })
      try {
        await connection.transact(change)
      } finally {
        await connection.disconnect()
      }
    },

    /** The board as it is now: from memory when it's open, otherwise from the database. */
    async state(boardId: string): Promise<Uint8Array | null> {
      const open = hocuspocus.documents.get(boardId)
      if (open) return Y.encodeStateAsUpdate(open)
      const row = await db.selectFrom('board_state').select('state').where('board_id', '=', boardId).executeTakeFirst()
      return row?.state ?? null
    },

    /** Saves every open board and closes all connections (shutdown). */
    async close() {
      clearInterval(sweeper)
      hocuspocus.flushPendingStores()
      hocuspocus.closeConnections()
      for (const ws of wss.clients) ws.terminate()
      await new Promise<void>((resolve) => wss.close(() => resolve()))
      // let the saves started above finish
      for (let i = 0; i < 50 && hocuspocus.getDocumentsCount() > 0; i++) await new Promise((r) => setTimeout(r, 100))
    },
  }
}

export type Sync = ReturnType<typeof createSync>
