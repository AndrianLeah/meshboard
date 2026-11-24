// Local identity (name + id), session tokens and recent boards.
// Everything lives in the browser's localStorage: there are no accounts.
import type { BoardToken, User } from './types.ts'

const KEY_USER = 'meshboard:user'
const KEY_RECENT = 'meshboard:recent'

export interface RecentBoard {
  token: string
  title: string
  /** when it was last opened, ms since 1970 */
  opened: number
}

function readJSON(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage full or blocked: carry on without remembering */
  }
}

/** `bytes` random bytes, base64url without padding. */
export function randomId(bytes = 8): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes))
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/** The local user. The id is stable for this browser. */
export function getUser(): User {
  const u = readJSON(KEY_USER) as Partial<User> | null
  if (u && typeof u.id === 'string') return { id: u.id, name: typeof u.name === 'string' ? u.name : '' }
  const fresh = { id: randomId(9), name: '' }
  writeJSON(KEY_USER, fresh)
  return fresh
}

export function setUserName(name: string): User {
  const u = getUser()
  u.name = name.trim().slice(0, 40)
  writeJSON(KEY_USER, u)
  return u
}

// The token is "<roomId>.<secret>": the roomId identifies the room on the relays
// and the secret encrypts the handshake, so nobody without the link can join.
export function newToken(): string {
  return `${randomId(12)}.${randomId(16)}`
}

/** A token from a token, a `#hash` or a whole invite link; null when there is none. */
export function parseToken(input: unknown): BoardToken | null {
  if (!input) return null
  let s = String(input).trim()
  const hash = s.indexOf('#')
  if (hash >= 0) s = s.slice(hash + 1)
  s = s.replace(/^b=/, '')
  const m = s.match(/^([A-Za-z0-9_-]{8,64})\.([A-Za-z0-9_-]{8,64})$/)
  return m ? { token: s, roomId: m[1], secret: m[2] } : null
}

export function shareUrl(token: string): string {
  const url = new URL(location.href)
  url.hash = token
  url.search = ''
  return url.toString()
}

const isRecent = (r: unknown): r is RecentBoard =>
  Boolean(r) && typeof r === 'object' && parseToken((r as RecentBoard).token) !== null

export function getRecent(): RecentBoard[] {
  const list = readJSON(KEY_RECENT)
  return Array.isArray(list) ? list.filter(isRecent) : []
}

export function touchRecent(token: string, title: string): void {
  const list = getRecent().filter((r) => r.token !== token)
  list.unshift({ token, title: title || 'Untitled board', opened: Date.now() })
  writeJSON(KEY_RECENT, list.slice(0, 20))
}

export function forgetRecent(token: string): void {
  writeJSON(
    KEY_RECENT,
    getRecent().filter((r) => r.token !== token),
  )
}

/** Stable colour for a user id (cursors and avatars). */
export function userColor(id: string): string {
  let h = 0
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return `hsl(${h % 360} 70% 45%)`
}

export function initials(name: string): string {
  const parts = String(name || '?')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  const s = parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] || '?').slice(0, 2)
  return s.toUpperCase()
}
