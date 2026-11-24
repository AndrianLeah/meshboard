// Home screen: your name, new board, join from a link, open from a file, recent boards.
import { ICONS } from './icons.js'
import { getRecent, forgetRecent, parseToken } from './identity.js'
import { readJsonFile, relativeTime } from './ui.js'
import { canInstall, onInstallChange, promptInstall } from './pwa.js'

const TEMPLATE = `
  <main class="home">
    <section class="card home-card">
      <div class="home-brand">${ICONS.logoLarge}<h1>Meshboard</h1></div>
      <p class="tagline">A whiteboard for your team. No server, no accounts: browsers talk to each other directly.</p>

      <label class="field">
        <span>Your name</span>
        <input class="name-input" maxlength="40" autocomplete="nickname" placeholder="How others will see you" />
      </label>

      <div class="invite" hidden>
        <p class="invite-text">You've been invited to a board.</p>
        <button type="button" class="btn primary big join-invite">Join the board</button>
      </div>

      <div class="start">
        <button type="button" class="btn primary big create">Create a new board</button>
        <form class="join-form">
          <input class="link-input" placeholder="…or paste an invite link" aria-label="Invite link" />
          <button type="submit" class="btn">Join</button>
        </form>
        <button type="button" class="btn ghost open-file">${ICONS.upload}Open an exported file</button>
        <button type="button" class="btn ghost install" hidden>${ICONS.install}Install as app</button>
        <input type="file" class="file-input" accept=".json,application/json" hidden />
      </div>

      <p class="error" role="alert" hidden></p>
    </section>

    <section class="card recent" hidden>
      <h2>Recent boards in this browser</h2>
      <ul class="recent-list"></ul>
    </section>

    <p class="foot">Open source · your data stays in the participants' browsers<span class="repo"> · <a href="https://github.com/" class="repo-link" target="_blank" rel="noopener">source</a></span></p>
  </main>
`

/**
 * enter(token, name) joins a board; create(name, initialData?) makes a new one.
 * `parsed` is the token found in the URL, if any (an invite).
 */
export function renderHome(root, { user, parsed, enter, create, repoUrl }) {
  const page = document.createElement('div')
  page.className = 'home-page'
  page.innerHTML = TEMPLATE
  root.replaceChildren(page)
  document.title = 'Meshboard'
  const $ = (sel) => page.querySelector(sel)

  const nameInput = $('.name-input')
  const error = $('.error')
  nameInput.value = user.name || ''
  if (repoUrl) $('.repo-link').href = repoUrl
  else $('.repo').remove()

  const showError = (msg) => {
    error.textContent = msg
    error.hidden = !msg
  }

  function requireName() {
    const name = nameInput.value.trim()
    if (!name) {
      showError('Enter your name so teammates know who wrote what.')
      nameInput.focus()
      return null
    }
    showError('')
    return name
  }

  if (parsed) {
    $('.invite').hidden = false
    $('.start').hidden = true
    $('.join-invite').addEventListener('click', () => {
      const name = requireName()
      if (name) enter(parsed.token, name)
    })
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('.join-invite').click()
    })
  }

  $('.create').addEventListener('click', () => {
    const name = requireName()
    if (name) create(name)
  })

  $('.join-form').addEventListener('submit', (e) => {
    e.preventDefault()
    const p = parseToken($('.link-input').value)
    if (!p) return showError("That doesn't look like a Meshboard invite link.")
    const name = requireName()
    if (name) enter(p.token, name)
  })

  $('.open-file').addEventListener('click', () => {
    if (requireName()) $('.file-input').click()
  })
  $('.file-input').addEventListener('change', async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const data = await readJsonFile(file)
      if (data?.format !== 'meshboard' || !Array.isArray(data.items)) {
        throw new Error("This file isn't a Meshboard export.")
      }
      create(nameInput.value.trim(), data)
    } catch (err) {
      showError(err.message)
    }
  })

  // recent boards
  const list = $('.recent-list')
  function renderRecent() {
    const recent = getRecent()
    $('.recent').hidden = recent.length === 0
    list.replaceChildren(
      ...recent.map((r) => {
        const li = document.createElement('li')
        const open = document.createElement('button')
        open.type = 'button'
        open.className = 'recent-open'
        const title = document.createElement('strong')
        title.textContent = r.title
        const when = document.createElement('span')
        when.textContent = relativeTime(r.opened)
        open.append(title, when)
        open.addEventListener('click', () => {
          const name = requireName()
          if (name) enter(r.token, name)
        })
        const del = document.createElement('button')
        del.type = 'button'
        del.className = 'icon-btn'
        del.title = 'Remove from the list (the data stays in this browser)'
        del.setAttribute('aria-label', `Remove ${r.title} from the list`)
        del.innerHTML = ICONS.close
        del.addEventListener('click', () => {
          forgetRecent(r.token)
          renderRecent()
        })
        li.append(open, del)
        return li
      }),
    )
  }
  renderRecent()

  const install = $('.install')
  const syncInstall = (can) => (install.hidden = !can)
  syncInstall(canInstall())
  const offInstall = onInstallChange(syncInstall)
  install.addEventListener('click', () => promptInstall())

  // focus the name only when it's missing: a focused button on load looks already pressed
  if (parsed || !user.name) nameInput.focus()

  return { close: () => offInstall() }
}
