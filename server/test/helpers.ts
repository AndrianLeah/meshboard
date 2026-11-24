// Starting a real server for a test: a free port, SQLite (or TEST_DATABASE_URL) in a temporary
// folder, and clients that keep their own cookies.
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import { parseConfig } from '../src/config.ts'
import { openDatabase } from '../src/db.ts'
import { createApp } from '../src/app.ts'
import { jsonLogger, silentLogger } from '../src/util.ts'
import type { App } from '../src/app.ts'
import type { Database } from '../src/db.ts'
import type { Config } from '../src/config.ts'

export const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number }
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })

export interface TestServer {
  url: string
  origin: string
  config: Config
  app: App
  database: Database
  dir: string
  /** stops the server (keeps the data unless `wipe`) */
  stop: (wipe?: boolean) => Promise<void>
}

export async function startServer(
  env: Record<string, string> = {},
  { dir, fetch: doFetch }: { dir?: string; fetch?: typeof fetch } = {},
): Promise<TestServer> {
  const port = await freePort()
  const dataDir = dir ?? mkdtempSync(join(tmpdir(), 'meshboard-test-'))
  const url = `http://localhost:${port}`
  const config = parseConfig({
    MESHBOARD_URL: url,
    PORT: String(port),
    HOST: '127.0.0.1',
    DATA_DIR: dataDir,
    STATIC_DIR: join(import.meta.dirname, 'fixtures', 'app'),
    ...(process.env.TEST_DATABASE_URL ? { DATABASE_URL: process.env.TEST_DATABASE_URL } : {}),
    ...env,
  })
  const database = await openDatabase({ databaseUrl: config.databaseUrl, dataDir: config.dataDir })
  // a shared test Postgres starts each server empty (a restart keeps its data)
  if (config.databaseUrl && !dir)
    for (const table of [
      'board_members',
      'board_stars',
      'board_visits',
      'board_state',
      'api_tokens',
      'sessions',
      'boards',
      'users',
    ] as const)
      await database.db.deleteFrom(table).execute()
  const app = createApp(config, {
    db: database.db,
    log: process.env.TEST_LOG ? jsonLogger : silentLogger,
    secret: 's'.repeat(48),
    fetch: doFetch,
    saveDelayMs: 50,
  })
  await new Promise<void>((resolve) => app.server.listen(port, '127.0.0.1', resolve))
  return {
    url,
    origin: url,
    config,
    app,
    database,
    dir: dataDir,
    async stop(wipe = true) {
      await app.close()
      await database.close()
      if (wipe && !dir) rmSync(dataDir, { recursive: true, force: true })
    },
  }
}

export interface Reply {
  status: number
  headers: Headers
  body: unknown
  text: string
}

/** A browser-like client: keeps cookies, sends this server's Origin and JSON. */
export function client(server: { url: string; origin: string }, { origin = server.origin } = {}) {
  const jar = new Map<string, string>()
  async function call(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<Reply> {
    const res = await fetch(new URL(path, `${server.url}/`), {
      method,
      redirect: 'manual',
      headers: {
        ...(jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
        ...(origin ? { origin } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    })
    for (const cookie of res.headers.getSetCookie()) {
      const [pair] = cookie.split(';')
      const eq = pair.indexOf('=')
      const name = pair.slice(0, eq)
      const value = pair.slice(eq + 1)
      if (/Max-Age=0/i.test(cookie)) jar.delete(name)
      else jar.set(name, value)
    }
    const text = await res.text()
    let parsed: unknown = null
    try {
      parsed = JSON.parse(text)
    } catch {
      /* not JSON */
    }
    return { status: res.status, headers: res.headers, body: parsed, text }
  }
  return {
    jar,
    cookieHeader: () => [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
    get: (path: string, headers?: Record<string, string>) => call('GET', path, undefined, headers),
    post: (path: string, body: unknown = {}, headers?: Record<string, string>) => call('POST', path, body, headers),
    put: (path: string, body: unknown = {}) => call('PUT', path, body),
    patch: (path: string, body: unknown) => call('PATCH', path, body),
    delete: (path: string) => call('DELETE', path, undefined),
    call,
  }
}

export type Client = ReturnType<typeof client>

/** AUTH=none: a person signed in with a name. */
export async function guest(server: TestServer, name: string): Promise<Client> {
  const c = client(server)
  const res = await c.post('auth/guest', { name })
  if (res.status !== 200) throw new Error(`guest sign-in failed: ${res.status} ${res.text}`)
  return c
}

/** A live-sync connection for a board, with that client's cookies and Origin. */
export function provider(
  server: TestServer,
  who: Client | null,
  boardId: string,
  doc = new Y.Doc(),
  origin = server.origin,
) {
  const headers: Record<string, string> = { origin }
  if (who) headers.cookie = who.cookieHeader()
  class Socket extends WebSocket {
    constructor(address: string, protocols?: string | string[]) {
      super(address, protocols, { headers })
    }
  }
  const failures: string[] = []
  const websocket = new HocuspocusProviderWebsocket({
    url: `${server.url.replace('http', 'ws')}/sync`,
    WebSocketPolyfill: Socket,
    delay: 50,
    minDelay: 50,
    maxDelay: 200,
  })
  const p = new HocuspocusProvider({
    websocketProvider: websocket,
    name: boardId,
    document: doc,
    token: 'session',
    onAuthenticationFailed: ({ reason }) => failures.push(reason),
  })
  // with its own WebSocket, a provider only joins once attached
  p.attach()
  return {
    doc,
    provider: p,
    failures,
    synced: () => waitFor(() => p.isSynced, 'sync'),
    denied: () => waitFor(() => failures.length > 0, 'permission denied'),
    destroy() {
      p.destroy()
      websocket.destroy()
    },
  }
}

export async function waitFor(check: () => boolean, what = 'condition', timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 20))
  }
}

/** Opens a raw WebSocket to /sync and reports how the upgrade went. */
export function rawUpgrade(server: TestServer, headers: Record<string, string>, path = '/sync'): Promise<number> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${server.url.replace('http', 'ws')}${path}`, { headers })
    ws.on('open', () => {
      ws.close()
      resolve(101)
    })
    ws.on('unexpected-response', (_req, res) => {
      resolve(res.statusCode ?? 0)
      ws.terminate()
    })
    ws.on('error', () => resolve(0))
  })
}
