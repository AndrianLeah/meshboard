// Starts Meshboard: reads the settings, opens the database, listens, and on SIGTERM saves every open
// board before exiting.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ConfigError, parseConfig } from './config.ts'
import type { Config } from './config.ts'
import { openDatabase } from './db.ts'
import { createApp } from './app.ts'
import { jsonLogger as log, randomToken } from './util.ts'

/** SESSION_SECRET, or one generated once and kept in DATA_DIR (readable by this user only). */
export function sessionSecret(config: Config): string {
  if (config.sessionSecret) return config.sessionSecret
  const file = join(config.dataDir, 'session-secret')
  try {
    const existing = readFileSync(file, 'utf8').trim()
    if (existing.length >= 32) return existing
  } catch {
    /* first start */
  }
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 })
  const secret = randomToken(48)
  writeFileSync(file, `${secret}\n`, { mode: 0o600 })
  return secret
}

export async function main() {
  let config: Config
  try {
    config = parseConfig(process.env)
  } catch (err) {
    process.stderr.write(`${err instanceof ConfigError ? err.message : String(err)}\n`)
    process.exit(1)
  }
  if (config.databaseUrl && !config.sessionSecret)
    log('warn', 'Set SESSION_SECRET when running more than one instance: each would make its own')
  const database = await openDatabase({ databaseUrl: config.databaseUrl, dataDir: config.dataDir })
  const app = createApp(config, { db: database.db, log, secret: sessionSecret(config) })
  app.server.listen(config.port, config.host, () =>
    log('info', 'Meshboard is listening', {
      url: config.url.toString(),
      port: config.port,
      auth: config.auth.kind,
      database: database.kind,
    }),
  )

  let stopping = false
  const stop = async (signal: string) => {
    if (stopping) return
    stopping = true
    log('info', 'Stopping: saving open boards', { signal })
    const force = setTimeout(() => process.exit(1), 15_000)
    force.unref()
    try {
      await app.close()
      await database.close()
    } finally {
      process.exit(0)
    }
  }
  process.on('SIGTERM', () => void stop('SIGTERM'))
  process.on('SIGINT', () => void stop('SIGINT'))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => {
    log('error', 'Meshboard failed to start', { error: String(err) })
    process.exit(1)
  })
}
