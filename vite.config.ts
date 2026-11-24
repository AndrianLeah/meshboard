import { defineConfig, transformWithOxc } from 'vite'
import type { Plugin } from 'vite'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// Files in public/ to cache for offline use (not the screenshots: they're only
// for the install dialog and the README).
function publicFiles(dir = 'public'): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name !== 'screenshots') out.push(...publicFiles(full))
    } else if (!name.startsWith('.') && name !== 'og.png') {
      out.push(relative('public', full).split('\\').join('/'))
    }
  }
  return out
}

/** Compiles src/app/sw.ts into dist/sw.js, with the exact list of built files and a version. */
function serviceWorker(): Plugin {
  return {
    name: 'meshboard-service-worker',
    apply: 'build',
    enforce: 'post',
    async generateBundle(_options, bundle) {
      // chunks loaded on demand (the emoji data) are cached the first time they're used, not up front
      const built = Object.keys(bundle).filter((f) => {
        const out = bundle[f]
        return !f.endsWith('.map') && !(out.type === 'chunk' && out.isDynamicEntry)
      })
      const statics = publicFiles()
      const source = readFileSync('src/app/sw.ts', 'utf8')
      const { code: template } = await transformWithOxc(source, 'sw.ts', { lang: 'ts' })
      const hash = createHash('sha256').update(template)
      for (const f of [...built].sort()) hash.update(f)
      for (const f of statics.sort()) hash.update(f).update(readFileSync(join('public', f)))
      const files = ['./', ...built.filter((f) => f !== 'index.html'), ...statics]
      const output = template.replace('__VERSION__', hash.digest('hex').slice(0, 12)).replace(
        '__PRECACHE__',
        JSON.stringify(
          files.map((f) => (f === './' ? f : `./${f}`)),
          null,
          2,
        ),
      )
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: output })
    },
  }
}

// public address for link previews (og:image); the deploy workflow sets it
process.env.VITE_SITE_URL ||= './'

// `MESHBOARD_SERVER=http://localhost:8080 npm run dev` develops the self-hosted app against a
// running server (npm run server): its addresses go through Vite, and the page gets the <base>
// the server would give it.
const server = process.env.MESHBOARD_SERVER
function devServer(): Plugin {
  return {
    name: 'meshboard-dev-server',
    apply: 'serve',
    transformIndexHtml: (html) => (server ? html.replace(/<head>/i, '<head>\n    <base href="/" />') : html),
  }
}

// relative base: works at https://user.github.io/<repo>/ with no configuration
export default defineConfig({
  base: './',
  // the emoji data (~570 kB, ~86 kB gzipped) is its own chunk, loaded when the picker first opens
  build: { target: 'es2022', chunkSizeWarningLimit: 600 },
  plugins: [serviceWorker(), devServer()],
  server: server
    ? {
        proxy: {
          '/config.json': server,
          '/api': server,
          '/auth': server,
          '/sync': { target: server, ws: true },
        },
      }
    : {},
})
