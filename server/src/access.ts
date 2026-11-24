// Who can do what on a board. Pure functions: the routes and the sync server ask these, and the
// tests check them on their own.

export type Role = 'owner' | 'editor' | 'viewer'
export type Level = 'none' | 'view' | 'edit'

/** The person making a request, as the sign-in service describes them. */
export interface Viewer {
  id: string
  name: string
  email: string | null
  avatarUrl: string | null
  groups: readonly string[]
  isAdmin: boolean
  /** set when the request came with an API token: what it may do */
  scopes?: ReadonlySet<Scope>
}

export type Scope = 'boards:read' | 'boards:write'
export const SCOPES: readonly Scope[] = ['boards:read', 'boards:write']

export interface BoardAccess {
  owner_id: string
  access_level: string
  access_group: string | null
  deleted_at: number | null
}

const RANK: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 }

export const isRole = (v: unknown): v is Role => v === 'owner' || v === 'editor' || v === 'viewer'
export const isLevel = (v: unknown): v is Level => v === 'none' || v === 'view' || v === 'edit'

const higher = (a: Role | null, b: Role | null): Role | null => {
  if (!a) return b
  if (!b) return a
  return RANK[a] >= RANK[b] ? a : b
}

/**
 * The viewer's role on a board: from being its owner or an admin, from being a member, and from
 * the board's general access (everyone in the organisation, or everyone in one group). A board in
 * the trash is only reachable by its owner and admins.
 */
export function roleFor(viewer: Viewer, board: BoardAccess, memberRole: Role | null): Role | null {
  if (viewer.isAdmin || board.owner_id === viewer.id) return applyScopes(viewer, 'owner')
  if (board.deleted_at !== null) return null
  let role: Role | null = isRole(memberRole) ? memberRole : null
  const inAudience = board.access_group === null || viewer.groups.includes(board.access_group)
  if (inAudience && board.access_level === 'edit') role = higher(role, 'editor')
  if (inAudience && board.access_level === 'view') role = higher(role, 'viewer')
  return applyScopes(viewer, role)
}

/** An API token can only narrow what its owner may do. */
function applyScopes(viewer: Viewer, role: Role | null): Role | null {
  if (!role || !viewer.scopes) return role
  if (viewer.scopes.has('boards:write')) return role
  return viewer.scopes.has('boards:read') ? 'viewer' : null
}

export const canView = (role: Role | null): role is Role => role !== null
export const canEdit = (role: Role | null): boolean => role === 'owner' || role === 'editor'
/** Change access and members, move to the trash, restore, delete. */
export const canManage = (role: Role | null): boolean => role === 'owner'

/** Can this viewer create boards? Read-only tokens can't. */
export const canCreate = (viewer: Viewer): boolean => !viewer.scopes || viewer.scopes.has('boards:write')

/** Is someone an admin, by email or by group? */
export function isAdmin(
  identity: { email: string | null; groups: readonly string[] },
  adminEmails: ReadonlySet<string>,
  adminGroup: string | null,
): boolean {
  if (identity.email && adminEmails.has(identity.email.toLowerCase())) return true
  return adminGroup !== null && identity.groups.includes(adminGroup)
}
