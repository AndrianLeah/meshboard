// Sign-in, the only place Meshboard reaches into your systems. Four ways, picked with AUTH:
//   none     people type a name (a trusted network, or trying it out)
//   oidc     OpenID Connect: Okta, Entra ID, Google Workspace, Keycloak, Auth0…
//   proxy    an SSO gateway in front of Meshboard passes who's signed in, in headers
//   webhook  an in-house service answers "who does this request belong to?"
// Whatever the way, each request ends up with a Viewer, or none.
import type { IncomingMessage } from 'node:http'
import * as oidc from 'openid-client'
import type { Config } from './config.ts'
import { isTrusted } from './config.ts'
import type { Db } from './db.ts'
import type { Viewer, Scope } from './access.ts'
import { SCOPES } from './access.ts'
import { HttpError, readJson, redirect, safeReturnTo, sendJson, checkSameOrigin } from './http.ts'
import type { Ctx } from './http.ts'
import { cleanIdentity, createSession, endSession, sessionCookie, sessionUser, toViewer } from './users.ts'
import type { Identity, UpsertUser } from './users.ts'
import {
  isRecord,
  parseCookies,
  randomToken,
  seal,
  serializeCookie,
  sha256,
  signatureHeaders,
  text,
  unseal,
} from './util.ts'
import type { Logger } from './util.ts'

/** What the app needs to know about signing in (part of /config.json). */
export interface AuthInfo {
  kind: Config['auth']['kind']
  /** where to send someone who isn't signed in; null with AUTH=none (the app asks for a name) */
  loginUrl: string | null
  /** whether the app shows "Sign out" */
  canSignOut: boolean
}

export interface Auth {
  info: AuthInfo
  /** Who sent this request, or null. API tokens are handled here too. */
  identify(req: IncomingMessage): Promise<Viewer | null>
  /** Handles /auth/… routes; returns false for any other path. */
  handle(ctx: Ctx): Promise<boolean>
}

interface AuthDeps {
  config: Config
  db: Db
  upsert: UpsertUser
  secret: string
  log: Logger
  fetch?: typeof fetch
  /** a session ended (signed out): its live connections should close */
  onSignOut?: (sessionKey: string) => void
}

const OIDC_COOKIE = 'mb_oidc'
const OIDC_TTL_S = 600
const WEBHOOK_TIMEOUT_MS = 3000
const WEBHOOK_CACHE_MS = 60_000

export function createAuth(deps: AuthDeps): Auth {
  const { config, db, upsert, secret, log } = deps
  const doFetch = deps.fetch ?? fetch
  const base = config.basePath
  const cookieName = sessionCookie(config.secure, base)
  const rules = { adminEmails: config.adminEmails, adminGroup: config.adminGroup }
  const cookieOptions = { secure: config.secure, path: base }

  /** Who may use this Meshboard at all: ALLOWED_GROUP, and OIDC_ALLOWED_DOMAINS for OpenID Connect. */
  function admit(identity: { groups: readonly string[]; email: string | null }, checkDomain = false) {
    if (config.allowedGroup && !identity.groups.includes(config.allowedGroup))
      throw new HttpError(403, 'not-allowed', "You're not in the group that can use this Meshboard")
    if (checkDomain && config.allowedDomains.size) {
      const domain = identity.email?.split('@')[1]
      if (!domain || !config.allowedDomains.has(domain))
        throw new HttpError(403, 'not-allowed', "Your account's domain can't use this Meshboard")
    }
  }

  const viewerOf = async (identity: Identity, { checkDomain = false } = {}): Promise<Viewer> => {
    admit(identity, checkDomain)
    return toViewer(await upsert(identity), rules)
  }

  async function startSession(_ctx: Ctx, userId: string): Promise<string> {
    const token = await createSession(db, userId, config.sessionDays)
    return serializeCookie(cookieName, token, { ...cookieOptions, maxAgeS: config.sessionDays * 86_400 })
  }

  const clearSession = () => serializeCookie(cookieName, '', { ...cookieOptions, maxAgeS: 0 })

  async function fromSession(req: IncomingMessage): Promise<Viewer | null> {
    const token = parseCookies(req.headers.cookie).get(cookieName)
    const row = await sessionUser(db, token)
    if (!row || !token) return null
    const viewer = toViewer(row, rules)
    // the allowed group is checked again on every request, with the groups seen at sign-in
    if (config.allowedGroup && !viewer.groups.includes(config.allowedGroup)) return null
    return { ...viewer, session: { key: sha256(token), expiresAt: row.expires_at } }
  }

  /** `Authorization: Bearer mbt_…`: an API token acts as its owner, within its scopes. */
  async function fromToken(req: IncomingMessage): Promise<Viewer | null | undefined> {
    const header = req.headers.authorization
    // other Authorization headers (a gateway's own, say) aren't Meshboard's business
    if (!header?.startsWith('Bearer mbt_')) return undefined
    const m = /^Bearer\s+(mbt_[A-Za-z0-9_-]{20,100})$/.exec(header)
    if (!m) throw new HttpError(401, 'bad-token', 'Unknown or malformed API token')
    const now = Date.now()
    const row = await db
      .selectFrom('api_tokens')
      .innerJoin('users', 'users.id', 'api_tokens.owner_id')
      .selectAll('users')
      .select(['api_tokens.id as token_id', 'api_tokens.scopes', 'api_tokens.expires_at', 'api_tokens.last_used_at'])
      .where('api_tokens.token_hash', '=', sha256(m[1]))
      .executeTakeFirst()
    if (!row || (row.expires_at !== null && row.expires_at <= now))
      throw new HttpError(401, 'bad-token', 'Unknown or expired API token')
    if (!row.last_used_at || now - row.last_used_at > 60_000)
      await db.updateTable('api_tokens').set({ last_used_at: now }).where('id', '=', row.token_id).execute()
    const { token_id: _id, scopes, expires_at: _exp, last_used_at: _used, ...user } = row
    return {
      ...toViewer(user, rules),
      scopes: new Set(scopes.split(' ').filter((s): s is Scope => (SCOPES as readonly string[]).includes(s))),
    }
  }

  async function signOut(ctx: Ctx) {
    checkSameOrigin(ctx.req, config)
    const token = parseCookies(ctx.req.headers.cookie).get(cookieName)
    if (token) {
      await endSession(db, token)
      deps.onSignOut?.(sha256(token))
    }
    sendJson(ctx.res, 200, { ok: true }, { 'set-cookie': clearSession() })
  }

  // ---------- AUTH=none: a name is enough ----------

  if (config.auth.kind === 'none') {
    return {
      info: { kind: 'none', loginUrl: null, canSignOut: true },
      async identify(req) {
        const token = await fromToken(req)
        return token === undefined ? fromSession(req) : token
      },
      async handle(ctx) {
        if (ctx.path === '/auth/guest' && ctx.req.method === 'POST') {
          checkSameOrigin(ctx.req, config)
          const body = await readJson(ctx.req, 10_000)
          const name = isRecord(body) ? text(body.name, 40) : null
          if (!name) throw new HttpError(400, 'name-required', 'Enter your name')
          // keep the same person when they only change their name
          const current = await fromSession(ctx.req)
          const id = current?.id ?? `guest_${randomToken(12)}`
          await upsert({ id, name, email: null, avatarUrl: null, groups: [] })
          const headers: Record<string, string> = {}
          if (!current) headers['set-cookie'] = await startSession(ctx, id)
          sendJson(ctx.res, 200, { ok: true }, headers)
          return true
        }
        if (ctx.path === '/auth/logout' && ctx.req.method === 'POST') {
          await signOut(ctx)
          return true
        }
        return false
      },
    }
  }

  // ---------- AUTH=oidc: OpenID Connect, authorization code with PKCE ----------

  if (config.auth.kind === 'oidc') {
    const settings = config.auth
    const redirectUri = new URL('auth/callback', config.url).toString()
    let discovered: Promise<oidc.Configuration> | null = null
    // discovered on first use and kept; a failure is retried on the next sign-in
    const provider = () =>
      (discovered ??= oidc
        .discovery(settings.issuer, settings.clientId, undefined, oidc.ClientSecretBasic(settings.clientSecret), {
          timeout: 10,
          // plain http only for an issuer on this machine (tests, local development)
          execute: settings.issuer.protocol === 'http:' ? [oidc.allowInsecureRequests] : [],
        })
        .catch((err: unknown) => {
          discovered = null
          throw err
        }))

    const claimsToIdentity = (claims: Record<string, unknown>): Identity | null => {
      // only an email the provider says is verified is theirs: anything else could be anyone's
      // (some providers leave email_verified out; use ADMIN_GROUP with those)
      const email = claims.email_verified === true ? claims.email : null
      const groups = settings.groupsClaim ? claims[settings.groupsClaim] : undefined
      return cleanIdentity({
        id: claims.sub,
        name: claims.name ?? claims.preferred_username ?? email,
        email,
        avatarUrl: claims.picture,
        groups: typeof groups === 'string' ? groups.split(/[\s,]+/) : groups,
      })
    }

    return {
      info: { kind: 'oidc', loginUrl: `${base}auth/login`, canSignOut: true },
      async identify(req) {
        const token = await fromToken(req)
        return token === undefined ? fromSession(req) : token
      },
      async handle(ctx) {
        if (ctx.path === '/auth/login' && ctx.req.method === 'GET') {
          let server: oidc.Configuration
          try {
            server = await provider()
          } catch (err) {
            log('error', 'OIDC discovery failed', { error: String(err) })
            throw new HttpError(503, 'sign-in-unavailable', "Can't reach the sign-in service")
          }
          const verifier = oidc.randomPKCECodeVerifier()
          const state = oidc.randomState()
          const nonce = oidc.randomNonce()
          const returnTo = safeReturnTo(ctx.url.searchParams.get('returnTo'), base)
          const url = oidc.buildAuthorizationUrl(server, {
            redirect_uri: redirectUri,
            scope: settings.scopes,
            code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
            code_challenge_method: 'S256',
            state,
            nonce,
          })
          const sealed = seal(secret, { verifier, state, nonce, returnTo, exp: Date.now() + OIDC_TTL_S * 1000 })
          redirect(ctx.res, url.toString(), {
            'set-cookie': serializeCookie(OIDC_COOKIE, sealed, { ...cookieOptions, maxAgeS: OIDC_TTL_S }),
          })
          return true
        }
        if (ctx.path === '/auth/callback' && ctx.req.method === 'GET') {
          const pending = unseal(secret, parseCookies(ctx.req.headers.cookie).get(OIDC_COOKIE))
          const clear = serializeCookie(OIDC_COOKIE, '', { ...cookieOptions, maxAgeS: 0 })
          if (
            !isRecord(pending) ||
            typeof pending.verifier !== 'string' ||
            typeof pending.state !== 'string' ||
            typeof pending.nonce !== 'string' ||
            typeof pending.exp !== 'number' ||
            pending.exp < Date.now()
          )
            throw new HttpError(
              400,
              'sign-in-expired',
              'The sign-in took too long or was started elsewhere. Try again.',
            )
          let claims: Record<string, unknown> | undefined
          try {
            const server = await provider()
            // the address the provider sent the browser back to, built from our own URL (never the Host header)
            const current = new URL(redirectUri)
            current.search = ctx.url.search
            const tokens = await oidc.authorizationCodeGrant(server, current, {
              pkceCodeVerifier: pending.verifier,
              expectedState: pending.state,
              expectedNonce: pending.nonce,
              idTokenExpected: true,
            })
            claims = tokens.claims() as Record<string, unknown> | undefined
          } catch (err) {
            log('warn', 'OIDC sign-in failed', { error: String(err) })
            throw new HttpError(401, 'sign-in-failed', "Couldn't sign you in. Try again.")
          }
          const identity = claims && claimsToIdentity(claims)
          if (!identity) throw new HttpError(401, 'sign-in-failed', 'The sign-in service sent no user id')
          const viewer = await viewerOf(identity, { checkDomain: true })
          const cookie = await startSession(ctx, viewer.id)
          redirect(ctx.res, safeReturnTo(pending.returnTo, base), { 'set-cookie': [cookie, clear] })
          return true
        }
        if (ctx.path === '/auth/logout' && ctx.req.method === 'POST') {
          await signOut(ctx)
          return true
        }
        return false
      },
    }
  }

  // ---------- AUTH=proxy: an SSO gateway in front says who's signed in ----------

  if (config.auth.kind === 'proxy') {
    const settings = config.auth
    const one = (req: IncomingMessage, name: string | null) => {
      if (!name) return null
      const v = req.headers[name]
      return Array.isArray(v) ? v[0] : (v ?? null)
    }
    return {
      info: { kind: 'proxy', loginUrl: null, canSignOut: false },
      async identify(req) {
        const token = await fromToken(req)
        if (token !== undefined) return token
        // headers from anyone but the gateway are ignored: anyone could send them
        if (!isTrusted(config.trustedProxies, req.socket.remoteAddress)) return null
        const identity = cleanIdentity({
          id: one(req, settings.userHeader),
          email: one(req, settings.emailHeader),
          name: one(req, settings.nameHeader) ?? one(req, settings.emailHeader),
          groups: one(req, settings.groupsHeader) ?? undefined,
        })
        return identity && viewerOf(identity)
      },
      handle: async () => false,
    }
  }

  // ---------- AUTH=webhook: your service says who a request belongs to ----------

  const settings = config.auth
  const cache = new Map<string, { viewer: Viewer | null; until: number }>()

  async function askWebhook(payload: Record<string, unknown>): Promise<Identity | null> {
    const body = JSON.stringify(payload)
    let res: Response
    try {
      res = await doFetch(settings.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...signatureHeaders(settings.secret, body) },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      })
    } catch (err) {
      log('error', 'Sign-in webhook unreachable', { error: String(err) })
      throw new HttpError(503, 'sign-in-unavailable', "Can't reach the sign-in service")
    }
    if (res.status === 401 || res.status === 403) return null
    if (!res.ok) {
      log('error', 'Sign-in webhook failed', { status: res.status })
      throw new HttpError(503, 'sign-in-unavailable', "Can't reach the sign-in service")
    }
    const data: unknown = await res.json().catch(() => null)
    const identity = isRecord(data) ? cleanIdentity(data) : null
    if (!identity) log('error', 'Sign-in webhook answered without a usable id')
    return identity
  }

  /** Your cookies and authorization header, without Meshboard's own session. */
  function forwardedHeaders(req: IncomingMessage): { cookie: string; authorization: string } | null {
    const cookies = [...parseCookies(req.headers.cookie)].filter(
      ([name]) => name !== cookieName && name !== OIDC_COOKIE,
    )
    const cookie = cookies.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ')
    const authorization = req.headers.authorization ?? ''
    return cookie || authorization ? { cookie, authorization } : null
  }

  return {
    info: { kind: 'webhook', loginUrl: null, canSignOut: false },
    async identify(req) {
      if (req.headers.authorization?.startsWith('Bearer mbt_')) return (await fromToken(req)) ?? null
      const session = await fromSession(req)
      if (session) return session
      const headers = forwardedHeaders(req)
      if (!headers) return null
      const key = sha256(JSON.stringify(headers))
      const now = Date.now()
      const hit = cache.get(key)
      if (hit && hit.until > now) return hit.viewer
      const identity = await askWebhook({ headers })
      const viewer = identity && (await viewerOf(identity))
      if (cache.size > 5000) cache.clear()
      cache.set(key, { viewer, until: now + WEBHOOK_CACHE_MS })
      return viewer
    },
    async handle(ctx) {
      // a link from your app: /auth/token?token=…&returnTo=…, exchanged once for a Meshboard session
      if (ctx.path === '/auth/token' && ctx.req.method === 'GET') {
        const returnTo = safeReturnTo(ctx.url.searchParams.get('returnTo'), base)
        // already signed in: a link never swaps the session for someone else's
        if (await fromSession(ctx.req)) {
          redirect(ctx.res, returnTo)
          return true
        }
        const token = text(ctx.url.searchParams.get('token'), 4000)
        if (!token) throw new HttpError(400, 'token-required', 'A token is required')
        const identity = await askWebhook({ token })
        if (!identity) throw new HttpError(401, 'sign-in-failed', "Couldn't sign you in with that link")
        const viewer = await viewerOf(identity)
        const cookie = await startSession(ctx, viewer.id)
        redirect(ctx.res, returnTo, { 'set-cookie': cookie })
        return true
      }
      if (ctx.path === '/auth/logout' && ctx.req.method === 'POST') {
        await signOut(ctx)
        return true
      }
      return false
    },
  }
}
