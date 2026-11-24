// Schermata iniziale: nome, nuova lavagna, entra da link, apri da file, recenti.
import { ICONS } from './icons.js'
import { getRecent, forgetRecent, parseToken } from './identity.js'
import { readJsonFile, relativeTime } from './ui.js'

const TEMPLATE = `
  <main class="home">
    <section class="card home-card">
      <div class="home-brand">${ICONS.logo}<h1>Meshboard</h1></div>
      <p class="tagline">Lavagna condivisa tra colleghi. Niente server, niente account: i browser si parlano direttamente.</p>

      <label class="field">
        <span>Il tuo nome</span>
        <input class="name-input" maxlength="40" autocomplete="nickname" placeholder="Come ti vedranno gli altri" />
      </label>

      <div class="invite" hidden>
        <p class="invite-text">Ti hanno invitato a una lavagna.</p>
        <button type="button" class="btn primary big join-invite">Entra nella lavagna</button>
      </div>

      <div class="start">
        <button type="button" class="btn primary big create">Crea una nuova lavagna</button>
        <form class="join-form">
          <input class="link-input" placeholder="…oppure incolla un link di invito" aria-label="Link di invito" />
          <button type="submit" class="btn">Entra</button>
        </form>
        <button type="button" class="btn ghost open-file">${ICONS.upload}Apri da un file esportato</button>
        <input type="file" class="file-input" accept=".json,application/json" hidden />
      </div>

      <p class="error" role="alert" hidden></p>
    </section>

    <section class="card recent" hidden>
      <h2>Lavagne recenti su questo browser</h2>
      <ul class="recent-list"></ul>
    </section>

    <p class="foot">Open source · i dati restano nei browser di chi partecipa · <a href="https://github.com/" class="repo-link" target="_blank" rel="noopener">codice</a></p>
  </main>
`

/**
 * actions: {enter(token, name), create(name, initialData?)}
 * `parsed` è il token nell'URL, se presente (invito).
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
  else $('.repo-link').remove()

  const showError = (msg) => {
    error.textContent = msg
    error.hidden = !msg
  }

  function requireName() {
    const name = nameInput.value.trim()
    if (!name) {
      showError('Scrivi il tuo nome: serve ai colleghi per sapere chi ha scritto cosa.')
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
    if (!p) return showError('Il link non sembra un invito di Meshboard.')
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
        throw new Error('Il file non è un export di Meshboard.')
      }
      create(nameInput.value.trim(), data)
    } catch (err) {
      showError(err.message)
    }
  })

  // recenti
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
        del.title = 'Togli dall’elenco (i dati restano nel browser)'
        del.setAttribute('aria-label', `Togli ${r.title} dall’elenco`)
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
  ;(parsed ? nameInput : user.name ? $('.create') : nameInput).focus()

  return { close() {} }
}
