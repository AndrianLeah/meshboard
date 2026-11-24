// Meshboard's own database: SQLite in DATA_DIR by default, or a Postgres database that only
// Meshboard uses (DATABASE_URL). Kysely builds every query, always with bound parameters.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Kysely, PostgresDialect, SqliteDialect, sql } from 'kysely'
import { Migrator } from 'kysely/migration'
import type { Migration, MigrationProvider } from 'kysely/migration'
import pg from 'pg'
import type { SqliteDatabase } from 'kysely'

export interface UsersTable {
  /** the id from the sign-in service */
  id: string
  name: string
  email: string | null
  avatar_url: string | null
  /** JSON array of group names, as the sign-in service last reported them */
  groups: string
  created_at: number
  last_seen_at: number
}

export interface SessionsTable {
  /** SHA-256 of the cookie's token: the token itself is never stored */
  id_hash: string
  user_id: string
  created_at: number
  expires_at: number
}

export interface BoardsTable {
  id: string
  title: string
  owner_id: string
  /** what everyone in the audience can do: none (members only), view or edit */
  access_level: string
  /** the audience: null for the whole organisation, or one group */
  access_group: string | null
  created_at: number
  updated_at: number
  updated_by: string | null
  deleted_at: number | null
  size_bytes: number
  /** a small SVG drawn from the board's items */
  preview: string | null
}

export interface BoardStateTable {
  board_id: string
  /** the Yjs document */
  state: Uint8Array
  updated_at: number
}

export interface MembersTable {
  board_id: string
  user_id: string
  role: string
  added_by: string | null
  added_at: number
}

export interface StarsTable {
  user_id: string
  board_id: string
  created_at: number
}

export interface VisitsTable {
  user_id: string
  board_id: string
  opened_at: number
}

export interface TokensTable {
  id: string
  name: string
  owner_id: string
  /** SHA-256 of the token: shown once, never stored */
  token_hash: string
  /** space-separated: boards:read boards:write */
  scopes: string
  created_at: number
  expires_at: number | null
  last_used_at: number | null
}

export interface Tables {
  users: UsersTable
  sessions: SessionsTable
  boards: BoardsTable
  board_state: BoardStateTable
  board_members: MembersTable
  board_stars: StarsTable
  board_visits: VisitsTable
  api_tokens: TokensTable
}

export type Db = Kysely<Tables>

export interface Database {
  db: Db
  kind: 'sqlite' | 'postgres'
  close: () => Promise<void>
}

/** node:sqlite behind the interface Kysely's SQLite dialect expects. */
function sqliteAdapter(file: string): SqliteDatabase {
  const db = new DatabaseSync(file)
  db.exec(
    'PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;',
  )
  return {
    close: () => db.close(),
    prepare(query: string) {
      const statement = db.prepare(query)
      const args = (params: ReadonlyArray<unknown>) => params as Array<null | number | bigint | string | Uint8Array>
      return {
        reader: statement.columns().length > 0,
        all: (params) => statement.all(...args(params)),
        run: (params) => statement.run(...args(params)),
        iterate: (params) => statement.iterate(...args(params)),
      }
    },
  }
}

export interface DatabaseOptions {
  databaseUrl: string | null
  dataDir: string
  /** SQLite only: a file name in dataDir, or ':memory:' */
  file?: string
}

/** Opens the database and brings its tables up to date. */
export async function openDatabase({
  databaseUrl,
  dataDir,
  file = 'meshboard.db',
}: DatabaseOptions): Promise<Database> {
  let db: Db
  let kind: Database['kind']
  if (databaseUrl) {
    // bigint columns hold milliseconds: well inside a JavaScript number
    pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v))
    db = new Kysely<Tables>({
      dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: databaseUrl, max: 10 }) }),
    })
    kind = 'postgres'
  } else {
    let path = file
    if (file !== ':memory:') {
      mkdirSync(dataDir, { recursive: true, mode: 0o700 })
      path = join(dataDir, file)
    }
    db = new Kysely<Tables>({ dialect: new SqliteDialect({ database: sqliteAdapter(path) }) })
    kind = 'sqlite'
  }
  const migrator = new Migrator({ db, provider: migrations(kind) })
  const { error, results } = await migrator.migrateToLatest()
  const failed = results?.find((r) => r.status === 'Error')
  if (error || failed) {
    await db.destroy()
    throw new Error(`Database migration failed${failed ? ` (${failed.migrationName})` : ''}: ${String(error)}`)
  }
  return { db, kind, close: () => db.destroy() }
}

function migrations(kind: Database['kind']): MigrationProvider {
  const blob = kind === 'postgres' ? 'bytea' : 'blob'
  const initial: Migration = {
    async up(db: Kysely<unknown>) {
      await db.schema
        .createTable('users')
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('name', 'text', (c) => c.notNull())
        .addColumn('email', 'text')
        .addColumn('avatar_url', 'text')
        .addColumn('groups', 'text', (c) => c.notNull().defaultTo('[]'))
        .addColumn('created_at', 'bigint', (c) => c.notNull())
        .addColumn('last_seen_at', 'bigint', (c) => c.notNull())
        .execute()
      await db.schema
        .createTable('sessions')
        .addColumn('id_hash', 'text', (c) => c.primaryKey())
        .addColumn('user_id', 'text', (c) => c.notNull().references('users.id').onDelete('cascade'))
        .addColumn('created_at', 'bigint', (c) => c.notNull())
        .addColumn('expires_at', 'bigint', (c) => c.notNull())
        .execute()
      await db.schema.createIndex('sessions_user').on('sessions').column('user_id').execute()
      await db.schema.createIndex('sessions_expiry').on('sessions').column('expires_at').execute()
      await db.schema
        .createTable('boards')
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('title', 'text', (c) => c.notNull())
        .addColumn('owner_id', 'text', (c) => c.notNull().references('users.id'))
        .addColumn('access_level', 'text', (c) => c.notNull())
        .addColumn('access_group', 'text')
        .addColumn('created_at', 'bigint', (c) => c.notNull())
        .addColumn('updated_at', 'bigint', (c) => c.notNull())
        .addColumn('updated_by', 'text')
        .addColumn('deleted_at', 'bigint')
        .addColumn('size_bytes', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('preview', 'text')
        .execute()
      await db.schema.createIndex('boards_owner').on('boards').column('owner_id').execute()
      await db.schema.createIndex('boards_updated').on('boards').column('updated_at').execute()
      await db.schema
        .createTable('board_state')
        .addColumn('board_id', 'text', (c) => c.primaryKey().references('boards.id').onDelete('cascade'))
        .addColumn('state', sql.raw(blob), (c) => c.notNull())
        .addColumn('updated_at', 'bigint', (c) => c.notNull())
        .execute()
      await db.schema
        .createTable('board_members')
        .addColumn('board_id', 'text', (c) => c.notNull().references('boards.id').onDelete('cascade'))
        .addColumn('user_id', 'text', (c) => c.notNull().references('users.id').onDelete('cascade'))
        .addColumn('role', 'text', (c) => c.notNull())
        .addColumn('added_by', 'text')
        .addColumn('added_at', 'bigint', (c) => c.notNull())
        .addPrimaryKeyConstraint('board_members_pk', ['board_id', 'user_id'])
        .execute()
      await db.schema.createIndex('board_members_user').on('board_members').column('user_id').execute()
      for (const [table, time] of [
        ['board_stars', 'created_at'],
        ['board_visits', 'opened_at'],
      ] as const) {
        await db.schema
          .createTable(table)
          .addColumn('user_id', 'text', (c) => c.notNull().references('users.id').onDelete('cascade'))
          .addColumn('board_id', 'text', (c) => c.notNull().references('boards.id').onDelete('cascade'))
          .addColumn(time, 'bigint', (c) => c.notNull())
          .addPrimaryKeyConstraint(`${table}_pk`, ['user_id', 'board_id'])
          .execute()
      }
      await db.schema
        .createTable('api_tokens')
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('name', 'text', (c) => c.notNull())
        .addColumn('owner_id', 'text', (c) => c.notNull().references('users.id').onDelete('cascade'))
        .addColumn('token_hash', 'text', (c) => c.notNull().unique())
        .addColumn('scopes', 'text', (c) => c.notNull())
        .addColumn('created_at', 'bigint', (c) => c.notNull())
        .addColumn('expires_at', 'bigint')
        .addColumn('last_used_at', 'bigint')
        .execute()
    },
  }
  return { getMigrations: async () => ({ '0001_initial': initial }) }
}
