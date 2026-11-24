// Images on a board are addresses: Meshboard never keeps the files. These are the rules about
// them, with no DOM: which addresses may be shown, what in pasted text is an image, and the
// converter that turns an upload endpoint's answer into an image.
import { imageSrc } from './schema.ts'

/** Where pictures go when someone adds a file, and how to read the answer. */
export interface UploadSettings {
  url: string
  method: 'POST' | 'PUT'
  /** the form field the file is sent in */
  field: string
  /** extra headers, the same for everyone (visible to anyone who can open the app) */
  headers: Record<string, string>
  /** send the browser's cookies for the endpoint's site (`include`), or not */
  credentials: 'include' | 'omit'
  /** the converter: where the address is in the JSON answer (`data.url`); empty: the whole answer is the address */
  urlPath: string
  widthPath: string
  heightPath: string
  maxBytes: number
}

export interface ImageSettings {
  upload: UploadSettings | null
  /** origins images may come from; empty: any https address */
  origins: string[]
}

export const NO_UPLOADS: ImageSettings = { upload: null, origins: [] }
export const MAX_UPLOAD_BYTES = 10_000_000
/** Kinds of file sent to the endpoint. SVG isn't: an upload shouldn't put a script on someone's site. */
export const UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const HEADER = /^[A-Za-z0-9-]{1,64}$/
const PATH = /^[A-Za-z0-9_$-]+(\.[A-Za-z0-9_$-]+)*$/

/** An origin (`https://images.example`), or null. */
export function originOf(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const u = new URL(value.trim())
    return u.protocol === 'https:' || u.hostname === 'localhost' ? u.origin : null
  } catch {
    return null
  }
}

/** Settings from config.json (a server) or the build: anything unusable is left out. */
export function parseImageSettings(raw: unknown): ImageSettings {
  if (!isRecord(raw)) return NO_UPLOADS
  const origins = Array.isArray(raw.origins)
    ? raw.origins
        .map(originOf)
        .filter((o): o is string => Boolean(o))
        .slice(0, 50)
    : []
  const up = raw.upload
  if (!isRecord(up)) return { upload: null, origins }
  const url = originOf(up.url) && typeof up.url === 'string' ? up.url.trim() : null
  if (!url) return { upload: null, origins }
  const headers: Record<string, string> = {}
  if (isRecord(up.headers))
    for (const [k, v] of Object.entries(up.headers))
      if (HEADER.test(k) && typeof v === 'string' && v.length < 4000) headers[k] = v
  const path = (v: unknown) => (typeof v === 'string' && PATH.test(v) ? v : '')
  const max = Number(up.maxBytes)
  return {
    upload: {
      url,
      method: up.method === 'PUT' ? 'PUT' : 'POST',
      field: typeof up.field === 'string' && HEADER.test(up.field) ? up.field : 'file',
      headers,
      credentials: up.credentials === 'include' ? 'include' : 'omit',
      urlPath: path(up.urlPath),
      widthPath: path(up.widthPath),
      heightPath: path(up.heightPath),
      maxBytes: Number.isInteger(max) && max > 0 ? Math.min(max, 100_000_000) : MAX_UPLOAD_BYTES,
    },
    origins,
  }
}

/** Build settings (VITE_UPLOAD_*), for the peer-to-peer site. */
export function imageSettingsFromEnv(env: Record<string, string | undefined>): ImageSettings {
  let headers: unknown
  try {
    headers = env.VITE_UPLOAD_HEADERS ? JSON.parse(env.VITE_UPLOAD_HEADERS) : {}
  } catch {
    // not JSON: no extra headers
    headers = {}
  }
  return parseImageSettings({
    origins: (env.VITE_IMAGE_ORIGINS ?? '').split(/[\s,]+/).filter(Boolean),
    upload: env.VITE_UPLOAD_URL
      ? {
          url: env.VITE_UPLOAD_URL,
          method: env.VITE_UPLOAD_METHOD,
          field: env.VITE_UPLOAD_FIELD,
          headers,
          credentials: env.VITE_UPLOAD_CREDENTIALS,
          urlPath: env.VITE_UPLOAD_URL_PATH,
          widthPath: env.VITE_UPLOAD_WIDTH_PATH,
          heightPath: env.VITE_UPLOAD_HEIGHT_PATH,
          maxBytes: env.VITE_UPLOAD_MAX_BYTES,
        }
      : null,
  })
}

/** May this board show a picture from `src`? Only https, and only from the allowed origins if any. */
export function isAllowedImage(src: string, settings: ImageSettings): boolean {
  const clean = imageSrc(src)
  if (!clean) return false
  return !settings.origins.length || settings.origins.includes(new URL(clean).origin)
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i

/** The image addresses in pasted text: every line must be one (an https address ending like a picture). */
export function imageUrls(text: string): string[] | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (!lines.length || lines.length > 20) return null
  const out: string[] = []
  for (const line of lines) {
    const src = imageSrc(line)
    if (!src || !IMAGE_EXT.test(new URL(src).pathname)) return null
    out.push(src)
  }
  return out
}

/** `data.items.0.url` in a JSON value. */
export function readPath(data: unknown, path: string): unknown {
  let v: unknown = data
  for (const key of path.split('.')) {
    if (Array.isArray(v) && /^\d+$/.test(key)) v = v[Number(key)]
    else if (isRecord(v) && Object.prototype.hasOwnProperty.call(v, key)) v = v[key]
    else return undefined
  }
  return v
}

export interface UploadedImage {
  src: string
  w?: number
  h?: number
}

/**
 * The converter: the endpoint's answer (JSON, or the address as text) → an image. A relative
 * address is read against the endpoint's. Throws when there's no usable https address.
 */
export function convertUpload(answer: unknown, settings: UploadSettings): UploadedImage {
  const raw = settings.urlPath ? readPath(answer, settings.urlPath) : answer
  if (typeof raw !== 'string' || !raw.trim())
    throw new Error(
      settings.urlPath
        ? `The upload answer has no address at "${settings.urlPath}"`
        : 'The upload answer is not an address',
    )
  let resolved: string
  try {
    resolved = new URL(raw.trim(), settings.url).href
  } catch {
    throw new Error('The upload answer is not an address')
  }
  const src = imageSrc(resolved)
  if (!src) throw new Error('The uploaded image must have an https address')
  const size = (path: string) => {
    if (!path) return undefined
    const n = Number(readPath(answer, path))
    return Number.isFinite(n) && n > 0 && n < 100_000 ? n : undefined
  }
  const w = size(settings.widthPath)
  const h = size(settings.heightPath)
  return { src, ...(w && h ? { w, h } : {}) }
}

/** The size an image takes on the board: its own proportions, at most `max` on its long side. */
export function fitImage(w: number | undefined, h: number | undefined, max = 480): { w: number; h: number } {
  if (!w || !h) return { w: 320, h: 240 }
  const scale = Math.min(1, max / Math.max(w, h))
  return { w: Math.max(20, Math.round(w * scale)), h: Math.max(20, Math.round(h * scale)) }
}
