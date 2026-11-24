// The JSON API under /api/v1: what the app's dashboard and share dialog use, and what your scripts
// can call with an API token. Bodies are JSON; anything that changes data checks the Origin
// (cookies) or comes with a token (no cookies).
import type { Config } from './config.ts'
import type { Db } from './db.ts'
import type { Viewer } from './access.ts'
import type { Boards, ListQuery, View, Sort, AccessFilter } from './boards.ts'
import { HttpError, Router, checkSameOrigin, readJson, sendJson } from './http.ts'
import type { Ctx } from './http.ts'
import { searchPeople } from './users.ts'
import { isRecord, text } from './util.ts'

const VIEWS: readonly View[] = ['all', 'recent', 'starred', 'shared', 'trash']
const SORTS: readonly Sort[] = ['opened', 'edited', 'title', 'created']
const ACCESS: readonly AccessFilter[] = ['members', 'org_view', 'org_edit', 'group']
const pick = <T extends string>(list: readonly T[], value: string | null): T | undefined =>
  list.find((v) => v === value)

const MAX_BOARD_FILE = 25_000_000

export function createApi({ boards, db, config }: { boards: Boards; db: Db; config: Config }) {
  const router = new Router()

  /** The signed-in viewer; 401 otherwise. Changes also need the same origin, unless a token is used. */
  async function who(ctx: Ctx, { write = false } = {}): Promise<Viewer> {
    const viewer = await ctx.viewer()
    if (!viewer) throw new HttpError(401, 'unauthorized', 'Sign in first')
    if (write && !viewer.scopes) checkSameOrigin(ctx.req, config)
    if (write && viewer.scopes && !viewer.scopes.has('boards:write'))
      throw new HttpError(403, 'forbidden', 'This token can only read')
    return viewer
  }

  const body = async (ctx: Ctx, limit?: number) => {
    const data = await readJson(ctx.req, limit)
    if (!isRecord(data)) throw new HttpError(400, 'bad-request', 'Send a JSON object')
    return data
  }

  router.get('/api/v1/me', async (ctx) => {
    const v = await who(ctx)
    sendJson(ctx.res, 200, {
      user: { id: v.id, name: v.name, email: v.email, avatarUrl: v.avatarUrl, groups: v.groups },
      isAdmin: v.isAdmin,
    })
  })

  router.get('/api/v1/people', async (ctx) => {
    await who(ctx)
    const rows = await searchPeople(
      db,
      ctx.url.searchParams.get('q') ?? '',
      Number(ctx.url.searchParams.get('limit')) || 20,
    )
    sendJson(ctx.res, 200, {
      people: rows.map((r) => ({ id: r.id, name: r.name, email: r.email, avatarUrl: r.avatar_url })),
    })
  })

  router.get('/api/v1/boards', async (ctx) => {
    const viewer = await who(ctx)
    const p = ctx.url.searchParams
    const edited = Number(p.get('edited'))
    const query: ListQuery = {
      view: pick(VIEWS, p.get('view')) ?? 'all',
      sort: pick(SORTS, p.get('sort')) ?? 'opened',
      access: pick(ACCESS, p.get('access')),
      q: text(p.get('q'), 100) ?? undefined,
      owner: text(p.get('owner'), 200) ?? undefined,
      group: text(p.get('group'), 100) ?? undefined,
      editedDays: Number.isInteger(edited) && edited > 0 && edited <= 3650 ? edited : undefined,
      limit: Number(p.get('limit')) || undefined,
      offset: Number(p.get('offset')) || undefined,
    }
    sendJson(ctx.res, 200, await boards.list(viewer, query))
  })

  router.get('/api/v1/boards/counts', async (ctx) => {
    sendJson(ctx.res, 200, await boards.counts(await who(ctx)))
  })

  router.post('/api/v1/boards', async (ctx) => {
    const viewer = await who(ctx, { write: true })
    const data = await body(ctx, MAX_BOARD_FILE)
    sendJson(ctx.res, 201, await boards.create(viewer, data))
  })

  router.get('/api/v1/boards/:id', async (ctx) => {
    sendJson(ctx.res, 200, await boards.detail(await who(ctx), ctx.params.id))
  })

  router.patch('/api/v1/boards/:id', async (ctx) => {
    const viewer = await who(ctx, { write: true })
    const data = await body(ctx)
    sendJson(ctx.res, 200, await boards.update(viewer, ctx.params.id, data))
  })

  router.delete('/api/v1/boards/:id', async (ctx) => {
    const viewer = await who(ctx, { write: true })
    if (ctx.url.searchParams.get('permanent') === 'true') await boards.destroy(viewer, ctx.params.id)
    else await boards.trash(viewer, ctx.params.id)
    sendJson(ctx.res, 200, { ok: true })
  })

  router.post('/api/v1/boards/:id/restore', async (ctx) => {
    const viewer = await who(ctx, { write: true })
    sendJson(ctx.res, 200, await boards.restore(viewer, ctx.params.id))
  })

  router.put('/api/v1/boards/:id/star', async (ctx) => {
    await boards.star(await who(ctx, { write: true }), ctx.params.id, true)
    sendJson(ctx.res, 200, { ok: true })
  })

  router.delete('/api/v1/boards/:id/star', async (ctx) => {
    await boards.star(await who(ctx, { write: true }), ctx.params.id, false)
    sendJson(ctx.res, 200, { ok: true })
  })

  router.get('/api/v1/boards/:id/members', async (ctx) => {
    sendJson(ctx.res, 200, await boards.members(await who(ctx), ctx.params.id))
  })

  router.put('/api/v1/boards/:id/members/:userId', async (ctx) => {
    const viewer = await who(ctx, { write: true })
    const data = await body(ctx)
    await boards.setMember(viewer, ctx.params.id, ctx.params.userId, data.role)
    sendJson(ctx.res, 200, await boards.members(viewer, ctx.params.id))
  })

  router.delete('/api/v1/boards/:id/members/:userId', async (ctx) => {
    const viewer = await who(ctx, { write: true })
    await boards.removeMember(viewer, ctx.params.id, ctx.params.userId)
    sendJson(ctx.res, 200, { ok: true })
  })

  router.get('/api/v1/boards/:id/export', async (ctx) => {
    const data = await boards.exportJson(await who(ctx), ctx.params.id)
    sendJson(ctx.res, 200, data, { 'content-disposition': 'attachment; filename="meshboard-board.json"' })
  })

  router.post('/api/v1/boards/:id/import', async (ctx) => {
    const viewer = await who(ctx, { write: true })
    const data = await readJson(ctx.req, MAX_BOARD_FILE)
    sendJson(ctx.res, 200, { added: await boards.importJson(viewer, ctx.params.id, data) })
  })

  router.get('/api/v1/boards/:id/preview.svg', async (ctx) => {
    const svg = await boards.preview(await who(ctx), ctx.params.id)
    if (!svg) throw new HttpError(404, 'no-preview', 'This board is empty')
    ctx.res.writeHead(200, {
      'content-type': 'image/svg+xml',
      // a picture that can't run anything, even if opened on its own
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'cache-control': 'private, max-age=31536000, immutable',
    })
    ctx.res.end(svg)
  })

  return router
}
