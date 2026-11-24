// Boards: listing with filters, creating, sharing, the trash, stars, export and import. Every
// function takes the viewer and checks their role first; a board they can't see answers 404, so
// its existence doesn't leak.
import * as Y from 'yjs'
import { sql } from 'kysely'
import type { ExpressionBuilder } from 'kysely'
import type { Config } from './config.ts'
import type { BoardsTable, Db, Tables } from './db.ts'
import { canCreate, canEdit, canManage, isLevel, roleFor } from './access.ts'
import type { Level, Role, Viewer } from './access.ts'
import { HttpError } from './http.ts'
import { describe, storeFrom } from './preview.ts'
import type { Sync } from './sync.ts'
import type { Webhooks } from './webhooks.ts'
import { randomToken, text } from './util.ts'
import { exportBoard, importBoard, isExport } from '../../src/core/transfer.ts'
import type { BoardExport } from '../../src/core/types.ts'

export type View = 'all' | 'recent' | 'starred' | 'shared' | 'trash'
export type Sort = 'opened' | 'edited' | 'title' | 'created'
export type AccessFilter = 'members' | 'org_view' | 'org_edit' | 'group'

export interface ListQuery {
  view?: View
  q?: string
  /** 'me' or a user id */
  owner?: string
  access?: AccessFilter
  group?: string
  editedDays?: number
  sort?: Sort
  limit?: number
  offset?: number
}

export interface Person {
  id: string
  name: string
}

export interface BoardSummary {
  id: string
  title: string
  url: string
  role: Role
  starred: boolean
  /** people with the board open now */
  online: number
  owner: Person
  access: { level: Level; group: string | null }
  createdAt: number
  updatedAt: number
  updatedBy: Person | null
  openedAt: number | null
  deletedAt: number | null
  /** the first few members (besides the owner) */
  members: Array<Person & { role: Role }>
  memberCount: number
  /** the preview's address, or null for an empty board */
  preview: string | null
}

type Board = Omit<BoardsTable, 'preview'>

const BOARD_COLUMNS = [
  'boards.id',
  'boards.title',
  'boards.owner_id',
  'boards.access_level',
  'boards.access_group',
  'boards.created_at',
  'boards.updated_at',
  'boards.updated_by',
  'boards.deleted_at',
  'boards.size_bytes',
] as const

const MEMBERS_SHOWN = 5

export interface BoardsDeps {
  db: Db
  config: Pick<Config, 'url' | 'basePath' | 'defaultAccess' | 'maxBoardBytes'>
  sync: Pick<Sync, 'online' | 'recheck' | 'edit' | 'state'>
  webhooks: Webhooks
}

export function createBoards({ db, config, sync, webhooks }: BoardsDeps) {
  const urlOf = (id: string) => new URL(`b/${id}`, config.url).toString()
  const actor = (v: Viewer) => ({ id: v.id, name: v.name })
  const ref = (b: { id: string; title: string }) => ({ id: b.id, title: b.title, url: urlOf(b.id) })

  async function find(id: string): Promise<Board | undefined> {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) return undefined
    return db.selectFrom('boards').select(BOARD_COLUMNS).where('id', '=', id).executeTakeFirst()
  }

  async function memberRole(boardId: string, userId: string): Promise<Role | null> {
    const row = await db
      .selectFrom('board_members')
      .select('role')
      .where('board_id', '=', boardId)
      .where('user_id', '=', userId)
      .executeTakeFirst()
    return (row?.role as Role | undefined) ?? null
  }

  /** The board and the viewer's role; 404 when they can't see it, 403 when they can't do `need`. */
  async function require(viewer: Viewer, id: string, need: 'view' | 'edit' | 'manage') {
    const board = await find(id)
    const role = board ? roleFor(viewer, board, await memberRole(board.id, viewer.id)) : null
    if (!board || !role) throw new HttpError(404, 'not-found', 'No such board')
    if (need === 'edit' && !canEdit(role)) throw new HttpError(403, 'forbidden', 'You can only view this board')
    if (need === 'manage' && !canManage(role))
      throw new HttpError(403, 'forbidden', 'Only the owner can change who has access')
    return { board, role }
  }

  /** For live sync: the role on a board that isn't in the trash. */
  async function authorize(viewer: Viewer, id: string): Promise<Role | null> {
    const board = await find(id)
    if (!board || board.deleted_at !== null) return null
    return roleFor(viewer, board, await memberRole(id, viewer.id))
  }

  /** Boards the viewer can open (not those in the trash). */
  const visible = (viewer: Viewer) => (eb: ExpressionBuilder<Tables, 'boards'>) => {
    if (viewer.isAdmin) return eb.lit(true)
    const audience = viewer.groups.length
      ? eb.or([eb('boards.access_group', 'is', null), eb('boards.access_group', 'in', [...viewer.groups])])
      : eb('boards.access_group', 'is', null)
    return eb.or([
      eb('boards.owner_id', '=', viewer.id),
      eb.exists(
        eb
          .selectFrom('board_members as m')
          .select('m.board_id')
          .whereRef('m.board_id', '=', 'boards.id')
          .where('m.user_id', '=', viewer.id),
      ),
      eb.and([eb('boards.access_level', 'in', ['view', 'edit']), audience]),
    ])
  }

  function baseQuery(viewer: Viewer, query: ListQuery) {
    const view = query.view ?? 'all'
    let q = db
      .selectFrom('boards')
      .leftJoin('board_visits as v', (j) => j.onRef('v.board_id', '=', 'boards.id').on('v.user_id', '=', viewer.id))
      .leftJoin('board_stars as s', (j) => j.onRef('s.board_id', '=', 'boards.id').on('s.user_id', '=', viewer.id))
    if (view === 'trash') {
      q = q.where('boards.deleted_at', 'is not', null)
      if (!viewer.isAdmin) q = q.where('boards.owner_id', '=', viewer.id)
    } else {
      q = q.where('boards.deleted_at', 'is', null).where(visible(viewer))
    }
    if (view === 'recent') q = q.where('v.opened_at', 'is not', null)
    if (view === 'starred') q = q.where('s.created_at', 'is not', null)
    if (view === 'shared')
      q = q
        .where('boards.owner_id', '!=', viewer.id)
        .where((eb) =>
          eb.exists(
            eb
              .selectFrom('board_members as sm')
              .select('sm.board_id')
              .whereRef('sm.board_id', '=', 'boards.id')
              .where('sm.user_id', '=', viewer.id),
          ),
        )
    if (query.owner) q = q.where('boards.owner_id', '=', query.owner === 'me' ? viewer.id : query.owner)
    if (query.access === 'members') q = q.where('boards.access_level', '=', 'none')
    if (query.access === 'org_view' || query.access === 'org_edit')
      q = q
        .where('boards.access_level', '=', query.access === 'org_view' ? 'view' : 'edit')
        .where('boards.access_group', 'is', null)
    if (query.access === 'group') q = q.where('boards.access_group', 'is not', null)
    if (query.group) q = q.where('boards.access_group', '=', query.group)
    if (query.editedDays) q = q.where('boards.updated_at', '>=', Date.now() - query.editedDays * 86_400_000)
    const term = query.q?.trim().toLowerCase().slice(0, 100)
    if (term) {
      const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
      q = q.where(sql<boolean>`lower(${sql.ref('boards.title')}) like ${like} escape '\\'`)
    }
    return q
  }

  async function names(ids: Iterable<string>): Promise<Map<string, string>> {
    const list = [...new Set(ids)]
    if (!list.length) return new Map()
    const rows = await db.selectFrom('users').select(['id', 'name']).where('id', 'in', list).execute()
    return new Map(rows.map((r) => [r.id, r.name]))
  }

  async function summarize(
    viewer: Viewer,
    rows: Array<Board & { opened_at: number | null; starred_at: number | null; has_preview: number }>,
  ): Promise<BoardSummary[]> {
    if (!rows.length) return []
    const ids = rows.map((r) => r.id)
    const members = await db
      .selectFrom('board_members')
      .innerJoin('users', 'users.id', 'board_members.user_id')
      .select(['board_members.board_id', 'board_members.user_id', 'board_members.role', 'users.name'])
      .where('board_members.board_id', 'in', ids)
      .orderBy('board_members.added_at')
      .execute()
    const byBoard = new Map<string, typeof members>()
    for (const m of members) (byBoard.get(m.board_id) ?? byBoard.set(m.board_id, []).get(m.board_id)!).push(m)
    const people = await names(rows.flatMap((r) => [r.owner_id, ...(r.updated_by ? [r.updated_by] : [])]))
    const out: BoardSummary[] = []
    for (const r of rows) {
      const list = byBoard.get(r.id) ?? []
      const mine = list.find((m) => m.user_id === viewer.id)
      const role = roleFor(viewer, r, (mine?.role as Role | undefined) ?? null)
      if (!role) continue
      out.push({
        id: r.id,
        title: r.title,
        url: urlOf(r.id),
        role,
        starred: r.starred_at !== null,
        online: sync.online(r.id),
        owner: { id: r.owner_id, name: people.get(r.owner_id) ?? 'Someone' },
        access: { level: isLevel(r.access_level) ? r.access_level : 'none', group: r.access_group },
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        updatedBy: r.updated_by ? { id: r.updated_by, name: people.get(r.updated_by) ?? 'Someone' } : null,
        openedAt: r.opened_at,
        deletedAt: r.deleted_at,
        members: list.slice(0, MEMBERS_SHOWN).map((m) => ({ id: m.user_id, name: m.name, role: m.role as Role })),
        memberCount: list.length,
        preview: r.has_preview ? `${config.basePath}api/v1/boards/${r.id}/preview.svg?v=${r.updated_at}` : null,
      })
    }
    return out
  }

  async function summaryOf(viewer: Viewer, id: string): Promise<BoardSummary> {
    for (const view of ['all', 'trash'] as const) {
      const { boards } = await list(viewer, { view, limit: 1, offset: 0, idOnly: id })
      if (boards[0]) return boards[0]
    }
    throw new HttpError(404, 'not-found', 'No such board')
  }

  async function list(viewer: Viewer, query: ListQuery & { idOnly?: string }) {
    let q = baseQuery(viewer, query)
    if (query.idOnly) q = q.where('boards.id', '=', query.idOnly)
    const limit = Math.min(Math.max(query.limit ?? 48, 1), 100)
    const offset = Math.min(Math.max(query.offset ?? 0, 0), 100_000)
    const rowsQuery = q.select([
      ...BOARD_COLUMNS,
      'v.opened_at',
      's.created_at as starred_at',
      sql<number>`case when ${sql.ref('boards.preview')} is null then 0 else 1 end`.as('has_preview'),
    ])
    const sorted =
      query.sort === 'edited'
        ? rowsQuery.orderBy('boards.updated_at', 'desc')
        : query.sort === 'title'
          ? rowsQuery.orderBy(sql`lower(${sql.ref('boards.title')})`, 'asc')
          : query.sort === 'created'
            ? rowsQuery.orderBy('boards.created_at', 'desc')
            : rowsQuery
                .orderBy(sql`coalesce(${sql.ref('v.opened_at')}, 0)`, 'desc')
                .orderBy('boards.updated_at', 'desc')
    const [rows, total] = await Promise.all([
      sorted.orderBy('boards.id').limit(limit).offset(offset).execute(),
      q.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst(),
    ])
    return { boards: await summarize(viewer, rows), total: Number(total?.n ?? 0) }
  }

  async function counts(viewer: Viewer) {
    const count = async (view: View) =>
      Number(
        (
          await baseQuery(viewer, { view })
            .select((eb) => eb.fn.countAll<number>().as('n'))
            .executeTakeFirst()
        )?.n ?? 0,
      )
    const [all, recent, starred, shared, trash] = await Promise.all(
      (['all', 'recent', 'starred', 'shared', 'trash'] as const).map(count),
    )
    const groups: Array<{ name: string; count: number }> = []
    const own = viewer.groups.slice(0, 50)
    if (own.length) {
      const rows = await baseQuery(viewer, { view: 'all' })
        .where('boards.access_group', 'in', own)
        .select(['boards.access_group', (eb) => eb.fn.countAll<number>().as('n')])
        .groupBy('boards.access_group')
        .execute()
      const byName = new Map(rows.map((r) => [r.access_group, Number(r.n)]))
      for (const g of own) groups.push({ name: g, count: byName.get(g) ?? 0 })
    }
    return { all, recent, starred, shared, trash, groups }
  }

  function checkGroup(viewer: Viewer, group: unknown): string | null {
    if (group === null || group === undefined || group === '') return null
    const g = text(group, 100)
    if (!g || (!viewer.isAdmin && !viewer.groups.includes(g)))
      throw new HttpError(400, 'bad-group', 'You can only share with a group you belong to')
    return g
  }

  async function create(
    viewer: Viewer,
    input: { title?: unknown; template?: unknown; access?: unknown; group?: unknown },
  ): Promise<BoardSummary> {
    if (!canCreate(viewer)) throw new HttpError(403, 'forbidden', 'This token can only read boards')
    if (input.template !== undefined && !isExport(input.template))
      throw new HttpError(400, 'bad-template', "The template isn't a Meshboard board file")
    if (input.access !== undefined && !isLevel(input.access))
      throw new HttpError(400, 'bad-access', 'access must be none, view or edit')
    const group = checkGroup(viewer, input.group)
    const store = storeFrom(null)
    try {
      if (input.template) importBoard(store, input.template as BoardExport, { asNewBoard: true })
      const title = text(input.title, 200)
      if (title) store.setTitle(title)
      const state = Y.encodeStateAsUpdate(store.doc)
      if (state.byteLength > config.maxBoardBytes) throw new HttpError(413, 'too-large', 'The board is too large')
      const { title: finalTitle, preview } = describe(state)
      const id = randomToken(16)
      const now = Date.now()
      await db.transaction().execute(async (trx) => {
        await trx
          .insertInto('boards')
          .values({
            id,
            title: finalTitle,
            owner_id: viewer.id,
            access_level: (input.access as Level | undefined) ?? config.defaultAccess,
            access_group: group,
            created_at: now,
            updated_at: now,
            updated_by: viewer.id,
            deleted_at: null,
            size_bytes: state.byteLength,
            preview,
          })
          .execute()
        await trx.insertInto('board_state').values({ board_id: id, state, updated_at: now }).execute()
      })
      webhooks.emit('board.created', { board: ref({ id, title: finalTitle }), actor: actor(viewer) })
      return summaryOf(viewer, id)
    } finally {
      store.doc.destroy()
    }
  }

  async function update(viewer: Viewer, id: string, patch: { title?: unknown; access?: unknown; group?: unknown }) {
    const changesAccess = patch.access !== undefined || patch.group !== undefined
    const { board } = await require(viewer, id, changesAccess ? 'manage' : 'edit')
    if (board.deleted_at !== null) throw new HttpError(409, 'in-trash', 'Restore the board first')
    if (patch.title !== undefined) {
      const title = text(patch.title, 200) ?? ''
      await sync.edit(id, (doc) => doc.getMap('meta').set('title', title))
    }
    if (changesAccess) {
      if (patch.access !== undefined && !isLevel(patch.access))
        throw new HttpError(400, 'bad-access', 'access must be none, view or edit')
      const group = patch.group !== undefined ? checkGroup(viewer, patch.group) : board.access_group
      await db
        .updateTable('boards')
        .set({ access_level: (patch.access as Level | undefined) ?? board.access_level, access_group: group })
        .where('id', '=', id)
        .execute()
      // everyone connected is checked again with the new access
      sync.recheck(id)
    }
    return summaryOf(viewer, id)
  }

  async function trash(viewer: Viewer, id: string) {
    const { board } = await require(viewer, id, 'manage')
    if (board.deleted_at === null) {
      await db.updateTable('boards').set({ deleted_at: Date.now() }).where('id', '=', id).execute()
      sync.recheck(id)
      webhooks.emit('board.trashed', { board: ref(board), actor: actor(viewer) })
    }
  }

  async function restore(viewer: Viewer, id: string) {
    const { board } = await require(viewer, id, 'manage')
    if (board.deleted_at !== null) {
      await db.updateTable('boards').set({ deleted_at: null }).where('id', '=', id).execute()
      webhooks.emit('board.restored', { board: ref(board), actor: actor(viewer) })
    }
    return summaryOf(viewer, id)
  }

  /** Deletes a board for good: only from the trash. */
  async function destroy(viewer: Viewer, id: string) {
    const { board } = await require(viewer, id, 'manage')
    if (board.deleted_at === null) throw new HttpError(409, 'not-in-trash', 'Move the board to the trash first')
    await db.deleteFrom('boards').where('id', '=', id).execute()
    sync.recheck(id)
    webhooks.emit('board.deleted', { board: ref(board), actor: actor(viewer) })
  }

  async function star(viewer: Viewer, id: string, on: boolean) {
    await require(viewer, id, 'view')
    if (on)
      await db
        .insertInto('board_stars')
        .values({ user_id: viewer.id, board_id: id, created_at: Date.now() })
        .onConflict((oc) => oc.columns(['user_id', 'board_id']).doNothing())
        .execute()
    else await db.deleteFrom('board_stars').where('user_id', '=', viewer.id).where('board_id', '=', id).execute()
  }

  async function visit(viewer: Viewer, id: string) {
    const now = Date.now()
    await db
      .insertInto('board_visits')
      .values({ user_id: viewer.id, board_id: id, opened_at: now })
      .onConflict((oc) => oc.columns(['user_id', 'board_id']).doUpdateSet({ opened_at: now }))
      .execute()
  }

  async function members(viewer: Viewer, id: string) {
    const { board, role } = await require(viewer, id, 'view')
    const rows = await db
      .selectFrom('board_members')
      .innerJoin('users', 'users.id', 'board_members.user_id')
      .select(['users.id', 'users.name', 'users.email', 'users.avatar_url', 'board_members.role'])
      .where('board_members.board_id', '=', id)
      .orderBy('board_members.added_at')
      .execute()
    const owner = await db
      .selectFrom('users')
      .select(['id', 'name', 'email', 'avatar_url'])
      .where('id', '=', board.owner_id)
      .executeTakeFirst()
    // only people who can manage the board see email addresses
    const show = canManage(role)
    const person = (u: { id: string; name: string; email: string | null; avatar_url: string | null }) => ({
      id: u.id,
      name: u.name,
      email: show ? u.email : null,
      avatarUrl: u.avatar_url,
    })
    return {
      yourRole: role,
      owner: owner ? person(owner) : { id: board.owner_id, name: 'Someone', email: null, avatarUrl: null },
      access: { level: board.access_level as Level, group: board.access_group },
      members: rows.map((r) => ({ ...person(r), role: r.role as Role })),
    }
  }

  async function setMember(viewer: Viewer, id: string, userId: string, role: unknown) {
    const { board } = await require(viewer, id, 'manage')
    if (role !== 'editor' && role !== 'viewer') throw new HttpError(400, 'bad-role', 'role must be editor or viewer')
    if (userId === board.owner_id) throw new HttpError(400, 'is-owner', 'The owner already has full access')
    const user = await db.selectFrom('users').select(['id', 'name']).where('id', '=', userId).executeTakeFirst()
    if (!user) throw new HttpError(404, 'no-such-person', 'Nobody with that id has signed in yet')
    const now = Date.now()
    await db
      .insertInto('board_members')
      .values({ board_id: id, user_id: userId, role, added_by: viewer.id, added_at: now })
      .onConflict((oc) => oc.columns(['board_id', 'user_id']).doUpdateSet({ role }))
      .execute()
    sync.recheck(id)
    webhooks.emit('member.added', { board: ref(board), actor: actor(viewer), member: { id: userId, role } })
  }

  async function removeMember(viewer: Viewer, id: string, userId: string) {
    // anyone can leave a board; removing someone else takes the owner
    const { board } = await require(viewer, id, userId === viewer.id ? 'view' : 'manage')
    const result = await db
      .deleteFrom('board_members')
      .where('board_id', '=', id)
      .where('user_id', '=', userId)
      .executeTakeFirst()
    if (Number(result.numDeletedRows)) {
      sync.recheck(id)
      webhooks.emit('member.removed', { board: ref(board), actor: actor(viewer), member: { id: userId } })
    }
  }

  async function exportJson(viewer: Viewer, id: string): Promise<BoardExport> {
    await require(viewer, id, 'view')
    const store = storeFrom(await sync.state(id))
    try {
      return exportBoard(store)
    } finally {
      store.doc.destroy()
    }
  }

  async function importJson(viewer: Viewer, id: string, data: unknown): Promise<number> {
    const { board } = await require(viewer, id, 'edit')
    if (board.deleted_at !== null) throw new HttpError(409, 'in-trash', 'Restore the board first')
    if (!isExport(data)) throw new HttpError(400, 'bad-file', "This isn't a Meshboard board file")
    let added = 0
    await sync.edit(id, (doc) => {
      const copy = storeFrom(Y.encodeStateAsUpdate(doc))
      try {
        const before = Y.encodeStateVector(copy.doc)
        added = importBoard(copy, data).length
        const change = Y.encodeStateAsUpdate(copy.doc, before)
        Y.applyUpdate(doc, change)
      } finally {
        copy.doc.destroy()
      }
    })
    return added
  }

  async function preview(viewer: Viewer, id: string): Promise<string | null> {
    await require(viewer, id, 'view')
    const row = await db.selectFrom('boards').select('preview').where('id', '=', id).executeTakeFirst()
    return row?.preview ?? null
  }

  return {
    authorize,
    list,
    counts,
    create,
    detail: summaryOf,
    update,
    trash,
    restore,
    destroy,
    star,
    visit,
    members,
    setMember,
    removeMember,
    exportJson,
    importJson,
    preview,
  }
}

export type Boards = ReturnType<typeof createBoards>
