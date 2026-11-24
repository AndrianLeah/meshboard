import './style.css'
import { getUser, setUserName, parseToken, newToken } from './identity.js'
import { renderHome } from './home.js'
import { openBoard } from './app.js'
import { toast } from './ui.js'
import { setupPwa } from './pwa.js'

const root = document.getElementById('app')
const repoUrl = import.meta.env.VITE_REPO_URL || ''

let current = null
let pendingData = null
let queue = Promise.resolve()

// navigations are queued: the previous board closes before the next one opens
function route() {
  queue = queue.then(doRoute).catch((err) => {
    console.error(err)
    toast(`Something went wrong: ${err.message || err}`, { tone: 'error', timeout: 8000 })
  })
}

async function doRoute() {
  if (current) {
    const prev = current
    current = null
    await prev.close()
  }
  const parsed = parseToken(location.hash)
  const user = getUser()
  if (parsed && user.name) {
    const initialData = pendingData
    pendingData = null
    current = await openBoard(root, parsed, user, { initialData, goHome })
  } else {
    current = renderHome(root, { user, parsed, enter, create, repoUrl })
  }
}

function enter(token, name) {
  setUserName(name)
  if (location.hash.slice(1) === token) route()
  else location.hash = token
}

function create(name, data = null) {
  setUserName(name)
  pendingData = data
  location.hash = newToken()
}

function goHome() {
  history.pushState(null, '', location.pathname + location.search)
  route()
}

setupPwa()
window.addEventListener('hashchange', route)
window.addEventListener('popstate', route)
route()
