// Sending a picture to the configured upload endpoint and measuring pictures before they go on
// the board. The file goes to the endpoint only: Meshboard keeps the address it answers with.
import { MAX_UPLOAD_BYTES, UPLOAD_TYPES, convertUpload } from '../core/images.ts'
import type { UploadSettings, UploadedImage } from '../core/images.ts'

export class UploadError extends Error {}

/** Uploads one file; resolves with the image the converter read from the answer. */
export async function uploadImage(
  file: File,
  settings: UploadSettings,
  { fetch: get = fetch, timeoutMs = 60_000 }: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<UploadedImage> {
  if (!UPLOAD_TYPES.includes(file.type))
    throw new UploadError(`${file.name || 'This file'} isn't a PNG, JPEG, GIF, WebP or AVIF image.`)
  if (file.size > (settings.maxBytes || MAX_UPLOAD_BYTES))
    throw new UploadError(`${file.name || 'The image'} is larger than ${Math.round(settings.maxBytes / 1e6)} MB.`)
  const body = new FormData()
  body.append(settings.field, file, file.name || 'image')
  let res: Response
  try {
    res = await get(settings.url, {
      method: settings.method,
      body,
      headers: settings.headers,
      credentials: settings.credentials,
      // the endpoint is your storage, never a page to follow somewhere else
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    throw new UploadError("Couldn't reach the image upload. Check your connection.")
  }
  if (!res.ok) throw new UploadError(`The image upload failed (${res.status}).`)
  const type = res.headers.get('content-type') ?? ''
  const answer: unknown = type.includes('json') ? await res.json().catch(() => null) : (await res.text()).trim()
  try {
    return convertUpload(answer, settings)
  } catch (err) {
    throw new UploadError((err as Error).message)
  }
}

/** A picture's own size, or nothing when it doesn't load in time (it still goes on the board). */
export function measureImage(src: string, timeoutMs = 5000): Promise<{ w?: number; h?: number }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.referrerPolicy = 'no-referrer'
    const done = (size: { w?: number; h?: number }) => {
      clearTimeout(timer)
      img.onload = img.onerror = null
      resolve(size)
    }
    const timer = setTimeout(() => done({}), timeoutMs)
    img.onload = () => done({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => done({})
    img.src = src
  })
}
