// The self-hosted server for the end-to-end tests: the production build, a fresh SQLite database
// in a temporary folder, and sign-in with a name. Playwright starts it (playwright.config.ts).
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const HOSTED_PORT = 4176

process.env.MESHBOARD_URL ||= `http://localhost:${HOSTED_PORT}`
process.env.PORT ||= String(HOSTED_PORT)
process.env.HOST ||= '127.0.0.1'
process.env.DATA_DIR ||= mkdtempSync(join(tmpdir(), 'meshboard-e2e-'))
process.env.ORG_NAME ||= 'Acme'

// the other web server builds the app; wait for it rather than build twice at once
const index = join(import.meta.dirname, '..', 'dist', 'index.html')
for (let i = 0; i < 240 && !existsSync(index); i++) await new Promise((r) => setTimeout(r, 500))

const { main } = await import('../server/src/main.ts')
await main()
