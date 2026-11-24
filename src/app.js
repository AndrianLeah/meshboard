// Schermata della lavagna: barra in alto, strumenti, menu, import/export.
import { createStore, COLORS, COLOR_KEYS, DEFAULT_TITLE } from './store.js'
import { connect } from './sync.js'
import { createBoard } from './board.js'
import { ICONS } from './icons.js'
import { setUserName, shareUrl, touchRecent, userColor, initials } from './identity.js'
import { toast, readJsonFile, downloadJson, slug, copyText } from './ui.js'

const TOOLS = [
  ['select', 'Seleziona', 'V'],
  ['hand', 'Sposta la vista', 'H'],
  ['note', 'Post-it', 'N'],
  ['rect', 'Rettangolo', 'R'],
  ['ellipse', 'Ellisse', 'O'],
  ['text', 'Testo', 'T'],
  ['arrow', 'Freccia', 'A'],
]

const COLOR_NAMES = {
  yellow: 'Giallo',
  orange: 'Arancione',
  red: 'Rosso',
  pink: 'Rosa',
  purple: 'Viola',
  blue: 'Blu',
  green: 'Verde',
  gray: 'Grigio',
}

const SHORTCUTS = [
  ['V / H', 'Seleziona / sposta la vista'],
  ['N R O T A', 'Post-it, rettangolo, ellisse, testo, freccia'],
  ['Doppio clic', 'Nuovo post-it, o modifica il testo'],
  ['Invio / Esc', 'Modifica il testo / esci'],
  ['Spazio + trascina', 'Sposta la vista'],
  ['Rotella · Ctrl + rotella', 'Scorri · zoom'],
  ['Maiusc + clic', 'Aggiungi alla selezione'],
  ['Canc', 'Elimina la selezione'],
  ['Ctrl D', 'Duplica'],
  ['Ctrl Z / Ctrl Maiusc Z', 'Annulla / ripeti'],
  ['Frecce', 'Sposta di 1 px (Maiusc: 10 px)'],
  ['Maiusc 1', 'Inquadra tutto'],
]

const TEMPLATE = `
  <div class="board-viewport"></div>
  <header class="topbar">
    <div class="card brand-block">
      <button type="button" class="icon-btn home-btn" title="Tutte le lavagne" aria-label="Tutte le lavagne">${ICONS.logo}</button>
      <input class="title-input" maxlength="80" aria-label="Titolo della lavagna" />
    </div>
    <div class="card right-block">
      <span class="status" title="Persone collegate"><i class="dot"></i><span class="status-text">Solo tu</span></span>
      <div class="avatars"></div>
      <button type="button" class="btn primary share">${ICONS.link}<span>Condividi</span></button>
      <div class="menu-wrap">
        <button type="button" class="icon-btn menu-btn" aria-haspopup="menu" aria-expanded="false" aria-label="Altro">${ICONS.more}</button>
        <div class="menu card" role="menu" hidden>
          <button type="button" role="menuitem" data-act="export">${ICONS.download}Esporta lavagna (.json)</button>
          <button type="button" role="menuitem" data-act="import">${ICONS.upload}Importa da file…</button>
          <hr />
          <button type="button" role="menuitem" data-act="rename">${ICONS.user}Cambia il tuo nome</button>
          <button type="button" role="menuitem" data-act="help">${ICONS.keyboard}Scorciatoie da tastiera</button>
          <hr />
          <button type="button" role="menuitem" data-act="home">${ICONS.home}Tutte le lavagne</button>
        </div>
      </div>
    </div>
  </header>
  <nav class="card toolbar" aria-label="Strumenti">
    ${TOOLS.map(
      ([id, label, key]) =>
        `<button type="button" class="icon-btn tool" data-tool="${id}" title="${label} (${key})" aria-label="${label}">${ICONS[id]}</button>`,
    ).join('')}
    <hr />
    <button type="button" class="icon-btn" data-act="undo" title="Annulla (Ctrl Z)" aria-label="Annulla">${ICONS.undo}</button>
    <button type="button" class="icon-btn" data-act="redo" title="Ripeti (Ctrl Maiusc Z)" aria-label="Ripeti">${ICONS.redo}</button>
  </nav>
  <div class="card contextbar" hidden>
    <div class="swatches">
      ${COLOR_KEYS.map(
        (k) =>
          `<button type="button" class="swatch" data-color="${k}" style="--fill:${COLORS[k].fill};--stroke:${COLORS[k].stroke}" title="${COLOR_NAMES[k]}" aria-label="${COLOR_NAMES[k]}"></button>`,
      ).join('')}
    </div>
    <hr />
    <button type="button" class="icon-btn" data-act="front" title="Porta in primo piano" aria-label="Porta in primo piano">${ICONS.front}</button>
    <button type="button" class="icon-btn" data-act="back" title="Porta in fondo" aria-label="Porta in fondo">${ICONS.back}</button>
    <button type="button" class="icon-btn" data-act="duplicate" title="Duplica (Ctrl D)" aria-label="Duplica">${ICONS.duplicate}</button>
    <button type="button" class="icon-btn danger" data-act="delete" title="Elimina (Canc)" aria-label="Elimina">${ICONS.trash}</button>
  </div>
  <div class="card zoombar">
    <button type="button" class="icon-btn" data-act="zoom-out" title="Riduci" aria-label="Riduci">${ICONS.minus}</button>
    <button type="button" class="zoom-level" data-act="zoom-reset" title="Torna al 100%">100%</button>
    <button type="button" class="icon-btn" data-act="zoom-in" title="Ingrandisci" aria-label="Ingrandisci">${ICONS.plus}</button>
    <button type="button" class="icon-btn" data-act="fit" title="Inquadra tutto (Maiusc 1)" aria-label="Inquadra tutto">${ICONS.fit}</button>
  </div>
  <dialog class="card help">
    <h2>Scorciatoie</h2>
    <dl>${SHORTCUTS.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    <form method="dialog"><button class="btn">Chiudi</button></form>
  </dialog>
  <input type="file" class="file-input" accept=".json,application/json" hidden />
`

/**
 * Apre la lavagna del token in `root`. `initialData` (facoltativo) è un
 * export da caricare in una lavagna appena creata.
 */
export async function openBoard(root, parsed, user, { initialData = null, goHome } = {}) {
  const page = document.createElement('div')
  page.className = 'board-app'
  page.innerHTML = TEMPLATE
  root.replaceChildren(page)
  const $ = (sel) => page.querySelector(sel)

  const me = { id: user.id, name: user.name }
  const store = createStore(me)
  const sync = connect(store, parsed)

  const titleInput = $('.title-input')
  const contextbar = $('.contextbar')
  const zoomLevel = $('.zoom-level')
  const menu = $('.menu')
  const menuBtn = $('.menu-btn')
  const fileInput = $('.file-input')
  const help = $('.help')

  let board = null
  board = createBoard($('.board-viewport'), store, {
    onToolChange(tool) {
      for (const b of page.querySelectorAll('[data-tool]')) {
        b.classList.toggle('active', b.dataset.tool === tool)
        b.setAttribute('aria-pressed', String(b.dataset.tool === tool))
      }
    },
    onSelectionChange(ids) {
      contextbar.hidden = ids.length === 0
      const sel = board?.getSelection() || []
      const colors = new Set(sel.map((it) => it.color))
      for (const s of contextbar.querySelectorAll('.swatch')) {
        s.classList.toggle('active', colors.size === 1 && colors.has(s.dataset.color))
      }
    },
    onViewChange(view) {
      zoomLevel.textContent = `${Math.round(view.s * 100)}%`
    },
    onPointer(p) {
      sync.setPresence(p ? { x: Math.round(p.x), y: Math.round(p.y) } : { x: null, y: null })
    },
  })

  // ---------- titolo ----------
  const syncTitle = () => {
    const t = store.getTitle()
    if (document.activeElement !== titleInput) titleInput.value = t === DEFAULT_TITLE ? '' : t
    titleInput.placeholder = DEFAULT_TITLE
    document.title = `${t} · Meshboard`
    touchRecent(parsed.token, t)
  }
  titleInput.addEventListener('change', () => store.setTitle(titleInput.value))
  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') titleInput.blur()
  })
  store.meta.observe(syncTitle)

  // ---------- presenza ----------
  const avatars = $('.avatars')
  const statusText = $('.status-text')
  const statusEl = $('.status')
  function renderPeople() {
    const people = new Map([[me.id, me.name]])
    for (const p of sync.peers.values()) if (p.uid && !people.has(p.uid)) people.set(p.uid, p.name)
    const others = people.size - 1
    statusText.textContent = others ? `${people.size} online` : 'Solo tu'
    statusEl.classList.toggle('live', others > 0)
    const frag = document.createDocumentFragment()
    let shown = 0
    for (const [uid, name] of people) {
      if (shown++ >= 5) break
      const a = document.createElement('span')
      a.className = `avatar${uid === me.id ? ' me' : ''}`
      a.style.background = userColor(uid)
      a.textContent = initials(name)
      a.title = uid === me.id ? `${name} (tu)` : name || 'Anonimo'
      frag.append(a)
    }
    if (people.size > 5) {
      const more = document.createElement('span')
      more.className = 'avatar more'
      more.textContent = `+${people.size - 5}`
      frag.append(more)
    }
    avatars.replaceChildren(frag)
  }
  sync.onPeers(renderPeople)
  sync.onPresence((peers) => {
    board.setCursors(peers)
    renderPeople()
  })

  const warned = new Set()
  sync.onError((err) => {
    if (warned.has(err.code)) return
    warned.add(err.code)
    if (err.code === 'relay-failed') {
      toast('Non riesco a raggiungere i relay pubblici per trovare i colleghi. Controlla la connessione.', {
        tone: 'warn',
        timeout: 8000,
      })
    } else if (err.code === 'peer-connect-failed') {
      toast(
        'Connessione diretta con un collega non riuscita: la rete potrebbe bloccare il peer-to-peer (vedi README, TURN).',
        { tone: 'warn', timeout: 10000 },
      )
    }
  })

  // ---------- comandi ----------
  async function share() {
    const url = shareUrl(parsed.token)
    if (await copyText(url)) {
      toast('Link copiato. Chi lo riceve può entrare e modificare la lavagna.')
    } else {
      window.prompt('Copia questo link e mandalo ai colleghi:', url)
    }
  }

  function exportBoard() {
    const data = store.exportData()
    const date = new Date().toISOString().slice(0, 10)
    downloadJson(data, `meshboard-${slug(data.title)}-${date}.json`)
    toast(`Esportati ${data.items.length} elementi.`)
  }

  async function importBoard(file) {
    try {
      const data = await readJsonFile(file)
      store.stopCapturing()
      const ids = store.importData(data)
      store.stopCapturing()
      board.setSelection(ids)
      board.fitTo(ids)
      toast(`Importati ${ids.length} elementi. Ctrl Z per annullare.`)
    } catch (err) {
      toast(err.message || 'Importazione non riuscita.', { tone: 'error' })
    }
  }

  function rename() {
    const name = window.prompt('Il tuo nome', me.name)
    if (name == null || !name.trim()) return
    me.name = setUserName(name).name
    store.registerUser(me.id, me.name)
    sync.setPresence({ name: me.name })
    renderPeople()
    board.render()
  }

  function closeMenu() {
    menu.hidden = true
    menuBtn.setAttribute('aria-expanded', 'false')
  }

  const actions = {
    undo: () => store.undo(),
    redo: () => store.redo(),
    front: () => board.reorderSelection(true),
    back: () => board.reorderSelection(false),
    duplicate: () => board.duplicateSelection(),
    delete: () => board.deleteSelection(),
    'zoom-in': () => board.zoomIn(),
    'zoom-out': () => board.zoomOut(),
    'zoom-reset': () => board.zoomReset(),
    fit: () => board.fitTo(),
    export: exportBoard,
    import: () => fileInput.click(),
    rename,
    help: () => help.showModal(),
    home: () => goHome?.(),
  }

  page.addEventListener('click', (e) => {
    const b = e.target.closest('button')
    if (!b || !page.contains(b) || b.closest('.board-viewport')) return
    if (b.dataset.tool) board.setTool(b.dataset.tool)
    else if (b.dataset.color) board.colorSelection(b.dataset.color)
    else if (b.dataset.act) {
      closeMenu()
      actions[b.dataset.act]?.()
    } else if (b.classList.contains('share')) share()
    else if (b.classList.contains('home-btn')) goHome?.()
    else if (b === menuBtn) {
      menu.hidden = !menu.hidden
      menuBtn.setAttribute('aria-expanded', String(!menu.hidden))
      return
    }
    // il focus resta sulla lavagna, così Spazio e Canc non premono il bottone
    if (!b.closest('dialog')) b.blur()
  })
  const onDocPointer = (e) => {
    if (!menu.hidden && !e.target.closest('.menu-wrap')) closeMenu()
  }
  document.addEventListener('pointerdown', onDocPointer)
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0]
    fileInput.value = ''
    if (file) importBoard(file)
  })

  // ---------- avvio ----------
  await sync.ready
  store.registerUser(me.id, me.name)
  if (initialData) {
    try {
      store.importData(initialData, { keepIds: true })
      store.clearHistory()
      toast('Lavagna creata dal file. Condividi il link per lavorarci insieme.')
    } catch (err) {
      toast(err.message, { tone: 'error' })
    }
  }
  syncTitle()
  renderPeople()
  board.fitTo()

  // se la lavagna era vuota (es. appena entrati da un link) inquadra il
  // contenuto la prima volta che arriva dai colleghi; se il primo elemento
  // lo crea l'utente, la vista resta dov'è
  if (store.items.size === 0) {
    const once = (_event, transaction) => {
      if (store.items.size === 0) return
      store.items.unobserve(once)
      if (!transaction.local) setTimeout(() => board.fitTo(), 50)
    }
    store.items.observe(once)
  }

  return {
    async close() {
      document.removeEventListener('pointerdown', onDocPointer)
      store.meta.unobserve(syncTitle)
      board.destroy()
      await sync.destroy()
      store.doc.destroy()
    },
  }
}
