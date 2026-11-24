// Which Meshboard this is. A self-hosted server answers ./config.json; GitHub Pages and other static
// hosts answer 404, and the app runs peer to peer. One build serves both.

export type AuthKind = 'none' | 'oidc' | 'proxy' | 'webhook'

export type Runtime =
  | { mode: 'p2p' }
  | {
      mode: 'server'
      /** shown as "Everyone at …" */
      orgName: string
      /** the app's path on the server, ending with / */
      basePath: string
      auth: { kind: AuthKind; loginUrl: string | null; canSignOut: boolean }
    }

const KINDS: readonly AuthKind[] = ['none', 'oidc', 'proxy', 'webhook']
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** What config.json says, or peer to peer when it says nothing usable. */
export function parseRuntime(raw: unknown): Runtime {
  if (!isRecord(raw) || raw.mode !== 'server' || !isRecord(raw.auth)) return { mode: 'p2p' }
  const kind = KINDS.find((k) => k === (raw.auth as Record<string, unknown>).kind)
  if (!kind) return { mode: 'p2p' }
  const base = typeof raw.basePath === 'string' && raw.basePath.startsWith('/') ? raw.basePath : '/'
  const login = raw.auth.loginUrl
  return {
    mode: 'server',
    orgName: typeof raw.orgName === 'string' && raw.orgName ? raw.orgName.slice(0, 60) : 'your organisation',
    basePath: base.endsWith('/') ? base : `${base}/`,
    auth: {
      kind,
      // only an address on this server: a config can't send people elsewhere to sign in
      loginUrl: typeof login === 'string' && login.startsWith('/') && !login.startsWith('//') ? login : null,
      canSignOut: raw.auth.canSignOut === true,
    },
  }
}

export async function loadRuntime(get: typeof fetch = fetch): Promise<Runtime> {
  try {
    const res = await get('./config.json', { cache: 'no-store', headers: { accept: 'application/json' } })
    if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) return { mode: 'p2p' }
    return parseRuntime(await res.json())
  } catch {
    return { mode: 'p2p' }
  }
}
