// The server's settings, read from the environment once at startup. Anything missing or wrong
// stops the server with a message naming the variable, before it opens a port.
import { BlockList, isIP } from 'node:net'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

export type AccessLevel = 'none' | 'view' | 'edit'

export type AuthConfig =
  | { kind: 'none' }
  | { kind: 'oidc'; issuer: URL; clientId: string; clientSecret: string; scopes: string; groupsClaim: string | null }
  | {
      kind: 'proxy'
      userHeader: string
      emailHeader: string | null
      nameHeader: string | null
      groupsHeader: string | null
    }
  | { kind: 'webhook'; url: URL; secret: string }

export interface Config {
  /** the public address: links, sign-in redirects, the Origin check */
  url: URL
  /** where the app is served from: the path of `url`, ending with a slash */
  basePath: string
  /** cookies are Secure and named with the __Host- prefix */
  secure: boolean
  host: string
  port: number
  dataDir: string
  /** a Postgres connection string; null keeps the data in SQLite under dataDir */
  databaseUrl: string | null
  /** signs cookies; null: generated into dataDir on first start */
  sessionSecret: string | null
  auth: AuthConfig
  /** addresses allowed to set proxy headers (sign-in and the client address) */
  trustedProxies: BlockList | null
  adminEmails: ReadonlySet<string>
  adminGroup: string | null
  /** general access of new boards */
  defaultAccess: AccessLevel
  /** shown as "Everyone at …" */
  orgName: string
  webhook: { url: URL; secret: string } | null
  maxBoardBytes: number
  maxMessageBytes: number
  /** the built app (dist/) */
  staticDir: string
  sessionDays: number
}

export class ConfigError extends Error {
  readonly problems: readonly string[]
  constructor(problems: string[]) {
    super(`Meshboard can't start:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
    this.problems = problems
  }
}

type Env = Record<string, string | undefined>

const DEFAULT_STATIC = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../dist')
const HEADER = /^[A-Za-z0-9-]{1,64}$/
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Reads the settings; throws a ConfigError listing every problem at once. */
export function parseConfig(env: Env): Config {
  const problems: string[] = []
  const get = (name: string): string | null => {
    const v = env[name]?.trim()
    return v ? v : null
  }
  const url = (name: string, { required = false } = {}): URL | null => {
    const raw = get(name)
    if (!raw) {
      if (required) problems.push(`${name} is required`)
      return null
    }
    try {
      const u = new URL(raw)
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('not http')
      return u
    } catch {
      problems.push(`${name} must be an http or https address, not "${raw}"`)
      return null
    }
  }
  const int = (name: string, fallback: number, min: number, max: number): number => {
    const raw = get(name)
    if (!raw) return fallback
    const n = Number(raw)
    if (!Number.isInteger(n) || n < min || n > max) {
      problems.push(`${name} must be a whole number from ${min} to ${max}`)
      return fallback
    }
    return n
  }
  const secret = (name: string): string => {
    const v = get(name)
    if (!v) problems.push(`${name} is required with AUTH=${get('AUTH')}`)
    else if (v.length < 16) problems.push(`${name} must be at least 16 characters`)
    return v ?? ''
  }
  const header = (name: string, fallback: string | null): string | null => {
    const v = get(name) ?? fallback
    if (v && !HEADER.test(v)) problems.push(`${name} must be an HTTP header name`)
    return v ? v.toLowerCase() : null
  }

  const publicUrl = url('MESHBOARD_URL', { required: true }) ?? new URL('http://localhost:8080/')
  if (publicUrl.search || publicUrl.hash) problems.push('MESHBOARD_URL must not have a query or a #fragment')
  const basePath = publicUrl.pathname.endsWith('/') ? publicUrl.pathname : `${publicUrl.pathname}/`
  publicUrl.pathname = basePath
  const secure = publicUrl.protocol === 'https:'
  if (!secure && !LOOPBACK.has(publicUrl.hostname) && get('ALLOW_HTTP') !== 'true')
    problems.push('MESHBOARD_URL must be https (set ALLOW_HTTP=true only for a test setup on a private network)')

  const trustedProxies = parseCidrs(get('TRUSTED_PROXIES'), problems)

  let auth: AuthConfig = { kind: 'none' }
  const kind = get('AUTH') ?? 'none'
  switch (kind) {
    case 'none':
      break
    case 'oidc': {
      const issuer = url('OIDC_ISSUER', { required: true })
      const clientId = get('OIDC_CLIENT_ID')
      if (!clientId) problems.push('OIDC_CLIENT_ID is required with AUTH=oidc')
      const clientSecret = get('OIDC_CLIENT_SECRET')
      if (!clientSecret) problems.push('OIDC_CLIENT_SECRET is required with AUTH=oidc')
      if (issuer && issuer.protocol !== 'https:' && !LOOPBACK.has(issuer.hostname))
        problems.push('OIDC_ISSUER must be https')
      auth = {
        kind: 'oidc',
        issuer: issuer ?? new URL('https://invalid.example/'),
        clientId: clientId ?? '',
        clientSecret: clientSecret ?? '',
        scopes: get('OIDC_SCOPES') ?? 'openid profile email',
        groupsClaim: get('OIDC_GROUPS_CLAIM'),
      }
      if (!auth.scopes.split(/\s+/).includes('openid')) problems.push('OIDC_SCOPES must include openid')
      break
    }
    case 'proxy': {
      if (!trustedProxies) problems.push('TRUSTED_PROXIES is required with AUTH=proxy')
      auth = {
        kind: 'proxy',
        userHeader: header('PROXY_USER_HEADER', 'X-Forwarded-User')!,
        emailHeader: header('PROXY_EMAIL_HEADER', 'X-Forwarded-Email'),
        nameHeader: header('PROXY_NAME_HEADER', null),
        groupsHeader: header('PROXY_GROUPS_HEADER', null),
      }
      break
    }
    case 'webhook': {
      const hook = url('AUTH_WEBHOOK_URL', { required: true })
      if (hook && hook.protocol !== 'https:' && !LOOPBACK.has(hook.hostname) && get('ALLOW_HTTP') !== 'true')
        problems.push('AUTH_WEBHOOK_URL must be https')
      auth = {
        kind: 'webhook',
        url: hook ?? new URL('https://invalid.example/'),
        secret: secret('AUTH_WEBHOOK_SECRET'),
      }
      break
    }
    default:
      problems.push(`AUTH must be none, oidc, proxy or webhook, not "${kind}"`)
  }

  const access = get('DEFAULT_ACCESS') ?? 'org_edit'
  const defaultAccess = ({ members: 'none', org_view: 'view', org_edit: 'edit' } as const)[access]
  if (!defaultAccess) problems.push('DEFAULT_ACCESS must be members, org_view or org_edit')

  const databaseUrl = get('DATABASE_URL')
  if (databaseUrl && !/^postgres(ql)?:\/\//.test(databaseUrl))
    problems.push('DATABASE_URL must be a postgres:// connection string')

  const sessionSecret = get('SESSION_SECRET')
  if (sessionSecret && sessionSecret.length < 32) problems.push('SESSION_SECRET must be at least 32 characters')

  const hookUrl = url('WEBHOOK_URL')
  let webhook: Config['webhook'] = null
  if (hookUrl) {
    const s = get('WEBHOOK_SECRET')
    if (!s || s.length < 16) problems.push('WEBHOOK_SECRET (16 characters or more) is required with WEBHOOK_URL')
    webhook = { url: hookUrl, secret: s ?? '' }
  }

  const config: Config = {
    url: publicUrl,
    basePath,
    secure,
    host: get('HOST') ?? '0.0.0.0',
    port: int('PORT', 8080, 1, 65535),
    dataDir: resolve(get('DATA_DIR') ?? 'data'),
    databaseUrl,
    sessionSecret,
    auth,
    trustedProxies,
    adminEmails: new Set(
      (get('ADMIN_EMAILS') ?? '')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
    adminGroup: get('ADMIN_GROUP'),
    defaultAccess: defaultAccess ?? 'edit',
    orgName: (get('ORG_NAME') ?? 'your organisation').slice(0, 60),
    webhook,
    maxBoardBytes: int('MAX_BOARD_BYTES', 20_000_000, 100_000, 500_000_000),
    maxMessageBytes: int('MAX_MESSAGE_BYTES', 2_000_000, 64_000, 50_000_000),
    staticDir: resolve(get('STATIC_DIR') ?? DEFAULT_STATIC),
    sessionDays: int('SESSION_DAYS', 30, 1, 365),
  }
  if (problems.length) throw new ConfigError(problems)
  return config
}

/** "10.0.0.0/8, 192.168.1.5, ::1" → a BlockList; problems for anything unreadable. */
export function parseCidrs(raw: string | null, problems: string[]): BlockList | null {
  if (!raw) return null
  const list = new BlockList()
  for (const part of raw.split(/[\s,]+/).filter(Boolean)) {
    const [address, prefix] = part.split('/')
    const family = isIP(address)
    if (!family) {
      problems.push(`TRUSTED_PROXIES has an invalid address: "${part}"`)
      continue
    }
    const type = family === 6 ? 'ipv6' : 'ipv4'
    if (prefix === undefined) {
      list.addAddress(address, type)
      continue
    }
    const bits = Number(prefix)
    if (!Number.isInteger(bits) || bits < 0 || bits > (family === 6 ? 128 : 32)) {
      problems.push(`TRUSTED_PROXIES has an invalid prefix: "${part}"`)
      continue
    }
    list.addSubnet(address, bits, type)
  }
  return list
}

/** Whether `address` (as Node reports it, IPv4-mapped IPv6 included) is in `list`. */
export function isTrusted(list: BlockList | null, address: string | undefined): boolean {
  if (!list || !address) return false
  const mapped = address.startsWith('::ffff:') ? address.slice(7) : address
  const family = isIP(mapped)
  if (!family) return false
  return list.check(mapped, family === 6 ? 'ipv6' : 'ipv4')
}
