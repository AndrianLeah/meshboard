// Signing in: OpenID Connect against a small provider made here (signed ID tokens, PKCE), an SSO
// gateway's headers (trusted only from the gateway), an in-house webhook, and API tokens.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { client, freePort, guest, rawUpgrade, startServer } from './helpers.ts'
import { randomToken, sha256, verifySignature } from '../src/util.ts'
import type { BoardSummary } from '../src/boards.ts'

const b64url = (v: Buffer | string) => Buffer.from(v).toString('base64url')

/** A minimal OpenID provider: discovery, keys, and a token endpoint that checks PKCE. */
async function fakeIssuer() {
  const port = await freePort()
  const issuer = `http://127.0.0.1:${port}`
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }
  const codes = new Map<string, { challenge: string; claims: Record<string, unknown> }>()
  const idToken = (claims: Record<string, unknown>) => {
    const now = Math.floor(Date.now() / 1000)
    const head = b64url(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }))
    const body = b64url(JSON.stringify({ iss: issuer, aud: 'meshboard', iat: now, exp: now + 300, ...claims }))
    return `${head}.${body}.${b64url(sign('sha256', Buffer.from(`${head}.${body}`), privateKey))}`
  }
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url!, issuer)
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (url.pathname === '/.well-known/openid-configuration')
      return json(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
      })
    if (url.pathname === '/jwks') return json(200, { keys: [jwk] })
    if (url.pathname === '/token' && req.method === 'POST') {
      let raw = ''
      for await (const chunk of req) raw += chunk
      const form = new URLSearchParams(raw)
      // client_secret_basic: both parts form-encoded, then base64 (RFC 6749 § 2.3.1)
      const basic = Buffer.from(String(req.headers.authorization).replace('Basic ', ''), 'base64')
        .toString()
        .split(':')
        .map(decodeURIComponent)
        .join(':')
      const grant = codes.get(form.get('code') ?? '')
      if (basic !== 'meshboard:client-secret' || !grant) return json(400, { error: 'invalid_grant' })
      const verifier = form.get('code_verifier') ?? ''
      if (b64url(createHash('sha256').update(verifier).digest()) !== grant.challenge)
        return json(400, { error: 'invalid_grant', error_description: 'PKCE' })
      codes.delete(form.get('code')!)
      return json(200, { access_token: 'at', token_type: 'Bearer', expires_in: 300, id_token: idToken(grant.claims) })
    }
    json(404, {})
  })
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r))
  return {
    issuer,
    /** what the provider does when the person signs in: a code for these claims */
    grant(authorizeUrl: string, claims: Record<string, unknown>) {
      const u = new URL(authorizeUrl)
      const code = randomToken(12)
      codes.set(code, {
        challenge: u.searchParams.get('code_challenge')!,
        claims: { nonce: u.searchParams.get('nonce'), ...claims },
      })
      return { code, state: u.searchParams.get('state')!, params: u.searchParams }
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  }
}

test('OpenID Connect: code flow with PKCE, groups, admins, unverified emails and replays', async () => {
  const idp = await fakeIssuer()
  const server = await startServer({
    AUTH: 'oidc',
    OIDC_ISSUER: idp.issuer,
    OIDC_CLIENT_ID: 'meshboard',
    OIDC_CLIENT_SECRET: 'client-secret',
    OIDC_GROUPS_CLAIM: 'groups',
    ADMIN_GROUP: 'it',
  })
  try {
    const cfg = (await client(server).get('config.json')).body as { auth: { loginUrl: string; kind: string } }
    assert.deepEqual(cfg.auth, { kind: 'oidc', loginUrl: '/auth/login', canSignOut: true })

    const anna = client(server)
    const login = await anna.get('auth/login?returnTo=%2Fb%2Fabcdefghijklmnop')
    assert.equal(login.status, 302)
    const to = login.headers.get('location')!
    assert.ok(to.startsWith(`${idp.issuer}/authorize?`))
    const { code, params } = idp.grant(to, {
      sub: 'okta|anna',
      name: 'Anna Rossi',
      email: 'Anna@acme.example',
      email_verified: true,
      groups: ['Design', 'it'],
    })
    assert.equal(params.get('code_challenge_method'), 'S256')
    assert.equal(params.get('redirect_uri'), `${server.url}/auth/callback`)
    assert.equal(params.get('scope'), 'openid profile email')

    // the wrong state is refused, and the page says so
    const wrong = await anna.get(`auth/callback?code=${code}&state=nope`)
    assert.equal(wrong.status, 401)
    assert.match(wrong.headers.get('content-type')!, /text\/html/)

    // a fresh sign-in (the failed one used up the pending cookie's check, not the code)
    const again = await anna.get('auth/login?returnTo=%2F%2Fevil.example')
    const second = idp.grant(again.headers.get('location')!, {
      sub: 'okta|anna',
      name: 'Anna Rossi',
      email: 'Anna@acme.example',
      email_verified: true,
      groups: ['Design', 'it'],
    })
    const done = await anna.get(`auth/callback?code=${second.code}&state=${second.state}`)
    assert.equal(done.status, 302)
    assert.equal(done.headers.get('location'), '/', 'an outside returnTo is dropped')
    const me = (await anna.get('api/v1/me')).body as { user: Record<string, unknown>; isAdmin: boolean }
    assert.deepEqual(me.user, {
      id: 'okta|anna',
      name: 'Anna Rossi',
      email: 'anna@acme.example',
      avatarUrl: null,
      groups: ['Design', 'it'],
    })
    assert.equal(me.isAdmin, true)
    // a code is good once
    assert.equal((await client(server).get(`auth/callback?code=${second.code}&state=${second.state}`)).status, 400)

    // an email the provider hasn't verified isn't taken
    const sara = client(server)
    const l = idp.grant((await sara.get('auth/login')).headers.get('location')!, {
      sub: 'sara',
      email: 'boss@acme.example',
      email_verified: false,
    })
    await sara.get(`auth/callback?code=${l.code}&state=${l.state}`)
    const saraMe = (await sara.get('api/v1/me')).body as { user: { email: string | null; name: string } }
    assert.equal(saraMe.user.email, null)
    assert.equal(saraMe.user.name, 'sara', 'nor used as a name: it falls back to the id')

    const luca = client(server)
    const bad = idp.grant((await luca.get('auth/login')).headers.get('location')!, { sub: 'luca' })
    // a forged pending-sign-in cookie is refused before the provider is asked
    const res = await fetch(`${server.url}/auth/callback?code=${bad.code}&state=${bad.state}`, {
      headers: { cookie: 'mb_oidc=forged.value' },
      redirect: 'manual',
    })
    assert.equal(res.status, 400)
    assert.equal((await anna.post('auth/logout', {})).status, 200)
    assert.equal((await anna.get('api/v1/me')).status, 401)
  } finally {
    await server.stop()
    await idp.close()
  }
})

test('OpenID Connect: an allowlist of domains and a required group', async () => {
  const idp = await fakeIssuer()
  const server = await startServer({
    AUTH: 'oidc',
    OIDC_ISSUER: idp.issuer,
    OIDC_CLIENT_ID: 'meshboard',
    OIDC_CLIENT_SECRET: 'client-secret',
    OIDC_GROUPS_CLAIM: 'groups',
    OIDC_ALLOWED_DOMAINS: '@Acme.example',
    ALLOWED_GROUP: 'staff',
  })
  const attempt = async (claims: Record<string, unknown>) => {
    const c = client(server)
    const g = idp.grant((await c.get('auth/login')).headers.get('location')!, claims)
    return (await c.get(`auth/callback?code=${g.code}&state=${g.state}`)).status
  }
  try {
    assert.equal(await attempt({ sub: 'a', email: 'a@gmail.example', email_verified: true, groups: ['staff'] }), 403)
    assert.equal(await attempt({ sub: 'b', email: 'b@acme.example', groups: ['staff'] }), 403, 'not verified')
    assert.equal(await attempt({ sub: 'c', email: 'c@acme.example', email_verified: true, groups: [] }), 403)
    assert.equal(await attempt({ sub: 'd', email: 'd@acme.example', email_verified: true, groups: ['staff'] }), 302)
  } finally {
    await server.stop()
    await idp.close()
  }
})

test('OpenID Connect: an unreachable provider is a clear error', async () => {
  const port = await freePort()
  const server = await startServer({
    AUTH: 'oidc',
    OIDC_ISSUER: `http://127.0.0.1:${port}`,
    OIDC_CLIENT_ID: 'meshboard',
    OIDC_CLIENT_SECRET: 'client-secret',
  })
  try {
    const res = await client(server).get('auth/login')
    assert.equal(res.status, 503)
    assert.match(res.text, /reach the sign-in service/)
  } finally {
    await server.stop()
  }
})

test('SSO gateway: headers count only from the gateway', async () => {
  const trusted = await startServer({
    AUTH: 'proxy',
    TRUSTED_PROXIES: '127.0.0.1',
    PROXY_EMAIL_HEADER: 'X-Forwarded-Email',
    PROXY_GROUPS_HEADER: 'X-Forwarded-Groups',
    ADMIN_EMAILS: 'boss@acme.example',
  })
  const spoofed = await startServer({ AUTH: 'proxy', TRUSTED_PROXIES: '10.0.0.0/8' })
  // the gateway sets only the user header: an email from the browser must not count
  const noEmail = await startServer({ AUTH: 'proxy', TRUSTED_PROXIES: '127.0.0.1', ADMIN_EMAILS: 'boss@acme.example' })
  try {
    const headers = {
      'x-forwarded-user': 'anna',
      'x-forwarded-email': 'anna@acme.example',
      'x-forwarded-groups': 'Design, Product',
      // a gateway's own bearer token isn't Meshboard's business
      authorization: 'Bearer gateway-jwt',
    }
    const me = await client(trusted).get('api/v1/me', headers)
    assert.equal(me.status, 200)
    assert.deepEqual((me.body as { user: { groups: string[] } }).user.groups, ['Design', 'Product'])
    assert.equal((await client(trusted).get('api/v1/me')).status, 401)
    assert.equal((await client(spoofed).get('api/v1/me', headers)).status, 401, 'not from the gateway: ignored')
    assert.equal(await rawUpgrade(trusted, { origin: trusted.origin, ...headers }), 101)
    assert.equal(await rawUpgrade(spoofed, { origin: spoofed.origin, ...headers }), 401)
    const cfg = (await client(trusted).get('config.json')).body as { auth: unknown }
    assert.deepEqual(cfg.auth, { kind: 'proxy', loginUrl: null, canSignOut: false })

    const mallory = await client(noEmail).get('api/v1/me', {
      'x-forwarded-user': 'mallory',
      'x-forwarded-email': 'boss@acme.example',
    })
    const m = mallory.body as { user: { email: string | null }; isAdmin: boolean }
    assert.equal(m.user.email, null)
    assert.equal(m.isAdmin, false)

    // email addresses aren't listed to anyone who searches by name
    await client(trusted).get('api/v1/me', { 'x-forwarded-user': 'boss', 'x-forwarded-email': 'boss@acme.example' })
    const search = (q: string) =>
      client(trusted)
        .get(`api/v1/people?q=${encodeURIComponent(q)}`, headers)
        .then((r) => r.body as { people: Array<{ email: string | null }> })
    assert.deepEqual(
      (await search('bos')).people.map((p) => p.email),
      [null],
    )
    assert.deepEqual(
      (await search('Boss@acme.example')).people.map((p) => p.email),
      ['boss@acme.example'],
    )
  } finally {
    await trusted.stop()
    await spoofed.stop()
    await noEmail.stop()
  }
})

test('sign-in webhook: your service says who it is, gets only your cookies, and signs links', async () => {
  const seen: Array<{ body: Record<string, unknown>; ok: boolean }> = []
  let down = false
  const fake = (async (_url: URL, init: RequestInit) => {
    if (down) throw new Error('ECONNREFUSED')
    const body = String(init.body)
    const h = new Headers(init.headers)
    const ok = verifySignature('w'.repeat(20), body, {
      timestamp: h.get('x-meshboard-timestamp'),
      signature: h.get('x-meshboard-signature'),
    })
    const data = JSON.parse(body) as { headers?: { cookie: string }; token?: string }
    seen.push({ body: data, ok })
    if (!ok) return new Response(null, { status: 401 })
    if (data.headers?.cookie.includes('corp=good') || data.token === 'one-time')
      return Response.json({ id: 'emp-42', name: 'Anna', email: 'anna@acme.example', groups: ['Design'] })
    return new Response(null, { status: 401 })
  }) as unknown as typeof fetch
  const server = await startServer(
    { AUTH: 'webhook', AUTH_WEBHOOK_URL: 'https://auth.acme.example/whoami', AUTH_WEBHOOK_SECRET: 'w'.repeat(20) },
    { fetch: fake },
  )
  try {
    const anna = client(server)
    anna.jar.set('corp', 'good')
    anna.jar.set('mb_session', 'not-for-them')
    const me = await anna.get('api/v1/me')
    assert.equal(me.status, 200)
    assert.equal((me.body as { user: { id: string } }).user.id, 'emp-42')
    assert.ok(seen[0].ok)
    assert.equal(
      (seen[0].body.headers as { cookie: string }).cookie,
      'corp=good',
      "Meshboard's own cookie isn't forwarded",
    )
    await anna.get('api/v1/me')
    assert.equal(seen.length, 1, 'answers are kept for a minute')
    const stranger = client(server)
    stranger.jar.set('corp', 'bad')
    assert.equal((await stranger.get('api/v1/me')).status, 401)
    assert.equal((await client(server).get('api/v1/me')).status, 401, 'nothing to ask about')

    // a one-time link from your app becomes a Meshboard session
    const link = client(server)
    const res = await link.get('auth/token?token=one-time&returnTo=%2Fb%2Fabcdefghijklmnop')
    assert.equal(res.status, 302)
    assert.equal(res.headers.get('location'), '/b/abcdefghijklmnop')
    assert.ok(link.jar.has('mb_session'))
    assert.equal((await link.get('api/v1/me')).status, 200)
    assert.equal((await client(server).get('auth/token?token=nope')).status, 401)
    // someone already signed in keeps their session: a link can't swap it for another person's
    const before = link.jar.get('mb_session')
    const swap = await link.get('auth/token?token=one-time&returnTo=%2F')
    assert.equal(swap.status, 302)
    assert.equal(swap.headers.getSetCookie().length, 0)
    assert.equal(link.jar.get('mb_session'), before)

    down = true
    const other = client(server)
    other.jar.set('corp', 'other')
    assert.equal((await other.get('api/v1/me')).status, 503)
  } finally {
    await server.stop()
  }
})

test('API tokens: read-only or read-write, never for live sync', async () => {
  const server = await startServer()
  try {
    const anna = await guest(server, 'Anna')
    const annaId = ((await anna.get('api/v1/me')).body as { user: { id: string } }).user.id
    const now = Date.now()
    const tokens = { read: `mbt_${randomToken(24)}`, write: `mbt_${randomToken(24)}`, old: `mbt_${randomToken(24)}` }
    for (const [name, token] of Object.entries(tokens))
      await server.database.db
        .insertInto('api_tokens')
        .values({
          id: `tok_${name}`,
          name,
          owner_id: annaId,
          token_hash: sha256(token),
          scopes: name === 'write' ? 'boards:read boards:write' : 'boards:read',
          created_at: now,
          expires_at: name === 'old' ? now - 1 : now + 86_400_000,
          last_used_at: null,
        })
        .execute()
    const bearer = (token: string) => {
      const c = client(server, { origin: '' })
      return {
        get: (p: string) => c.get(p, { authorization: `Bearer ${token}` }),
        post: (p: string, body: unknown) => c.post(p, body, { authorization: `Bearer ${token}` }),
        call: (m: string, p: string, body?: unknown) => c.call(m, p, body, { authorization: `Bearer ${token}` }),
      }
    }
    const board = (await anna.post('api/v1/boards', { title: 'Via the app' })).body as BoardSummary
    const reader = bearer(tokens.read)
    assert.equal(((await reader.get('api/v1/boards')).body as { total: number }).total, 1)
    assert.equal(((await reader.get(`api/v1/boards/${board.id}`)).body as BoardSummary).role, 'viewer')
    assert.equal((await reader.post('api/v1/boards', { title: 'x' })).status, 403)
    const writer = bearer(tokens.write)
    const made = await writer.post('api/v1/boards', { title: 'From a script' })
    assert.equal(made.status, 201, 'no Origin needed: tokens carry no cookies')
    assert.equal((made.body as BoardSummary).owner.id, annaId)
    // sharing and deleting for good stay with people in the app
    const id = (made.body as BoardSummary).id
    assert.equal((await writer.call('PATCH', `api/v1/boards/${id}`, { access: 'edit' })).status, 403)
    assert.equal((await writer.call('PATCH', `api/v1/boards/${id}`, { title: 'Renamed by a script' })).status, 200)
    assert.equal((await writer.call('PUT', `api/v1/boards/${id}/members/${annaId}`, { role: 'viewer' })).status, 403)
    assert.equal((await writer.call('DELETE', `api/v1/boards/${id}`)).status, 200)
    assert.equal((await writer.call('DELETE', `api/v1/boards/${id}?permanent=true`)).status, 403)
    assert.equal((await bearer(tokens.old).get('api/v1/boards')).status, 401)
    assert.equal((await bearer('mbt_short').get('api/v1/boards')).status, 401)
    assert.equal(await rawUpgrade(server, { origin: server.origin, authorization: `Bearer ${tokens.write}` }), 403)
  } finally {
    await server.stop()
  }
})

test('sign-in is rate limited per address', async () => {
  const server = await startServer()
  try {
    const c = client(server)
    const statuses: number[] = []
    for (let i = 0; i < 32; i++) statuses.push((await c.post('auth/guest', { name: '' })).status)
    assert.equal(statuses.filter((s) => s === 429).length, 2)
  } finally {
    await server.stop()
  }
})
