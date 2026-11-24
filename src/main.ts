// Boot and routing: the home screen, or the board named by the link's #token.
import '@fontsource-variable/inter'
import './styles/index.css'
import { installTooltips, toast } from './ui/ds/index.ts'
import { getUser, setUserName, parseToken, newToken } from './core/identity.ts'
import { renderHome } from './pages/home.ts'
import { openBoard } from './pages/board-page.ts'
import { setupPwa } from './app/pwa.ts'
import type { BoardExport } from './core/types.ts'

const root = document.getElementById('app')!
const repoUrl: string = import.meta.env.VITE_REPO_URL || ''

/** The screen on show: closing it releases its listeners (and leaves the board's room). */
let current: { close: () => void | Promise<void> } | null = null
/** What the screen on show was opened for: a hash change fires both popstate and hashchange. */
let shownFor = ''
/** The board about to be created here, with the export to load into it, if any. */
let pending: { data: BoardExport | null } | null = null
let queue = Promise.resolve()

// navigations are queued: the previous board closes before the next one opens
function route() {
  queue = queue.then(doRoute).catch((err) => {
    console.error(err)
    toast(`Something went wrong: ${err.message || err}`, { tone: 'danger', timeout: 8000 })
  })
}

async function doRoute() {
  const parsed = parseToken(location.hash)
  const user = getUser()
  const target = parsed && user.name ? `board:${parsed.token}` : `home:${location.hash}`
  if (current && target === shownFor) return
  shownFor = target
  if (current) {
    const prev = current
    current = null
    await prev.close()
  }
  if (parsed && user.name) {
    const created = pending
    pending = null
    current = await openBoard(root, parsed, user, { initialData: created?.data, isNew: Boolean(created), goHome })
  } else {
    current = renderHome(root, { user, parsed, enter, create, repoUrl })
  }
}

function enter(token: string, name: string) {
  setUserName(name)
  if (location.hash.slice(1) === token) route()
  else location.hash = token
}

function create(name: string, data: BoardExport | null = null) {
  setUserName(name)
  pending = { data }
  location.hash = newToken()
}

function goHome() {
  history.pushState(null, '', location.pathname + location.search)
  route()
}

setupPwa()
installTooltips(document.body)
window.addEventListener('hashchange', route)
window.addEventListener('popstate', route)
route()
