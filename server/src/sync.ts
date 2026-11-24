// Live sync: Hocuspocus keeps each open board in memory, merges everyone's edits (Yjs) and saves the
// board a couple of seconds after the last change. The HTTP server hands it WebSockets only after
// checking the Origin and the session; Hocuspocus then asks `authorize` about each board, and makes
// the connection read-only for viewers (it ignores their updates).
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { Hocuspocus } from '@hocuspocus/server'
import type { WebSocketLike } from '@hocuspocus/server'
import { WebSocketServer } from 'ws'
import type { RawData } from 'ws'
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

const toBytes = (data: RawData): Uint8Array => {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data))
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

export function createSync(deps: SyncDeps) {
  const { db, config, log } = deps

  async function store(boardId: string, document: Y.Doc, context: SyncContext | undefined) {
    const state = Y.encodeStateAsUpdate(document)
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
    async onAuthenticate({ documentName, context, connectionConfig }) {
      const viewer = context.viewer
      if (!viewer) throw denied('unauthorized')
      if (!BOARD_ID.test(documentName)) throw denied('not-found')
      const role = await deps.authorize(viewer, documentName)
      if (!role) throw denied('forbidden')
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
      return document
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
        ws.on('message', (data) => client.handleMessage(toBytes(data)))
        ws.on('close', (code, reason) => client.handleClose({ code, reason: reason.toString() } as CloseEvent))
        ws.on('pong', () => client.touch())
        ws.on('error', () => ws.terminate())
      })
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
