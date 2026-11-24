// The server's pure parts: settings, roles, signatures, cookies, redirects, client addresses,
// rate limits, previews and outgoing webhooks.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ConfigError, isTrusted, parseConfig } from '../src/config.ts'
import { canEdit, canManage, canView, isAdmin, roleFor } from '../src/access.ts'
import type { Viewer } from '../src/access.ts'
import { parseCookies, seal, serializeCookie, signatureHeaders, text, unseal, verifySignature } from '../src/util.ts'
import { checkSameOrigin, clientIp, createLimiter, HttpError, rateKey, Router, safeReturnTo } from '../src/http.ts'
import { cleanIdentity } from '../src/users.ts'
import { describe as describeState, renderPreview, storeFrom } from '../src/preview.ts'
import { createWebhooks } from '../src/webhooks.ts'
import * as Y from 'yjs'
import type { IncomingMessage } from 'node:http'

const BASE = { MESHBOARD_URL: 'https://board.example.com' }
const problems = (env: Record<string, string>): readonly string[] => {
  try {
    parseConfig(env)
    return []
  } catch (err) {
    assert.ok(err instanceof ConfigError)
    return err.problems
  }
}

test('settings: defaults, and every problem named at once', () => {
  const c = parseConfig(BASE)
  assert.equal(c.basePath, '/')
  assert.equal(c.secure, true)
  assert.equal(c.auth.kind, 'none')
  assert.equal(c.defaultAccess, 'edit')
  assert.equal(c.databaseUrl, null)
  assert.equal(parseConfig({ MESHBOARD_URL: 'https://x.example/meshboard' }).basePath, '/meshboard/')

  assert.deepEqual(problems({}), ['MESHBOARD_URL is required'])
  assert.match(problems({ MESHBOARD_URL: 'http://board.example.com' })[0], /must be https/)
  assert.deepEqual(problems({ MESHBOARD_URL: 'http://board.example.com', ALLOW_HTTP: 'true' }), [])
  assert.deepEqual(problems({ MESHBOARD_URL: 'http://localhost:8080' }), [])
  const many = problems({ ...BASE, AUTH: 'oidc', PORT: 'x', DEFAULT_ACCESS: 'all', DATABASE_URL: 'mysql://x' })
  assert.ok(many.some((p) => p.startsWith('OIDC_ISSUER')))
  assert.ok(many.some((p) => p.startsWith('OIDC_CLIENT_ID')))
  assert.ok(many.some((p) => p.startsWith('OIDC_CLIENT_SECRET')))
  assert.ok(many.some((p) => p.startsWith('PORT')))
  assert.ok(many.some((p) => p.startsWith('DEFAULT_ACCESS')))
  assert.ok(many.some((p) => p.startsWith('DATABASE_URL')))
  assert.match(problems({ ...BASE, AUTH: 'magic' })[0], /AUTH must be/)
  assert.match(
    problems({
      ...BASE,
      AUTH: 'oidc',
      OIDC_ISSUER: 'http://idp.example',
      OIDC_CLIENT_ID: 'a',
      OIDC_CLIENT_SECRET: 'b',
    })[0],
    /OIDC_ISSUER must be https/,
  )
  assert.match(problems({ ...BASE, AUTH: 'proxy' })[0], /TRUSTED_PROXIES is required/)
  assert.match(
    problems({ ...BASE, AUTH: 'webhook', AUTH_WEBHOOK_URL: 'https://a.example', AUTH_WEBHOOK_SECRET: 'short' })[0],
    /16/,
  )
  assert.match(problems({ ...BASE, WEBHOOK_URL: 'https://hooks.example' })[0], /WEBHOOK_SECRET/)
  assert.match(problems({ ...BASE, SESSION_SECRET: 'too short' })[0], /32/)
  assert.match(
    problems({ ...BASE, PROXY_USER_HEADER: 'x', AUTH: 'proxy', TRUSTED_PROXIES: '10.0.0.0/33' })[0],
    /prefix/,
  )
  assert.match(
    problems({ ...BASE, AUTH: 'proxy', TRUSTED_PROXIES: 'nope', PROXY_USER_HEADER: 'X User' }).join(),
    /invalid address/,
  )
  assert.match(problems({ ...BASE, ALLOWED_GROUP: 'staff' })[0], /ALLOWED_GROUP needs/)
  assert.match(problems({ ...BASE, OIDC_ALLOWED_DOMAINS: 'acme.example' })[0], /needs AUTH=oidc/)
  const proxy = parseConfig({ ...BASE, AUTH: 'proxy', TRUSTED_PROXIES: '10.0.0.1' }).auth
  assert.equal(proxy.kind === 'proxy' && proxy.emailHeader, null, 'the email header is opt-in')
  const access = parseConfig({ ...BASE, DEFAULT_ACCESS: 'members', ADMIN_EMAILS: ' A@x.example , b@y.example' })
  assert.equal(access.defaultAccess, 'none')
  assert.deepEqual([...access.adminEmails], ['a@x.example', 'b@y.example'])
})

test('trusted proxies: CIDRs and IPv4 addresses seen as IPv6', () => {
  const list = parseConfig({ ...BASE, AUTH: 'proxy', TRUSTED_PROXIES: '10.0.0.0/8, 192.168.1.5, ::1' }).trustedProxies
  assert.ok(isTrusted(list, '10.1.2.3'))
  assert.ok(isTrusted(list, '::ffff:10.1.2.3'))
  assert.ok(isTrusted(list, '192.168.1.5'))
  assert.ok(isTrusted(list, '::1'))
  assert.ok(!isTrusted(list, '192.168.1.6'))
  assert.ok(!isTrusted(list, 'not an ip'))
  assert.ok(!isTrusted(null, '10.1.2.3'))
})

const viewer = (patch: Partial<Viewer> = {}): Viewer => ({
  id: 'u1',
  name: 'Anna',
  email: null,
  avatarUrl: null,
  groups: [],
  isAdmin: false,
  ...patch,
})
const board = (
  patch: Partial<{
    owner_id: string
    access_level: string
    access_group: string | null
    deleted_at: number | null
  }> = {},
) => ({
  owner_id: 'owner',
  access_level: 'none',
  access_group: null,
  deleted_at: null,
  ...patch,
})

test('roles: owner, admin, members, the organisation, groups, the trash and tokens', () => {
  assert.equal(roleFor(viewer({ id: 'owner' }), board(), null), 'owner')
  assert.equal(roleFor(viewer({ isAdmin: true }), board(), null), 'owner')
  assert.equal(roleFor(viewer(), board(), null), null)
  assert.equal(roleFor(viewer(), board(), 'viewer'), 'viewer')
  assert.equal(roleFor(viewer(), board({ access_level: 'view' }), null), 'viewer')
  assert.equal(roleFor(viewer(), board({ access_level: 'edit' }), 'viewer'), 'editor', 'the higher of the two')
  assert.equal(roleFor(viewer(), board({ access_level: 'view' }), 'editor'), 'editor')
  assert.equal(roleFor(viewer(), board({ access_level: 'edit', access_group: 'Design' }), null), null)
  assert.equal(
    roleFor(viewer({ groups: ['Design'] }), board({ access_level: 'edit', access_group: 'Design' }), null),
    'editor',
  )
  assert.equal(roleFor(viewer(), board({ access_level: 'edit', deleted_at: 1 }), 'editor'), null, 'trash: owner only')
  assert.equal(roleFor(viewer({ id: 'owner' }), board({ deleted_at: 1 }), null), 'owner')
  assert.equal(roleFor(viewer(), board(), 'bogus' as never), null)
  const reader = viewer({ id: 'owner', scopes: new Set(['boards:read']) })
  assert.equal(roleFor(reader, board(), null), 'viewer', 'a read-only token narrows even the owner')
  assert.equal(roleFor(viewer({ scopes: new Set() }), board({ access_level: 'edit' }), null), null)
  assert.equal(roleFor(viewer({ scopes: new Set(['boards:write']) }), board({ access_level: 'edit' }), null), 'editor')
  assert.ok(canView('viewer') && !canEdit('viewer') && canEdit('editor') && !canManage('editor') && canManage('owner'))
  assert.ok(isAdmin({ email: 'A@X.example', groups: [] }, new Set(['a@x.example']), null))
  assert.ok(isAdmin({ email: null, groups: ['it'] }, new Set(), 'it'))
  assert.ok(!isAdmin({ email: null, groups: ['it'] }, new Set(), null))
})

test('identities from outside are trimmed, checked and capped', () => {
  assert.equal(cleanIdentity({ id: '' }), null)
  assert.equal(cleanIdentity({ id: 42 }), null)
  const i = cleanIdentity({
    id: ' u_1 ',
    email: 'Anna@Example.COM',
    avatarUrl: 'http://insecure.example/a.png',
    groups: ['Design', 'Design', 7, 'x'.repeat(200)],
  })!
  assert.deepEqual(i, {
    id: 'u_1',
    name: 'Anna',
    email: 'anna@example.com',
    avatarUrl: null,
    groups: ['Design', 'x'.repeat(100)],
  })
  assert.deepEqual(cleanIdentity({ id: 'u', groups: 'a, b,,c' })!.groups, ['a', 'b', 'c'])
  assert.equal(cleanIdentity({ id: 'u', email: 'not an email' })!.email, null)
  assert.equal(cleanIdentity({ id: 'u', name: 'line\nbreak' })!.name, 'line break')
  assert.equal(text('\u0000\u0007', 10), null)
})

test("sealed cookies and signed requests can't be forged or replayed", () => {
  const sealed = seal('secret', { a: 1 })
  assert.deepEqual(unseal('secret', sealed), { a: 1 })
  assert.equal(unseal('other', sealed), null)
  assert.equal(unseal('secret', sealed.replace(/^./, 'x')), null)
  assert.equal(unseal('secret', 'nodot'), null)
  assert.equal(unseal('secret', undefined), null)
  const now = 1_800_000_000_000
  const h = signatureHeaders('k'.repeat(16), '{"x":1}', now)
  const sig = { timestamp: h['x-meshboard-timestamp'], signature: h['x-meshboard-signature'] }
  assert.ok(verifySignature('k'.repeat(16), '{"x":1}', sig, { now }))
  assert.ok(!verifySignature('k'.repeat(16), '{"x":2}', sig, { now }))
  assert.ok(!verifySignature('k'.repeat(16), '{"x":1}', sig, { now: now + 10 * 60_000 }), 'too old')
  assert.ok(!verifySignature('k'.repeat(16), '{"x":1}', { timestamp: 'x', signature: 'y' }, { now }))
})

test('cookies: parsing and the flags set', () => {
  const jar = parseCookies('a=1; b="two"; a=3; bad; =x; c=%E0%A4%A')
  assert.deepEqual(
    [...jar],
    [
      ['a', '1'],
      ['b', 'two'],
    ],
  )
  assert.equal(parseCookies(undefined).size, 0)
  assert.equal(
    serializeCookie('s', 'v v', { secure: true, maxAgeS: 60 }),
    's=v%20v; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=60',
  )
})

test('after signing in, only a path on this site', () => {
  assert.equal(safeReturnTo('/b/abc?x=1', '/'), '/b/abc?x=1')
  for (const bad of [
    '//evil.example/',
    'https://evil.example/',
    '/\\evil.example',
    '/..//evil.example/phish',
    '/%2e%2e//evil.example',
    '/./..//evil.example',
    'b/abc',
    '/ x',
    42,
    null,
    '/x'.repeat(300),
  ])
    assert.equal(safeReturnTo(bad, '/'), '/', String(bad))
  assert.equal(safeReturnTo('/other/app', '/meshboard/'), '/meshboard/')
  assert.equal(safeReturnTo('/meshboard/../other', '/meshboard/'), '/meshboard/')
  assert.equal(rateKey('2001:db8:1:2:3:4:5:6'), '2001:db8:1:2::/64')
  assert.equal(rateKey('2001:db8::1'), '2001:db8:0:0::/64')
  assert.equal(rateKey('::ffff:10.0.0.1'), '::ffff:10.0.0.1')
  assert.equal(rateKey('10.0.0.1'), '10.0.0.1')
})

const req = (headers: Record<string, string>, remote = '127.0.0.1') =>
  ({ headers, socket: { remoteAddress: remote } }) as unknown as IncomingMessage

test('client address and cross-site checks', () => {
  const trusted = parseConfig({ ...BASE, AUTH: 'proxy', TRUSTED_PROXIES: '10.0.0.0/8' })
  assert.equal(clientIp(req({ 'x-forwarded-for': '1.2.3.4' }, '9.9.9.9'), trusted), '9.9.9.9', 'untrusted: the socket')
  assert.equal(clientIp(req({ 'x-forwarded-for': '6.6.6.6, 1.2.3.4, 10.0.0.2' }, '10.0.0.1'), trusted), '1.2.3.4')
  const config = parseConfig(BASE)
  assert.doesNotThrow(() => checkSameOrigin(req({ origin: 'https://board.example.com' }), config))
  assert.doesNotThrow(() => checkSameOrigin(req({ 'sec-fetch-site': 'same-origin' }), config))
  assert.doesNotThrow(() => checkSameOrigin(req({}), config), 'a script without a browser')
  assert.throws(() => checkSameOrigin(req({ origin: 'https://evil.example' }), config), HttpError)
  assert.throws(() => checkSameOrigin(req({ 'sec-fetch-site': 'same-site' }), config), HttpError)
})

test('rate limits and the router', () => {
  const allow = createLimiter(2, 1000)
  assert.deepEqual(
    [allow('a', 0), allow('a', 1), allow('a', 2), allow('b', 2), allow('a', 1001)],
    [true, true, false, true, true],
  )
  const router = new Router().get('/x/:id', () => {})
  assert.deepEqual(router.match('GET', '/x/a%20b')?.params, { id: 'a b' })
  assert.equal(router.match('GET', '/y'), null)
  assert.throws(
    () => router.match('POST', '/x/1'),
    (e: HttpError) => e.status === 405,
  )
  assert.throws(
    () => router.match('GET', '/x/%E0%A4%A'),
    (e: HttpError) => e.status === 400,
  )
})

test('previews draw shapes from clean numbers, never text', () => {
  assert.equal(renderPreview([]), null)
  const store = storeFrom(null)
  store.setTitle('Roadmap')
  for (const type of ['note', 'rect', 'ellipse', 'triangle', 'diamond', 'text', 'frame'] as const)
    store.create({ type, x: 10, y: 10, text: '</svg><script>' })
  store.create({ type: 'path', x: 0, y: 0, w: 10, h: 10, points: [0, 0, 5, 5, 10, 0], ow: 10, oh: 10 })
  const a = store.create({ type: 'note', x: 0, y: 0 })
  const b = store.create({ type: 'note', x: 400, y: 0 })
  store.create({ type: 'arrow', from: a, to: b })
  const { title, preview } = describeState(Y.encodeStateAsUpdate(store.doc))
  assert.equal(title, 'Roadmap')
  assert.ok(preview?.startsWith('<svg'))
  assert.ok(!preview!.includes('script'))
  for (const tag of ['<rect', '<ellipse', '<polygon', '<polyline', '<line']) assert.ok(preview!.includes(tag), tag)
})

test('outgoing webhooks: signed, retried on errors, given up on refusals, throttled updates', async () => {
  const calls: Array<{ body: string; headers: Headers }> = []
  const answers = [500, 200, 400]
  const fake = (async (_url: URL, init: RequestInit) => {
    calls.push({ body: String(init.body), headers: new Headers(init.headers) })
    return new Response(null, { status: answers.shift() ?? 200 })
  }) as unknown as typeof fetch
  const logs: string[] = []
  const hooks = createWebhooks(
    { url: new URL('https://hooks.example/in'), secret: 's'.repeat(16) },
    (_l, m) => logs.push(m),
    {
      fetch: fake,
      retriesMs: [0, 1, 1],
    },
  )
  const data = { board: { id: 'b', title: 'T', url: 'https://x/b/b' }, actor: null }
  hooks.emit('board.created', data)
  await hooks.drain()
  assert.equal(calls.length, 2, 'retried after the 500')
  const body = JSON.parse(calls[1].body)
  assert.equal(body.type, 'board.created')
  assert.match(body.id, /^evt_/)
  assert.ok(
    verifySignature('s'.repeat(16), calls[1].body, {
      timestamp: calls[1].headers.get('x-meshboard-timestamp'),
      signature: calls[1].headers.get('x-meshboard-signature'),
    }),
  )
  hooks.emit('member.added', data)
  await hooks.drain()
  assert.equal(calls.length, 3, 'a 400 is not retried')
  assert.deepEqual(logs, ['Webhook refused'])
  hooks.emit('board.updated', data)
  hooks.emit('board.updated', data)
  await hooks.drain()
  assert.equal(calls.length, 4, 'one update a minute per board')
  const off = createWebhooks(null, () => {}, { fetch: fake })
  off.emit('board.created', data)
  await off.drain()
  assert.equal(calls.length, 4)
})
