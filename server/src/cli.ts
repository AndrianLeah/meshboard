#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
// Admin commands, run where the server runs (with the same environment):
//   meshboard check-config                       the settings are fine, or what's wrong
//   meshboard migrate                            brings the database tables up to date
//   meshboard token create --owner <email or id> --name <name> [--scopes boards:read,boards:write] [--days 90]
//   meshboard token list
//   meshboard token revoke <id>
import { parseArgs } from 'node:util'
import { ConfigError, parseConfig } from './config.ts'
import { openDatabase } from './db.ts'
import { SCOPES } from './access.ts'
import type { Scope } from './access.ts'
import { randomToken, sha256 } from './util.ts'

const out = (line: string) => process.stdout.write(`${line}\n`)
const fail = (line: string): never => {
  process.stderr.write(`${line}\n`)
  process.exit(1)
}

async function run(argv: string[]) {
  const [command, sub, ...rest] = argv
  let config
  try {
    config = parseConfig(process.env)
  } catch (err) {
    fail(err instanceof ConfigError ? err.message : String(err))
    return
  }
  if (command === 'check-config') return out(`Settings are fine (sign-in: ${config.auth.kind}).`)

  const database = await openDatabase({ databaseUrl: config.databaseUrl, dataDir: config.dataDir })
  const { db } = database
  try {
    if (command === 'migrate') return out('The database is up to date.')
    if (command !== 'token') return fail(`Unknown command "${command ?? ''}". See the comment at the top of cli.ts.`)

    if (sub === 'create') {
      const { values } = parseArgs({
        args: rest,
        options: {
          owner: { type: 'string' },
          name: { type: 'string' },
          scopes: { type: 'string' },
          days: { type: 'string' },
        },
      })
      if (!values.owner || !values.name) return fail('token create needs --owner and --name')
      const matches = await db
        .selectFrom('users')
        .select(['id', 'name'])
        .where((eb) => eb.or([eb('id', '=', values.owner!), eb('email', '=', values.owner!.toLowerCase())]))
        .limit(2)
        .execute()
      if (!matches.length)
        return fail(`Nobody called ${values.owner} has signed in yet: tokens act as an existing person.`)
      if (matches.length > 1) return fail(`Several people have ${values.owner}: use the id of the right one.`)
      const owner = matches[0]
      const scopes = (values.scopes ?? 'boards:read').split(',').map((s) => s.trim())
      const bad = scopes.filter((s) => !(SCOPES as readonly string[]).includes(s))
      if (bad.length) return fail(`Unknown scopes: ${bad.join(', ')} (use ${SCOPES.join(', ')})`)
      const days = values.days ? Number(values.days) : 90
      if (!Number.isInteger(days) || days < 1 || days > 3650) return fail('--days must be from 1 to 3650')
      const token = `mbt_${randomToken(32)}`
      const id = `tok_${randomToken(9)}`
      const now = Date.now()
      await db
        .insertInto('api_tokens')
        .values({
          id,
          name: values.name.slice(0, 80),
          owner_id: owner.id,
          token_hash: sha256(token),
          scopes: [...new Set(scopes as Scope[])].join(' '),
          created_at: now,
          expires_at: now + days * 86_400_000,
          last_used_at: null,
        })
        .execute()
      out(`Token ${id} for ${owner.name}, ${scopes.join(' ')}, valid ${days} days. Shown only now:`)
      return out(token)
    }
    if (sub === 'list') {
      const rows = await db
        .selectFrom('api_tokens')
        .innerJoin('users', 'users.id', 'api_tokens.owner_id')
        .select([
          'api_tokens.id',
          'api_tokens.name',
          'api_tokens.scopes',
          'api_tokens.expires_at',
          'users.name as owner',
        ])
        .orderBy('api_tokens.created_at')
        .execute()
      for (const r of rows)
        out(
          `${r.id}  ${r.name}  ${r.owner}  ${r.scopes}  expires ${r.expires_at ? new Date(r.expires_at).toISOString().slice(0, 10) : 'never'}`,
        )
      return out(rows.length ? '' : 'No tokens.')
    }
    if (sub === 'revoke') {
      const id = rest[0]
      if (!id) return fail('token revoke needs the token id')
      const result = await db.deleteFrom('api_tokens').where('id', '=', id).executeTakeFirst()
      return out(Number(result.numDeletedRows) ? `Revoked ${id}.` : `No token ${id}.`)
    }
    return fail('token needs create, list or revoke')
  } finally {
    await database.close()
  }
}

run(process.argv.slice(2)).catch((err) => fail(String(err)))
