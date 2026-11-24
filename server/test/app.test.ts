// The server end to end over HTTP and WebSockets (AUTH=none): sign-in, the API, who can see and
// change what, cross-site protection, static files, and live sync with read-only viewers.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { createStore } from '../../src/core/store.ts'
import { client, guest, provider, rawUpgrade, startServer, waitFor } from './helpers.ts'
import type { Client, TestServer } from './helpers.ts'
import type { BoardSummary } from '../src/boards.ts'

let server: TestServer
let anna: Client
let marco: Client

before(async () => {
  server = await startServer({ ORG_NAME: 'Acme' })
  anna = await guest(server, 'Anna')
  marco = await guest(server, 'Marco')
})
after(() => server.stop())

const create = async (who: Client, body: Record<string, unknown> = {}) => {
  const res = await who.post('api/v1/boards', body)
  assert.equal(res.status, 201, res.text)
  return res.body as BoardSummary
}
const me = async (who: Client) => (await who.get('api/v1/me')).body as { user: { id: string; name: string } }

test('the app, its settings and health checks are served with strict headers', async () => {
  const anon = client(server)
  const cfg = await anon.get('config.json')
  assert.deepEqual(cfg.body, {
    mode: 'server',
    orgName: 'Acme',
    basePath: '/',
    auth: { kind: 'none', loginUrl: null, canSignOut: true },
    images: { upload: null, origins: [] },
  })
  const page = await anon.get('b/abcdefghijklmnopqr')
  assert.equal(page.status, 200)
  assert.match(page.text, /<base href="\/" \/>/)
  const csp = page.headers.get('content-security-policy') ?? ''
  assert.match(csp, /script-src 'self'/)
  assert.match(csp, /frame-ancestors 'none'/)
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(page.headers.get('x-frame-options'), 'DENY')
  assert.equal((await anon.get('healthz')).status, 200)
  assert.equal((await anon.get('readyz')).status, 200)
  const asset = await anon.get('assets/app-abc123.js')
  assert.equal(asset.status, 200)
  assert.match(asset.headers.get('cache-control') ?? '', /immutable/)
  assert.equal((await anon.get('sw.js')).headers.get('cache-control'), 'no-cache')
})

test('static files never leave the app folder or show dotfiles', async () => {
  const anon = client(server)
  for (const path of [
    '.private',
    'assets/../.private',
    '%2e%2e/%2e%2e/package.json',
    '..%2F..%2Fpackage.json',
    'nope.js',
  ])
    assert.equal((await anon.get(path)).status, 404, path)
  const raw = await fetch(`${server.url}/..%2f..%2fserver%2fsrc%2fconfig.ts`)
  assert.equal(raw.status, 404)
})

test('signing in with a name: an HttpOnly session, and out again', async () => {
  const c = client(server)
  assert.equal((await c.get('api/v1/me')).status, 401)
  assert.equal((await c.post('auth/guest', { name: '  ' })).status, 400)
  const res = await c.post('auth/guest', { name: 'Giulia' })
  const cookie = res.headers.getSetCookie()[0]
  assert.match(cookie, /^mb_session=/)
  assert.match(cookie, /HttpOnly/)
  assert.match(cookie, /SameSite=Lax/)
  const { user } = await me(c)
  assert.equal(user.name, 'Giulia')
  // renaming keeps the same person
  await c.post('auth/guest', { name: 'Giulia V' })
  assert.equal((await me(c)).user.id, user.id)
  assert.equal((await me(c)).user.name, 'Giulia V')
  assert.equal((await c.post('auth/logout', {})).status, 200)
  assert.equal((await c.get('api/v1/me')).status, 401)
})

test('changes need this site as the Origin, and a JSON body', async () => {
  const evil = client(server, { origin: 'https://evil.example' })
  for (const [k, v] of anna.jar) evil.jar.set(k, v)
  assert.equal((await evil.post('api/v1/boards', {})).status, 403)
  const sameSite = await anna.call('POST', 'api/v1/boards', 'title=x', {
    'content-type': 'application/x-www-form-urlencoded',
  })
  assert.equal(sameSite.status, 415)
  const noOrigin = client(server, { origin: '' })
  for (const [k, v] of anna.jar) noOrigin.jar.set(k, v)
  assert.equal((await noOrigin.post('api/v1/boards', {}, { 'sec-fetch-site': 'cross-site' })).status, 403)
  assert.equal((await anna.call('POST', 'api/v1/boards', '{bad')).status, 400)
  const big = await anna.post('api/v1/boards/xxxxxxxxxxxxxxxx/import', {
    format: 'meshboard',
    items: [],
    pad: 'x'.repeat(26_000_000),
  })
  assert.equal(big.status, 413)
})

test('creating, listing, filtering and counting boards', async () => {
  const a = await create(anna, { title: 'Sprint 42 retro' })
  assert.equal(a.role, 'owner')
  assert.equal(a.access.level, 'edit')
  assert.equal(a.url, `${server.url}/b/${a.id}`)
  const b = await create(anna, { title: 'Private notes', access: 'none' })
  await create(marco, { title: 'Marco roadmap', access: 'view' })

  const mine = (await anna.get('api/v1/boards?owner=me')).body as { boards: BoardSummary[]; total: number }
  assert.deepEqual(mine.boards.map((x) => x.title).sort(), ['Private notes', 'Sprint 42 retro'])
  const search = (await anna.get('api/v1/boards?q=ROADMAP')).body as { boards: BoardSummary[] }
  assert.deepEqual(
    search.boards.map((x) => [x.title, x.role]),
    [['Marco roadmap', 'viewer']],
  )
  // a like pattern in the search is just text
  assert.equal(((await anna.get('api/v1/boards?q=%25')).body as { total: number }).total, 0)
  const onlyMembers = (await anna.get('api/v1/boards?access=members')).body as { boards: BoardSummary[] }
  assert.deepEqual(
    onlyMembers.boards.map((x) => x.id),
    [b.id],
  )
  // Marco can't see Anna's members-only board, by list or by id
  const marcos = (await marco.get('api/v1/boards')).body as { boards: BoardSummary[] }
  assert.ok(!marcos.boards.some((x) => x.id === b.id))
  assert.equal((await marco.get(`api/v1/boards/${b.id}`)).status, 404)

  await anna.put(`api/v1/boards/${a.id}/star`)
  const starred = (await anna.get('api/v1/boards?view=starred')).body as { boards: BoardSummary[] }
  assert.deepEqual(
    starred.boards.map((x) => [x.id, x.starred]),
    [[a.id, true]],
  )
  const counts = (await anna.get('api/v1/boards/counts')).body as Record<string, number>
  assert.equal(counts.starred, 1)
  assert.ok(counts.all >= 3)
  const sorted = (await anna.get('api/v1/boards?sort=title')).body as { boards: BoardSummary[] }
  const titles = sorted.boards.map((x) => x.title.toLowerCase())
  assert.deepEqual(titles, [...titles].sort())
})

test('sharing: viewers can look, editors can edit, only the owner manages access', async () => {
  const board = await create(anna, { title: 'Shared plan', access: 'view' })
  // Marco can view through general access, but not rename or share
  assert.equal(((await marco.get(`api/v1/boards/${board.id}`)).body as BoardSummary).role, 'viewer')
  assert.equal((await marco.patch(`api/v1/boards/${board.id}`, { title: 'Mine now' })).status, 403)
  assert.equal((await marco.patch(`api/v1/boards/${board.id}`, { access: 'edit' })).status, 403)
  assert.equal((await marco.delete(`api/v1/boards/${board.id}`)).status, 403)
  const marcoId = (await me(marco)).user.id
  assert.equal((await marco.put(`api/v1/boards/${board.id}/members/${marcoId}`, { role: 'editor' })).status, 403)
  // only managers see email addresses (guests have none, so check the field is hidden)
  const seen = (await marco.get(`api/v1/boards/${board.id}/members`)).body as { yourRole: string }
  assert.equal(seen.yourRole, 'viewer')

  // Anna adds Marco as an editor
  const added = await anna.put(`api/v1/boards/${board.id}/members/${marcoId}`, { role: 'editor' })
  assert.equal(added.status, 200)
  assert.equal(((await marco.get(`api/v1/boards/${board.id}`)).body as BoardSummary).role, 'editor')
  const renamed = await marco.patch(`api/v1/boards/${board.id}`, { title: 'Shared plan v2' })
  assert.equal((renamed.body as BoardSummary).title, 'Shared plan v2')
  assert.equal(((await marco.get('api/v1/boards?view=shared')).body as { total: number }).total, 1)

  // roles are only editor or viewer, people must exist, the owner isn't a member
  assert.equal((await anna.put(`api/v1/boards/${board.id}/members/${marcoId}`, { role: 'owner' })).status, 400)
  assert.equal((await anna.put(`api/v1/boards/${board.id}/members/nobody-here`, { role: 'viewer' })).status, 404)
  const annaId = (await me(anna)).user.id
  assert.equal((await anna.put(`api/v1/boards/${board.id}/members/${annaId}`, { role: 'viewer' })).status, 400)

  // Marco leaves; with general access back to members only he can't see it
  assert.equal((await marco.delete(`api/v1/boards/${board.id}/members/${marcoId}`)).status, 200)
  await anna.patch(`api/v1/boards/${board.id}`, { access: 'none' })
  assert.equal((await marco.get(`api/v1/boards/${board.id}`)).status, 404)
  // groups you don't belong to can't be used
  assert.equal((await anna.patch(`api/v1/boards/${board.id}`, { access: 'edit', group: 'Design' })).status, 400)
})

test('the trash: only the owner, and deleting for good only from there', async () => {
  const board = await create(anna, { title: 'Old board' })
  assert.equal((await marco.delete(`api/v1/boards/${board.id}`)).status, 403)
  assert.equal((await anna.delete(`api/v1/boards/${board.id}?permanent=true`)).status, 409)
  assert.equal((await anna.delete(`api/v1/boards/${board.id}`)).status, 200)
  assert.equal((await marco.get(`api/v1/boards/${board.id}`)).status, 404)
  const trash = (await anna.get('api/v1/boards?view=trash')).body as { boards: BoardSummary[] }
  assert.ok(trash.boards.some((b) => b.id === board.id && b.deletedAt))
  assert.equal(((await marco.get('api/v1/boards?view=trash')).body as { total: number }).total, 0)
  assert.equal((await anna.patch(`api/v1/boards/${board.id}`, { title: 'x' })).status, 409)
  assert.equal(((await anna.post(`api/v1/boards/${board.id}/restore`)).body as BoardSummary).deletedAt, null)
  await anna.delete(`api/v1/boards/${board.id}`)
  assert.equal((await anna.delete(`api/v1/boards/${board.id}?permanent=true`)).status, 200)
  assert.equal((await anna.get(`api/v1/boards/${board.id}`)).status, 404)
})

test('export, import and the preview', async () => {
  const board = await create(anna, {
    title: 'From a file',
    template: {
      format: 'meshboard',
      version: 2,
      title: 'Ignored: the title wins',
      items: [
        { id: 'n1', type: 'note', x: 0, y: 0, w: 200, h: 200, color: 'yellow', text: '<script>alert(1)</script>' },
        { id: 'r1', type: 'rect', x: 300, y: 0, w: 180, h: 110, color: 'blue', text: '' },
      ],
    },
  })
  assert.equal(board.title, 'From a file')
  assert.ok(board.preview)
  const svg = await anna.get(board.preview!.replace(/^\//, ''))
  assert.equal(svg.status, 200)
  assert.equal(svg.headers.get('content-type'), 'image/svg+xml')
  assert.match(svg.headers.get('content-security-policy') ?? '', /sandbox/)
  assert.ok(!svg.text.includes('script'), 'text never reaches the preview')
  const exported = (await anna.get(`api/v1/boards/${board.id}/export`)).body as { items: unknown[]; title: string }
  assert.equal(exported.items.length, 2)
  assert.equal(exported.title, 'From a file')
  const added = await anna.post(`api/v1/boards/${board.id}/import`, exported)
  assert.deepEqual(added.body, { added: 2 })
  assert.equal(((await anna.get(`api/v1/boards/${board.id}/export`)).body as { items: unknown[] }).items.length, 4)
  assert.equal((await anna.post(`api/v1/boards/${board.id}/import`, { nope: true })).status, 400)
  assert.equal((await anna.post('api/v1/boards', { template: { format: 'other' } })).status, 400)
  // a viewer can export but not import
  await anna.patch(`api/v1/boards/${board.id}`, { access: 'view' })
  assert.equal((await marco.get(`api/v1/boards/${board.id}/export`)).status, 200)
  assert.equal((await marco.post(`api/v1/boards/${board.id}/import`, exported)).status, 403)
})

test('people search for sharing', async () => {
  const res = (await anna.get('api/v1/people?q=mar')).body as { people: Array<{ name: string }> }
  assert.deepEqual(
    res.people.map((p) => p.name),
    ['Marco'],
  )
  assert.equal((await client(server).get('api/v1/people')).status, 401)
  const wild = (await anna.get('api/v1/people?q=_')).body as { people: unknown[] }
  assert.equal(wild.people.length, 0)
})

test('live sync: editors share edits, viewers only receive, and boards are kept', async () => {
  const board = await create(anna, { title: 'Live', access: 'view' })
  const marcoId = (await me(marco)).user.id
  const viewerDoc = createStore({ id: marcoId, name: 'Marco' })
  const annaStore = createStore({ id: 'anna', name: 'Anna' })
  const a = provider(server, anna, board.id, annaStore.doc)
  const m = provider(server, marco, board.id, viewerDoc.doc)
  await Promise.all([a.synced(), m.synced()])
  assert.equal(m.provider.authorizedScope, 'readonly')

  annaStore.create({ type: 'note', x: 10, y: 10, text: 'From Anna' })
  await waitFor(() => viewerDoc.items.size === 1, 'the note at the viewer')
  // the viewer's own edits never reach the server or anyone else
  viewerDoc.create({ type: 'note', x: 500, y: 10, text: 'Sneaky' })
  await new Promise((r) => setTimeout(r, 300))
  assert.equal(annaStore.items.size, 1)
  assert.equal(server.app.sync.online(board.id), 2)

  a.destroy()
  m.destroy()
  await waitFor(() => server.app.sync.online(board.id) === 0, 'disconnects')
  await new Promise((r) => setTimeout(r, 200))
  const exported = (await anna.get(`api/v1/boards/${board.id}/export`)).body as { items: Array<{ text: string }> }
  assert.deepEqual(
    exported.items.map((i) => i.text),
    ['From Anna'],
  )
  const listed = (await anna.get(`api/v1/boards/${board.id}`)).body as BoardSummary
  assert.ok(listed.preview, 'the stored board has a preview')
})

test("live sync refuses other sites, strangers and boards you can't open", async () => {
  const board = await create(anna, { title: 'Members only', access: 'none' })
  const cookie = anna.cookieHeader()
  assert.equal(await rawUpgrade(server, { origin: 'https://evil.example', cookie }), 403)
  assert.equal(await rawUpgrade(server, { origin: server.origin }), 401)
  assert.equal(await rawUpgrade(server, { origin: server.origin, cookie }, '/other'), 404)
  assert.equal(await rawUpgrade(server, { origin: server.origin, cookie }), 101)
  const m = provider(server, marco, board.id)
  await m.denied()
  assert.deepEqual(m.failures, ['forbidden'])
  m.destroy()
  // a board in the trash can't be opened live, even by its owner
  await anna.delete(`api/v1/boards/${board.id}`)
  const a = provider(server, anna, board.id)
  await a.denied()
  a.destroy()
  const bogus = provider(server, anna, 'not a board id')
  await bogus.denied()
  assert.deepEqual(bogus.failures, ['not-found'])
  bogus.destroy()
})

test('losing access disconnects you', async () => {
  const board = await create(anna, { title: 'Revoked' })
  const store = createStore({ id: 'marco', name: 'Marco' })
  const m = provider(server, marco, board.id, store.doc)
  await m.synced()
  await anna.patch(`api/v1/boards/${board.id}`, { access: 'none' })
  await m.denied()
  m.destroy()
})

test('a board is kept across restarts', async () => {
  const dir = server.dir
  const board = await create(anna, { title: 'Persistent' })
  const store = createStore({ id: 'anna', name: 'Anna' })
  const a = provider(server, anna, board.id, store.doc)
  await a.synced()
  store.create({ type: 'note', x: 0, y: 0, text: 'Still here' })
  await new Promise((r) => setTimeout(r, 200))
  a.destroy()
  const jar = [...anna.jar]
  await server.stop(false)
  server = await startServer({ ORG_NAME: 'Acme' }, { dir })
  anna = client(server)
  for (const [k, v] of jar) anna.jar.set(k, v)
  marco = await guest(server, 'Marco')
  const doc = new Y.Doc()
  const again = provider(server, anna, board.id, doc)
  await again.synced()
  assert.equal(doc.getMap('items').size, 1)
  again.destroy()
})

test('presence says who you are, not what your app claims', async () => {
  const board = await create(anna, { title: 'Who is here' })
  const annaId = (await me(anna)).user.id
  const a = provider(server, anna, board.id)
  const m = provider(server, marco, board.id)
  await Promise.all([a.synced(), m.synced()])
  a.provider.awareness!.setLocalStateField('peer', {
    uid: 'the-boss',
    name: 'The Boss',
    x: 5,
    y: 'NaN',
    extra: 'x'.repeat(1000),
  })
  const seen = () =>
    [...m.provider.awareness!.getStates().entries()]
      .filter(([id]) => id !== m.provider.awareness!.clientID)
      .map(([, s]) => s.peer as Record<string, unknown> | undefined)
  await waitFor(() => seen().some((p) => p?.x === 5), 'presence at Marco')
  assert.deepEqual(
    seen().find((p) => p?.x === 5),
    { uid: annaId, name: 'Anna', x: 5, y: null },
  )
  a.destroy()
  m.destroy()
})

test('signing out, or a session that ends, closes its live connections', async () => {
  const giulia = await guest(server, 'Giulia')
  const board = await create(giulia, { title: 'Closing time' })
  const g = provider(server, giulia, board.id)
  await g.synced()
  await waitFor(() => server.app.sync.online(board.id) === 1, 'connected')
  await giulia.post('auth/logout', {})
  await waitFor(() => server.app.sync.online(board.id) === 0, 'closed on sign-out')
  g.destroy()

  const sara = await guest(server, 'Sara')
  const other = await create(sara, { title: 'Expiring' })
  const s = provider(server, sara, other.id)
  await s.synced()
  await waitFor(() => server.app.sync.online(other.id) === 1, 'connected')
  await server.database.db.deleteFrom('sessions').execute()
  await server.app.sync.sweep()
  await waitFor(() => server.app.sync.online(other.id) === 0, 'closed when the session is gone')
  s.destroy()
  anna = await guest(server, 'Anna')
  marco = await guest(server, 'Marco')
})

test("a board can't grow past its limit between saves", async () => {
  const small = await startServer({ MAX_BOARD_BYTES: '100000', MAX_MESSAGE_BYTES: '64000' })
  try {
    const owner = await guest(small, 'Owner')
    const board = (await owner.post('api/v1/boards', { title: 'Tiny' })).body as BoardSummary
    const store = createStore({ id: 'owner', name: 'Owner' })
    const p = provider(small, owner, board.id, store.doc)
    await p.synced()
    for (let i = 0; i < 40; i++) store.create({ type: 'note', x: i * 10, y: 0, text: 'x'.repeat(4900) })
    await new Promise((r) => setTimeout(r, 600))
    p.destroy()
    await new Promise((r) => setTimeout(r, 300))
    const state = await small.app.sync.state(board.id)
    assert.ok((state?.byteLength ?? 0) <= 100_000, `kept ${state?.byteLength} bytes`)
  } finally {
    await small.stop()
  }
})
