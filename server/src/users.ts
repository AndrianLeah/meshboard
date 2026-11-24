// People and their sessions. Meshboard keeps a copy of who someone is (from the sign-in service) to
// show names on boards and to find people to share with; it never stores passwords.
import { sql } from 'kysely'
import type { Db, UsersTable } from './db.ts'
import type { Viewer } from './access.ts'
import { isAdmin } from './access.ts'
import { randomToken, sha256, text } from './util.ts'

export interface Identity {
  id: string
  name: string
  email: string | null
  avatarUrl: string | null
  groups: string[]
}

const MAX_GROUPS = 100

/** An identity from outside (sign-in service, gateway, webhook), checked and trimmed; null if unusable. */
export function cleanIdentity(raw: {
  id?: unknown
  name?: unknown
  email?: unknown
  avatarUrl?: unknown
  groups?: unknown
}): Identity | null {
  const id = text(raw.id, 200)
  if (!id) return null
  const email = text(raw.email, 254)
  const name = text(raw.name, 80) ?? (email ? email.split('@')[0] : null) ?? id.slice(0, 80)
  const avatar = text(raw.avatarUrl, 1000)
  let groups: string[] = []
  if (Array.isArray(raw.groups)) groups = raw.groups.map((g) => text(g, 100)).filter((g): g is string => Boolean(g))
  else if (typeof raw.groups === 'string')
    groups = raw.groups
      .split(',')
      .map((g) => text(g, 100))
      .filter((g): g is string => Boolean(g))
  return {
    id,
    name,
    email: email && /^[^\s@]+@[^\s@]+$/.test(email) ? email.toLowerCase() : null,
    // only https pictures: the CSP doesn't allow anything else, and http would leak who's looking
    avatarUrl: avatar && /^https:\/\//i.test(avatar) ? avatar : null,
    groups: [...new Set(groups)].slice(0, MAX_GROUPS),
  }
}

export interface AdminRules {
  adminEmails: ReadonlySet<string>
  adminGroup: string | null
}

export function parseGroups(raw: string): string[] {
  try {
    const list: unknown = JSON.parse(raw)
    return Array.isArray(list) ? list.filter((g): g is string => typeof g === 'string') : []
  } catch {
    return []
  }
}

export function toViewer(row: UsersTable, rules: AdminRules): Viewer {
  const groups = parseGroups(row.groups)
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    avatarUrl: row.avatar_url,
    groups,
    isAdmin: isAdmin({ email: row.email, groups }, rules.adminEmails, rules.adminGroup),
  }
}

/** Saves who someone is; written only when something changed or once every few minutes. */
export function createUserCache(db: Db, { touchMs = 5 * 60_000 } = {}) {
  const seen = new Map<string, { sig: string; at: number }>()
  return async function upsert(identity: Identity, now = Date.now()): Promise<UsersTable> {
    const sig = JSON.stringify(identity)
    const known = seen.get(identity.id)
    const row: UsersTable = {
      id: identity.id,
      name: identity.name,
      email: identity.email,
      avatar_url: identity.avatarUrl,
      groups: JSON.stringify(identity.groups),
      created_at: now,
      last_seen_at: now,
    }
    if (known && known.sig === sig && now - known.at < touchMs) return row
    await db
      .insertInto('users')
      .values(row)
      .onConflict((oc) =>
        oc.column('id').doUpdateSet({
          name: row.name,
          email: row.email,
          avatar_url: row.avatar_url,
          groups: row.groups,
          last_seen_at: now,
        }),
      )
      .execute()
    if (seen.size > 10_000) seen.clear()
    seen.set(identity.id, { sig, at: now })
    return row
  }
}

export type UpsertUser = ReturnType<typeof createUserCache>

// ---------- sessions ----------

/**
 * The session cookie's name. With HTTPS at the root, __Host- pins it to this host and path /; under
 * a sub-path __Secure- (a __Host- cookie must have Path=/).
 */
export const sessionCookie = (secure: boolean, basePath = '/'): string =>
  !secure ? 'mb_session' : basePath === '/' ? '__Host-mb_session' : '__Secure-mb_session'

/** Starts a session; returns the token for the cookie (only its hash is stored). */
export async function createSession(db: Db, userId: string, days: number, now = Date.now()): Promise<string> {
  const token = randomToken(32)
  await db
    .insertInto('sessions')
    .values({ id_hash: sha256(token), user_id: userId, created_at: now, expires_at: now + days * 86_400_000 })
    .execute()
  return token
}

/** The person a session token belongs to, or null when it's unknown or has expired. */
export async function sessionUser(
  db: Db,
  token: string | undefined,
  now = Date.now(),
): Promise<(UsersTable & { expires_at: number }) | null> {
  if (!token || token.length > 100) return null
  const row = await db
    .selectFrom('sessions')
    .innerJoin('users', 'users.id', 'sessions.user_id')
    .selectAll('users')
    .select('sessions.expires_at')
    .where('sessions.id_hash', '=', sha256(token))
    .executeTakeFirst()
  if (!row) return null
  if (row.expires_at <= now) {
    await endSession(db, token)
    return null
  }
  return row
}

export async function endSession(db: Db, token: string): Promise<void> {
  await db.deleteFrom('sessions').where('id_hash', '=', sha256(token)).execute()
}

export async function purgeExpiredSessions(db: Db, now = Date.now()): Promise<void> {
  await db.deleteFrom('sessions').where('expires_at', '<=', now).execute()
}

/** People whose name or email contains `q`, for sharing and the owner filter. */
export async function searchPeople(db: Db, q: string, limit = 20) {
  let query = db
    .selectFrom('users')
    .select(['id', 'name', 'email', 'avatar_url'])
    .orderBy('name')
    .limit(Math.min(Math.max(limit, 1), 50))
  const term = q.trim().toLowerCase().slice(0, 80)
  if (term) {
    const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    query = query.where(
      sql<boolean>`(lower(${sql.ref('name')}) like ${like} escape '\\' or lower(${sql.ref('email')}) like ${like} escape '\\')`,
    )
  }
  return query.execute()
}
