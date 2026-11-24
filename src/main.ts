// Boot and routing. Peer to peer (GitHub Pages): the home screen, or the board named by the link's
// #token. Self-hosted (a server answers config.json): the dashboard at /, a board at /b/<id>,
// after signing in.
import '@fontsource-variable/inter'
import './styles/index.css'
import { installTooltips, toast } from './ui/ds/index.ts'
import { getUser, setUserName, parseToken, newToken } from './core/identity.ts'
import { renderHome } from './pages/home.ts'
import { openBoard } from './pages/board-page.ts'
import { renderDashboard } from './pages/dashboard.ts'
import { renderGuestSignIn, renderMessage } from './pages/sign-in.ts'
import { setupPwa } from './app/pwa.ts'
import { loadRuntime } from './app/runtime.ts'
import type { Runtime } from './app/runtime.ts'
import { api, ApiError } from './hosted/api.ts'
import type { Me } from './hosted/api.ts'
import { forgetLocalCopies } from './sync/server.ts'
import { imageSettingsFromEnv } from './core/images.ts'
import type { BoardExport } from './core/types.ts'

const root = document.getElementById('app')!
const repoUrl: string = import.meta.env.VITE_REPO_URL || ''

type Screen = { close: () => void | Promise<void> }

/** Runs navigations one at a time: the previous screen closes before the next one opens. */
function router(doRoute: () => Promise<void>) {
  let queue = Promise.resolve()
  return () => {
    queue = queue.then(doRoute).catch((err) => {
      console.error(err)
      toast(`Something went wrong: ${err.message || err}`, { tone: 'danger', timeout: 8000 })
    })
  }
}

// ---------- peer to peer ----------

function startPeerToPeer() {
  let current: Screen | null = null
  /** What the screen on show was opened for: a hash change fires both popstate and hashchange. */
  let shownFor = ''
  /** The board about to be created here, with the export to load into it, if any. */
  let pending: { data: BoardExport | null } | null = null

  const route = router(async () => {
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
      current = await openBoard(root, { token: parsed }, user, {
        initialData: created?.data,
        isNew: Boolean(created),
        goHome,
        // whoever builds the public site can set an upload endpoint (VITE_UPLOAD_*)
        images: imageSettingsFromEnv({ ...import.meta.env }),
      })
    } else {
      current = renderHome(root, { user, parsed, enter, create, repoUrl })
    }
  })

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

  window.addEventListener('hashchange', route)
  window.addEventListener('popstate', route)
  route()
}

// ---------- self-hosted ----------

function startHosted(rt: Extract<Runtime, { mode: 'server' }>) {
  const base = rt.basePath
  const wsUrl = new URL('sync', document.baseURI).toString().replace(/^http/, 'ws')
  let current: Screen | null = null
  let me: Me | null = null

  const boardId = (): string | null => {
    const rel = location.pathname.startsWith(base) ? location.pathname.slice(base.length) : ''
    return /^b\/([A-Za-z0-9_-]{16,64})\/?$/.exec(rel)?.[1] ?? null
  }

  async function whoAmI(): Promise<Me | null> {
    try {
      return (await api.me()).user
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return null
      throw err
    }
  }

  function navigate(path: string) {
    if (path !== location.pathname) history.pushState(null, '', path)
    route()
  }
  const goHome = () => navigate(base)

  async function signOut() {
    try {
      await api.logout()
    } finally {
      // a shared computer keeps nothing of the boards
      await forgetLocalCopies().catch(() => {})
      location.assign(base)
    }
  }

  function signIn(): Screen {
    if (rt.auth.kind === 'none')
      return renderGuestSignIn(root, {
        orgName: rt.orgName,
        signIn: async (name) => {
          await api.guest(name)
          route()
        },
      })
    if (rt.auth.loginUrl) {
      const back = encodeURIComponent(location.pathname + location.search)
      location.assign(`${rt.auth.loginUrl}?returnTo=${back}`)
      return renderMessage(root, { title: 'Signing you in…', body: 'Taking you to the sign-in page.' })
    }
    return renderMessage(root, {
      title: "You're not signed in",
      body: 'Sign in through your organisation, then come back to this page.',
      action: { label: 'Try again', run: () => location.reload() },
    })
  }

  const route = router(async () => {
    if (current) {
      const prev = current
      current = null
      await prev.close()
    }
    me ??= await whoAmI()
    if (!me) {
      current = signIn()
      return
    }
    const user = me
    const id = boardId()
    if (!id) {
      current = renderDashboard(root, {
        me: user,
        orgName: rt.orgName,
        authKind: rt.auth.kind,
        canSignOut: rt.auth.canSignOut,
        open: (b) => navigate(`${base}b/${b.id}`),
        signOut,
      })
      return
    }
    let board
    try {
      board = await api.board(id)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        me = null
        current = signIn()
        return
      }
      current = renderMessage(root, {
        title: "This board can't be opened",
        body:
          err instanceof ApiError && err.status === 404
            ? "It doesn't exist, it's in the trash, or it hasn't been shared with you. Ask its owner for access."
            : (err as Error).message,
        action: { label: 'Go to your boards', run: goHome },
      })
      return
    }
    current = await openBoard(
      root,
      {
        hosted: {
          board,
          wsUrl,
          orgName: rt.orgName,
          groups: user.groups,
          renameSelf:
            rt.auth.kind === 'none'
              ? async (name) => {
                  await api.guest(name)
                  user.name = name
                }
              : undefined,
          checkSession: async () => Boolean(await whoAmI().catch(() => true)),
          onSignedOut: () => {
            me = null
            route()
          },
        },
      },
      { id: user.id, name: user.name },
      { goHome, images: rt.images },
    )
  })

  window.addEventListener('popstate', route)
  route()
}

setupPwa()
installTooltips(document.body)
loadRuntime().then((rt) => (rt.mode === 'server' ? startHosted(rt) : startPeerToPeer()))
