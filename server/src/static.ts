// The built app (dist/): files by path, the page for every app address (/, /b/<id>), long caching
// for hashed assets. The page gets a <base> so relative addresses work under /b/… and a sub-path.
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import type { ServerResponse } from 'node:http'
import { HttpError } from './http.ts'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

/** Addresses that show the app itself. */
const APP_ROUTE = /^\/(b\/[A-Za-z0-9_-]{1,64}\/?)?$/

export function createStatic(dir: string, basePath: string) {
  const root = normalize(dir + sep)
  let page: Promise<string> | null = null

  /** index.html with a <base> for the app's path. */
  const indexHtml = () =>
    (page ??= readFile(join(root, 'index.html'), 'utf8')
      .then((html) => html.replace(/<head>/i, `<head>\n    <base href="${basePath.replace(/"/g, '')}" />`))
      .catch((err: unknown) => {
        page = null
        throw err
      }))

  async function sendPage(res: ServerResponse, head: boolean) {
    let html: string
    try {
      html = await indexHtml()
    } catch {
      throw new HttpError(503, 'no-app', 'The app is not built: run npm run build')
    }
    res.writeHead(200, {
      'content-type': TYPES['.html'],
      'cache-control': 'no-cache',
      'content-length': Buffer.byteLength(html),
    })
    res.end(head ? undefined : html)
  }

  /** Serves `path` (below the base path); false when there's no such file or page. */
  return async function serve(path: string, res: ServerResponse, head = false): Promise<boolean> {
    if (APP_ROUTE.test(path) || path === '/index.html') {
      await sendPage(res, head)
      return true
    }
    let decoded: string
    try {
      decoded = decodeURIComponent(path)
    } catch {
      return false
    }
    // no dotfiles, no way out of dist/
    if (decoded.includes('\0') || decoded.split('/').some((part) => part.startsWith('.'))) return false
    const file = normalize(join(root, decoded))
    if (!file.startsWith(root)) return false
    const info = await stat(file).catch(() => null)
    if (!info?.isFile()) return false
    const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
    const immutable = decoded.startsWith('/assets/')
    res.writeHead(200, {
      'content-type': type,
      'content-length': info.size,
      // hashed names never change; the service worker and the manifest must stay fresh
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
    if (head) {
      res.end()
      return true
    }
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(file)
      stream.on('error', reject)
      res.on('close', resolve)
      stream.pipe(res)
    })
    return true
  }
}
