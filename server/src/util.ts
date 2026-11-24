// Small helpers: random tokens, hashes, signatures, cookies and the JSON log.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/** `bytes` random bytes as base64url (no padding). */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url')

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

export const hmac = (secret: string, value: string): string => createHmac('sha256', secret).update(value).digest('hex')

/** Compares two strings in constant time (for their length). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * Headers that let a receiver check a request came from this server: a timestamp, and an
 * HMAC-SHA256 of `timestamp.body` with the shared secret. Receivers should reject old timestamps.
 */
export function signatureHeaders(secret: string, body: string, now = Date.now()): Record<string, string> {
  const timestamp = String(Math.floor(now / 1000))
  return {
    'x-meshboard-timestamp': timestamp,
    'x-meshboard-signature': `sha256=${hmac(secret, `${timestamp}.${body}`)}`,
  }
}

/** Checks headers made by signatureHeaders, at most `toleranceS` seconds old. */
export function verifySignature(
  secret: string,
  body: string,
  headers: { timestamp?: string | null; signature?: string | null },
  { now = Date.now(), toleranceS = 300 } = {},
): boolean {
  const ts = Number(headers.timestamp)
  if (!Number.isInteger(ts) || Math.abs(now / 1000 - ts) > toleranceS || !headers.signature) return false
  return safeEqual(headers.signature, `sha256=${hmac(secret, `${ts}.${body}`)}`)
}

/** Signs a small JSON value for a cookie: `base64url(json).hmac`. */
export function seal(secret: string, value: unknown): string {
  const body = Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${body}.${hmac(secret, body)}`
}

/** The value of a sealed cookie, or null when it was changed or isn't one. */
export function unseal(secret: string, sealed: string | undefined): unknown {
  if (!sealed) return null
  const dot = sealed.lastIndexOf('.')
  if (dot < 1) return null
  const body = sealed.slice(0, dot)
  if (!safeEqual(sealed.slice(dot + 1), hmac(secret, body))) return null
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

/** The cookies of a Cookie header. Malformed pairs are skipped; the first of a name wins. */
export function parseCookies(header: string | undefined): Map<string, string> {
  const out = new Map<string, string>()
  if (!header) return out
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 1) continue
    const name = part.slice(0, eq).trim()
    if (!name || out.has(name)) continue
    let value = part.slice(eq + 1).trim()
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    try {
      out.set(name, decodeURIComponent(value))
    } catch {
      /* not URL-encoded properly: skip it */
    }
  }
  return out
}

export interface CookieOptions {
  maxAgeS?: number
  /** cookies for this path only; default the whole app */
  path?: string
  secure: boolean
  sameSite?: 'Lax' | 'Strict'
}

export function serializeCookie(
  name: string,
  value: string,
  { maxAgeS, path = '/', secure, sameSite = 'Lax' }: CookieOptions,
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, 'HttpOnly', `SameSite=${sameSite}`]
  if (secure) parts.push('Secure')
  if (maxAgeS !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAgeS))}`)
  return parts.join('; ')
}

/** Is `value` a plain object (from JSON)? */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g

/** A string trimmed and cut to `max`, or null when there's nothing in it. */
export function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  // control characters never belong in a name, a title or a group
  const t = value.replace(CONTROL, ' ').trim().slice(0, max)
  return t || null
}

export type LogLevel = 'info' | 'warn' | 'error'
export type Logger = (level: LogLevel, message: string, fields?: Record<string, unknown>) => void

/** JSON lines on standard output. Never log board content, tokens or cookies. */
export const jsonLogger: Logger = (level, message, fields = {}) => {
  const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...fields })
  if (level === 'info') process.stdout.write(`${line}\n`)
  else process.stderr.write(`${line}\n`)
}

export const silentLogger: Logger = () => {}
