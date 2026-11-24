// The whole server: one HTTP server for the app, /config.json, sign-in, the API and the live-sync
// WebSocket. createApp() wires the pieces; main.ts reads the settings and starts it, and the tests
// start it on a random port.
import { createServer, STATUS_CODES } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { sql } from 'kysely'
import type { Config } from './config.ts'
import type { Db } from './db.ts'
import type { Viewer } from './access.ts'
import { createAuth } from './auth.ts'
import { createApi } from './api.ts'
import { createBoards } from './boards.ts'
import type { Boards } from './boards.ts'
import { createStatic } from './static.ts'
import { createSync } from './sync.ts'
import { createWebhooks } from './webhooks.ts'
import { createUserCache, purgeExpiredSessions } from './users.ts'
import { HttpError, clientIp, createLimiter, redirect, securityHeaders, sendJson } from './http.ts'
import type { Ctx } from './http.ts'
import type { Logger } from './util.ts'

export interface AppDeps {
  db: Db
  log: Logger
  /** signs short-lived cookies (the OpenID Connect sign-in) */
  secret: string
  fetch?: typeof fetch
  /** shorter save delays for tests */
  saveDelayMs?: number
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export function createApp(config: Config, deps: AppDeps) {
  const { db, log } = deps
  const upsert = createUserCache(db)
  const auth = createAuth({ config, db, upsert, secret: deps.secret, log, fetch: deps.fetch })
  const webhooks = createWebhooks(config.webhook, log, { fetch: deps.fetch })
  const urlOf = (id: string) => new URL(`b/${id}`, config.url).toString()

  let boards: Boards | null = null
  const sync = createSync({
    db,
    config,
    log,
    authorize: (viewer, id) => boards!.authorize(viewer, id),
    onOpened: (viewer, id) =>
      void boards!.visit(viewer, id).catch((err) => log('warn', 'Recording a visit failed', { error: String(err) })),
    onStored: (id, info) =>
      webhooks.emit('board.updated', {
        board: { id, title: info.title, url: urlOf(id) },
        actor: info.updatedBy ? { id: info.updatedBy, name: '' } : null,
      }),
    debounceMs: deps.saveDelayMs,
    maxDebounceMs: deps.saveDelayMs && deps.saveDelayMs * 5,
  })
  boards = createBoards({ db, config, sync, webhooks })
  const api = createApi({ boards, db, config })
  const serve = createStatic(config.staticDir, config.basePath)
  const limits = {
    auth: createLimiter(30, 60_000),
    api: createLimiter(1200, 60_000),
    sync: createLimiter(120, 60_000),
  }
  const headers = securityHeaders(config)
  const clientConfig = JSON.stringify({
    mode: 'server',
    orgName: config.orgName,
    basePath: config.basePath,
    auth: auth.info,
  })

  async function handle(req: IncomingMessage, res: ServerResponse) {
    // the configured address, never the Host header
    const url = new URL(req.url || '/', config.url)
    const method = req.method || 'GET'
    if (!url.pathname.startsWith(config.basePath)) {
      if (`${url.pathname}/` === config.basePath) return redirect(res, config.basePath)
      throw new HttpError(404, 'not-found', 'Not found')
    }
    const path = `/${url.pathname.slice(config.basePath.length)}`
    const ip = clientIp(req, config)
    let viewer: Promise<Viewer | null> | null = null
    const ctx: Ctx = { req, res, url, path, params: {}, ip, viewer: () => (viewer ??= auth.identify(req)) }

    if (path === '/healthz') return sendJson(res, 200, { ok: true })
    if (path === '/readyz') {
      await sql`select 1`.execute(db)
      return sendJson(res, 200, { ok: true })
    }
    if (path === '/config.json') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      return void res.end(clientConfig)
    }
    if (path.startsWith('/auth/')) {
      if (!limits.auth(ip)) throw new HttpError(429, 'slow-down', 'Too many sign-in attempts. Wait a minute.')
      if (await auth.handle(ctx)) return
      throw new HttpError(404, 'not-found', 'Not found')
    }
    if (path.startsWith('/api/')) {
      if (!limits.api(ip)) throw new HttpError(429, 'slow-down', 'Too many requests. Wait a minute.')
      const match = api.match(method, path)
      if (!match) throw new HttpError(404, 'not-found', 'No such endpoint')
      ctx.params = match.params
      return void (await match.handler(ctx))
    }
    if ((method === 'GET' || method === 'HEAD') && (await serve(path, res, method === 'HEAD'))) return
    throw new HttpError(404, 'not-found', 'Not found')
  }

  function fail(req: IncomingMessage, res: ServerResponse, err: unknown) {
    const known = err instanceof HttpError
    if (!known) log('error', 'Request failed', { path: req.url?.split('?')[0], error: String(err) })
    const status = known ? err.status : 500
    const code = known ? err.code : 'server-error'
    const message = known ? err.message : 'Something went wrong'
    if (res.headersSent) return void res.destroy()
    const path = new URL(req.url || '/', config.url).pathname
    // a browser landing on a sign-in page gets a page, not JSON
    if (req.method === 'GET' && path.startsWith(`${config.basePath}auth/`)) {
      const html = `<!doctype html><meta charset="utf-8"><title>Meshboard</title><body style="font:16px system-ui;max-width:32rem;margin:15vh auto;padding:0 1rem"><h1 style="font-size:20px">Couldn't sign you in</h1><p>${escapeHtml(message)}</p><p><a href="${escapeHtml(config.basePath)}">Back to Meshboard</a></p></body>`
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      return void res.end(html)
    }
    sendJson(res, status, { error: code, message })
  }

  const server = createServer((req, res) => {
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
    handle(req, res).catch((err) => fail(req, res, err))
  })
  server.headersTimeout = 20_000
  server.requestTimeout = 60_000

  function refuse(socket: Duplex, status: number) {
    socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
  }

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on('error', () => socket.destroy())
    ;(async () => {
      const url = new URL(req.url || '/', config.url)
      if (url.pathname !== `${config.basePath}sync`) return refuse(socket, 404)
      // browsers always send Origin on WebSockets: another site can't open one with our cookies
      if (req.headers.origin !== config.url.origin) return refuse(socket, 403)
      if (!limits.sync(clientIp(req, config))) return refuse(socket, 429)
      const viewer = await auth.identify(req).catch(() => null)
      if (!viewer) return refuse(socket, 401)
      // API tokens are for the JSON API, not for live editing
      if (viewer.scopes) return refuse(socket, 403)
      sync.upgrade(req, socket, head, viewer)
    })().catch((err) => {
      log('error', 'WebSocket upgrade failed', { error: String(err) })
      refuse(socket, 500)
    })
  })

  const sweeper = setInterval(
    () => void purgeExpiredSessions(db).catch((err) => log('warn', 'Session cleanup failed', { error: String(err) })),
    60 * 60_000,
  )
  sweeper.unref()

  return {
    server,
    sync,
    boards,
    auth,
    webhooks,
    async close() {
      clearInterval(sweeper)
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
      await sync.close()
      await webhooks.drain()
    },
  }
}

export type App = ReturnType<typeof createApp>
