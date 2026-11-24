// The HTTP basics: a tiny router, JSON in and out, errors, security headers, the client's address
// and the checks that keep other sites from acting with a signed-in person's cookie.
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Config } from './config.ts'
import { isTrusted } from './config.ts'
import type { Viewer } from './access.ts'

export class HttpError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message = code) {
    super(message)
    this.status = status
    this.code = code
  }
}

export interface Ctx {
  req: IncomingMessage
  res: ServerResponse
  url: URL
  /** the path below the app's base path, starting with / */
  path: string
  params: Record<string, string>
  ip: string
  /** who is asking; resolved once per request */
  viewer: () => Promise<Viewer | null>
}

export type Handler = (ctx: Ctx) => Promise<void> | void

interface Route {
  method: string
  pattern: RegExp
  keys: string[]
  handler: Handler
}

export class Router {
  private routes: Route[] = []

  add(method: string, path: string, handler: Handler): this {
    const keys: string[] = []
    const source = path.replace(/:([a-zA-Z]+)/g, (_m, key: string) => {
      keys.push(key)
      return '([^/]+)'
    })
    this.routes.push({ method, pattern: new RegExp(`^${source}$`), keys, handler })
    return this
  }
  get = (path: string, h: Handler) => this.add('GET', path, h)
  post = (path: string, h: Handler) => this.add('POST', path, h)
  put = (path: string, h: Handler) => this.add('PUT', path, h)
  patch = (path: string, h: Handler) => this.add('PATCH', path, h)
  delete = (path: string, h: Handler) => this.add('DELETE', path, h)

  /** The handler for a request, with its path parameters; a 405 when only the method is wrong. */
  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | null {
    let pathMatched = false
    for (const r of this.routes) {
      const m = r.pattern.exec(path)
      if (!m) continue
      pathMatched = true
      if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) continue
      const params: Record<string, string> = {}
      r.keys.forEach((k, i) => {
        try {
          params[k] = decodeURIComponent(m[i + 1])
        } catch {
          throw new HttpError(400, 'bad-request', 'Malformed address')
        }
      })
      return { handler: r.handler, params }
    }
    if (pathMatched) throw new HttpError(405, 'method-not-allowed')
    return null
  }
}

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(data),
    ...headers,
  })
  res.end(data)
}

export function redirect(res: ServerResponse, location: string, headers: Record<string, string | string[]> = {}): void {
  res.writeHead(302, { location, 'cache-control': 'no-store', ...headers })
  res.end()
}

/** The request body as JSON. Only `application/json`, and at most `limit` bytes. */
export async function readJson(req: IncomingMessage, limit = 1_000_000): Promise<unknown> {
  const type = String(req.headers['content-type'] || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  if (type !== 'application/json') throw new HttpError(415, 'unsupported-media-type', 'Send JSON')
  const declared = Number(req.headers['content-length'])
  if (declared > limit) throw new HttpError(413, 'too-large', 'The request is too large')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) throw new HttpError(413, 'too-large', 'The request is too large')
    chunks.push(chunk as Buffer)
  }
  if (!size) return null
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'bad-json', 'The request body is not valid JSON')
  }
}

/**
 * The client's address. Behind a reverse proxy listed in TRUSTED_PROXIES it's the last address in
 * X-Forwarded-For that isn't one of those proxies; otherwise the socket's.
 */
export function clientIp(req: IncomingMessage, config: Pick<Config, 'trustedProxies'>): string {
  const socket = req.socket.remoteAddress || ''
  if (!isTrusted(config.trustedProxies, socket)) return socket
  const forwarded = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  for (let i = forwarded.length - 1; i >= 0; i--) {
    if (!isTrusted(config.trustedProxies, forwarded[i])) return forwarded[i]
  }
  return forwarded[0] || socket
}

/**
 * Requests that change something must come from the app itself: a JSON body (which a plain HTML
 * form can't send) and, from a browser, an Origin of this server. Token requests carry no cookies,
 * so they're exempt.
 */
export function checkSameOrigin(req: IncomingMessage, config: Pick<Config, 'url'>): void {
  const origin = req.headers.origin
  if (origin) {
    if (origin !== config.url.origin) throw new HttpError(403, 'bad-origin', 'Cross-site requests are not allowed')
    return
  }
  const site = req.headers['sec-fetch-site']
  if (site && site !== 'same-origin' && site !== 'none')
    throw new HttpError(403, 'bad-origin', 'Cross-site requests are not allowed')
}

/** Headers on every response. The CSP allows only this server's own scripts, styles and fonts. */
export function securityHeaders(
  config: Pick<Config, 'url' | 'secure'> & Partial<Pick<Config, 'upload' | 'imageOrigins'>>,
): Record<string, string> {
  const ws = `${config.secure ? 'wss' : 'ws'}://${config.url.host}`
  // pictures are addresses: only the allowed sites, or any https address when none are listed
  const images = config.imageOrigins?.length ? config.imageOrigins.join(' ') : 'https:'
  const upload = config.upload ? ` ${new URL(config.upload.url).origin}` : ''
  const headers: Record<string, string> = {
    'content-security-policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      `img-src 'self' data: blob: ${images}`,
      "font-src 'self'",
      `connect-src 'self' ${ws}${upload}`,
      "worker-src 'self'",
      "manifest-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  }
  if (config.secure) headers['strict-transport-security'] = 'max-age=31536000'
  return headers
}

/** A same-site path to come back to after signing in; anything else becomes the base path. */
export function safeReturnTo(value: unknown, basePath: string): string {
  if (typeof value !== 'string' || value.length > 500 || !value.startsWith('/') || /[\\\s]/.test(value)) return basePath
  try {
    // checked after the browser's own normalisation: /..//evil.example would become //evil.example
    const u = new URL(value, 'http://x.invalid')
    if (u.origin !== 'http://x.invalid' || u.pathname.startsWith('//') || !u.pathname.startsWith(basePath))
      return basePath
    return u.pathname + u.search
  } catch {
    return basePath
  }
}

/** The key a client is rate limited by: its address, or its /64 for IPv6 (one host gets a whole /64). */
export function rateKey(ip: string): string {
  if (!ip.includes(':') || ip.startsWith('::ffff:')) return ip
  const full = ip.includes('::')
    ? (() => {
        const [head, tail] = ip.split('::')
        const a = head ? head.split(':') : []
        const b = tail ? tail.split(':') : []
        return [...a, ...Array(8 - a.length - b.length).fill('0'), ...b]
      })()
    : ip.split(':')
  return `${full.slice(0, 4).join(':')}::/64`
}

/** A tiny fixed-window counter per key; true when the request may go ahead. */
export function createLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { count: number; reset: number }>()
  let sweep = Date.now() + windowMs
  return (key: string, now = Date.now()): boolean => {
    if (now > sweep) {
      for (const [k, v] of hits) if (v.reset <= now) hits.delete(k)
      sweep = now + windowMs
    }
    const entry = hits.get(key)
    if (!entry || entry.reset <= now) {
      hits.set(key, { count: 1, reset: now + windowMs })
      return true
    }
    entry.count++
    return entry.count <= limit
  }
}
