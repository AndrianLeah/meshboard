// TURN relays carry the connection when two networks can't connect directly, as is common on
// mobile data and office networks. The traffic stays end-to-end encrypted (WebRTC's DTLS): a relay
// only passes it on. They're optional and set when the app is built (see the README): fixed
// credentials, or a URL that hands them out (as Metered's TURN API does).

/** The build settings read here (import.meta.env in the app). */
export interface TurnEnv {
  /** TURN server URLs, separated by commas or spaces */
  readonly VITE_TURN_URLS?: string
  readonly VITE_TURN_USERNAME?: string
  readonly VITE_TURN_CREDENTIAL?: string
  /** a URL answering with ICE servers: an array, or `{ iceServers }` */
  readonly VITE_TURN_CREDENTIALS_URL?: string
}

/** What fetchTurnServers needs from the page; the tests pass their own. */
export interface TurnDeps {
  fetch?: (url: string, init: { signal: AbortSignal }) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null
  now?: () => number
  timeoutMs?: number
}

const ICE_URL = /^(stuns?|turns?):/i
const CACHE_KEY = 'meshboard:turn'
const CACHE_MS = 6 * 60 * 60 * 1000
const TIMEOUT_MS = 3000

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** The ICE servers in `raw` (an array, or `{ iceServers }`), without anything malformed. */
export function parseIceServers(raw: unknown): RTCIceServer[] {
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.iceServers)
      ? raw.iceServers
      : []
  return list.flatMap((s) => {
    if (!isRecord(s)) return []
    const urls = [s.urls].flat().filter((u): u is string => typeof u === 'string' && ICE_URL.test(u.trim()))
    if (!urls.length) return []
    const server: RTCIceServer = { urls: urls.map((u) => u.trim()) }
    if (typeof s.username === 'string' && s.username) server.username = s.username
    if (typeof s.credential === 'string' && s.credential) server.credential = s.credential
    return [server]
  })
}

/** The fixed TURN servers of the build settings, if any. */
export function fixedTurnServers(env: TurnEnv): RTCIceServer[] {
  const urls = (env.VITE_TURN_URLS ?? '').split(/[\s,]+/).filter(Boolean)
  return parseIceServers([{ urls, username: env.VITE_TURN_USERNAME, credential: env.VITE_TURN_CREDENTIAL }])
}

function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/**
 * The ICE servers handed out by `url`, kept for a few hours so that opening a board doesn't wait
 * for them every time. None when the URL fails or takes too long: boards still connect directly.
 */
export async function fetchTurnServers(
  url: string,
  { fetch: get = globalThis.fetch, storage = browserStorage(), now = Date.now, timeoutMs = TIMEOUT_MS }: TurnDeps = {},
): Promise<RTCIceServer[]> {
  try {
    const cached: unknown = JSON.parse(storage?.getItem(CACHE_KEY) || 'null')
    if (isRecord(cached) && cached.url === url && typeof cached.at === 'number' && now() - cached.at < CACHE_MS) {
      const servers = parseIceServers(cached.servers)
      if (servers.length) return servers
    }
  } catch {
    /* no usable copy */
  }
  try {
    const res = await get(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const servers = parseIceServers(await res.json())
    try {
      if (servers.length) storage?.setItem(CACHE_KEY, JSON.stringify({ url, at: now(), servers }))
    } catch {
      /* not kept */
    }
    return servers
  } catch (err) {
    console.warn('[meshboard] No TURN servers from the credentials URL:', err)
    return []
  }
}

/** Every TURN server the build is set up with: the fixed ones, then those from the URL. */
export async function loadTurnServers(env: TurnEnv, deps?: TurnDeps): Promise<RTCIceServer[]> {
  const fixed = fixedTurnServers(env)
  const url = env.VITE_TURN_CREDENTIALS_URL?.trim()
  return url ? [...fixed, ...(await fetchTurnServers(url, deps))] : fixed
}

let loaded: Promise<RTCIceServer[]> | null = null
/** This build's TURN servers, loaded once per page. */
export const turnServers = (): Promise<RTCIceServer[]> => (loaded ??= loadTurnServers(import.meta.env))
