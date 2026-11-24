import { defineConfig } from 'vite'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// Files in public/ to cache for offline use (not the screenshots: they're only
// for the install dialog and the README).
function publicFiles(dir = 'public') {
  const out = []
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

/** Emits dist/sw.js with the exact list of built files and a version. */
function serviceWorker() {
  return {
    name: 'meshboard-service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle).filter((f) => !f.endsWith('.map'))
      const statics = publicFiles()
      const template = readFileSync('src/sw.js', 'utf8')
      const hash = createHash('sha256').update(template)
      for (const f of [...built].sort()) hash.update(f)
      for (const f of statics.sort()) hash.update(f).update(readFileSync(join('public', f)))
      const files = ['./', ...built.filter((f) => f !== 'index.html'), ...statics]
      const source = template
        .replace('__VERSION__', hash.digest('hex').slice(0, 12))
        .replace('__PRECACHE__', JSON.stringify(files.map((f) => (f === './' ? f : `./${f}`)), null, 2))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

// public address for link previews (og:image); the deploy workflow sets it
process.env.VITE_SITE_URL ||= './'

// relative base: works at https://user.github.io/<repo>/ with no configuration
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
  plugins: [serviceWorker()],
})
