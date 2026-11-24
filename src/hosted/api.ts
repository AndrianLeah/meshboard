// The self-hosted server's API, for the dashboard, the share dialog and signing in. Same-origin
// requests with the session cookie; bodies are JSON.

export type Role = 'owner' | 'editor' | 'viewer'
export type Level = 'none' | 'view' | 'edit'
export type View = 'all' | 'recent' | 'starred' | 'shared' | 'trash'
export type Sort = 'opened' | 'edited' | 'title' | 'created'
export type AccessFilter = 'members' | 'org_view' | 'org_edit' | 'group'

export interface Person {
  id: string
  name: string
}

export interface Me extends Person {
  email: string | null
  avatarUrl: string | null
  groups: string[]
}

export interface BoardSummary {
  id: string
  title: string
  url: string
  role: Role
  starred: boolean
  online: number
  owner: Person
  access: { level: Level; group: string | null }
  createdAt: number
  updatedAt: number
  updatedBy: Person | null
  openedAt: number | null
  deletedAt: number | null
  members: Array<Person & { role: Role }>
  memberCount: number
  preview: string | null
}

export interface Counts {
  all: number
  recent: number
  starred: number
  shared: number
  trash: number
  groups: Array<{ name: string; count: number }>
}

export interface ListQuery {
  view?: View
  q?: string
  owner?: string
  access?: AccessFilter
  group?: string
  edited?: number
  sort?: Sort
  limit?: number
  offset?: number
}

export interface MemberInfo extends Person {
  email: string | null
  avatarUrl: string | null
}

export interface Members {
  yourRole: Role
  owner: MemberInfo
  access: { level: Level; group: string | null }
  members: Array<MemberInfo & { role: Role }>
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? { accept: 'application/json' } : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'offline', "Can't reach the server. Check your connection.")
  }
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const err = (data ?? {}) as { error?: string; message?: string }
    throw new ApiError(res.status, err.error ?? 'error', err.message ?? `The server answered ${res.status}`)
  }
  return data as T
}

const enc = encodeURIComponent

export const api = {
  me: () => call<{ user: Me; isAdmin: boolean }>('GET', 'api/v1/me'),
  /** AUTH=none: sign in (or rename) with a name */
  guest: (name: string) => call<{ ok: true }>('POST', 'auth/guest', { name }),
  logout: () => call<{ ok: true }>('POST', 'auth/logout', {}),
  boards(query: ListQuery = {}) {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') p.set(k, String(v))
    return call<{ boards: BoardSummary[]; total: number }>('GET', `api/v1/boards?${p}`)
  },
  counts: () => call<Counts>('GET', 'api/v1/boards/counts'),
  board: (id: string) => call<BoardSummary>('GET', `api/v1/boards/${enc(id)}`),
  create: (input: { title?: string; template?: unknown; access?: Level; group?: string | null } = {}) =>
    call<BoardSummary>('POST', 'api/v1/boards', input),
  update: (id: string, patch: { title?: string; access?: Level; group?: string | null }) =>
    call<BoardSummary>('PATCH', `api/v1/boards/${enc(id)}`, patch),
  trash: (id: string) => call<{ ok: true }>('DELETE', `api/v1/boards/${enc(id)}`),
  destroy: (id: string) => call<{ ok: true }>('DELETE', `api/v1/boards/${enc(id)}?permanent=true`),
  restore: (id: string) => call<BoardSummary>('POST', `api/v1/boards/${enc(id)}/restore`, {}),
  star: (id: string, on: boolean) => call<{ ok: true }>(on ? 'PUT' : 'DELETE', `api/v1/boards/${enc(id)}/star`, {}),
  members: (id: string) => call<Members>('GET', `api/v1/boards/${enc(id)}/members`),
  setMember: (id: string, userId: string, role: 'editor' | 'viewer') =>
    call<Members>('PUT', `api/v1/boards/${enc(id)}/members/${enc(userId)}`, { role }),
  removeMember: (id: string, userId: string) =>
    call<{ ok: true }>('DELETE', `api/v1/boards/${enc(id)}/members/${enc(userId)}`),
  people: (q: string) => call<{ people: MemberInfo[] }>('GET', `api/v1/people?q=${enc(q)}&limit=8`),
}
