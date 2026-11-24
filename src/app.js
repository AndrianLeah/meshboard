// Board screen: top bar, tools, menu, import/export.
import { createStore, COLORS, COLOR_KEYS, DEFAULT_TITLE } from './store.js'
import { connect } from './sync.js'
import { createBoard } from './board.js'
import { ICONS } from './icons.js'
import { setUserName, shareUrl, touchRecent, userColor, initials } from './identity.js'
import { toast, readJsonFile, downloadJson, slug, copyText } from './ui.js'
import { canInstall, onInstallChange, promptInstall } from './pwa.js'

const TOOLS = [
  ['select', 'Select', 'V'],
  ['hand', 'Pan', 'H'],
  ['note', 'Sticky note', 'N'],
  ['rect', 'Rectangle', 'R'],
  ['ellipse', 'Ellipse', 'O'],
  ['text', 'Text', 'T'],
  ['arrow', 'Arrow', 'A'],
]

const COLOR_NAMES = {
  yellow: 'Yellow',
  orange: 'Orange',
  red: 'Red',
  pink: 'Pink',
  purple: 'Purple',
  blue: 'Blue',
  green: 'Green',
  gray: 'Gray',
}

const SHORTCUTS = [
  ['V / H', 'Select / pan'],
  ['N R O T A', 'Sticky note, rectangle, ellipse, text, arrow'],
  ['Double-click', 'New sticky note, or edit text'],
  ['Enter / Esc', 'Edit text / stop editing'],
  ['Space + drag', 'Pan'],
  ['Wheel · Ctrl + wheel', 'Scroll · zoom'],
  ['Shift + click', 'Add to selection'],
  ['Delete', 'Delete selection'],
  ['Ctrl D', 'Duplicate'],
  ['Ctrl Z / Ctrl Shift Z', 'Undo / redo'],
  ['Arrow keys', 'Nudge 1 px (Shift: 10 px)'],
  ['Shift 1', 'Zoom to fit'],
]

const TEMPLATE = `
  <div class="board-viewport"></div>
  <header class="topbar">
    <div class="card brand-block">
      <button type="button" class="icon-btn home-btn" title="All boards" aria-label="All boards">${ICONS.logo}</button>
      <input class="title-input" maxlength="80" aria-label="Board title" />
    </div>
    <div class="card right-block">
      <span class="status" title="People connected"><i class="dot"></i><span class="status-text">Just you</span></span>
      <div class="avatars"></div>
      <button type="button" class="btn primary share">${ICONS.link}<span>Share</span></button>
      <div class="menu-wrap">
        <button type="button" class="icon-btn menu-btn" aria-haspopup="menu" aria-expanded="false" aria-label="More">${ICONS.more}</button>
        <div class="menu card" role="menu" hidden>
          <button type="button" role="menuitem" data-act="export">${ICONS.download}Export board (.json)</button>
          <button type="button" role="menuitem" data-act="import">${ICONS.upload}Import from file…</button>
          <hr />
          <button type="button" role="menuitem" data-act="rename">${ICONS.user}Change your name</button>
          <button type="button" role="menuitem" data-act="help">${ICONS.keyboard}Keyboard shortcuts</button>
          <button type="button" role="menuitem" data-act="install" hidden>${ICONS.install}Install as app</button>
          <hr />
          <button type="button" role="menuitem" data-act="home">${ICONS.home}All boards</button>
        </div>
      </div>
    </div>
  </header>
  <nav class="card toolbar" aria-label="Tools">
    ${TOOLS.map(
      ([id, label, key]) =>
        `<button type="button" class="icon-btn tool" data-tool="${id}" title="${label} (${key})" aria-label="${label}">${ICONS[id]}</button>`,
    ).join('')}
    <hr />
    <button type="button" class="icon-btn" data-act="undo" title="Undo (Ctrl Z)" aria-label="Undo">${ICONS.undo}</button>
    <button type="button" class="icon-btn" data-act="redo" title="Redo (Ctrl Shift Z)" aria-label="Redo">${ICONS.redo}</button>
  </nav>
  <div class="card contextbar" hidden>
    <div class="swatches">
      ${COLOR_KEYS.map(
        (k) =>
          `<button type="button" class="swatch" data-color="${k}" style="--fill:${COLORS[k].fill};--stroke:${COLORS[k].stroke}" title="${COLOR_NAMES[k]}" aria-label="${COLOR_NAMES[k]}"></button>`,
      ).join('')}
    </div>
    <hr />
    <button type="button" class="icon-btn" data-act="front" title="Bring to front" aria-label="Bring to front">${ICONS.front}</button>
    <button type="button" class="icon-btn" data-act="back" title="Send to back" aria-label="Send to back">${ICONS.back}</button>
    <button type="button" class="icon-btn" data-act="duplicate" title="Duplicate (Ctrl D)" aria-label="Duplicate">${ICONS.duplicate}</button>
    <button type="button" class="icon-btn danger" data-act="delete" title="Delete (Del)" aria-label="Delete">${ICONS.trash}</button>
  </div>
  <div class="card zoombar">
    <button type="button" class="icon-btn" data-act="zoom-out" title="Zoom out" aria-label="Zoom out">${ICONS.minus}</button>
    <button type="button" class="zoom-level" data-act="zoom-reset" title="Reset to 100%">100%</button>
    <button type="button" class="icon-btn" data-act="zoom-in" title="Zoom in" aria-label="Zoom in">${ICONS.plus}</button>
    <button type="button" class="icon-btn" data-act="fit" title="Zoom to fit (Shift 1)" aria-label="Zoom to fit">${ICONS.fit}</button>
  </div>
  <dialog class="card help">
    <h2>Keyboard shortcuts</h2>
    <dl>${SHORTCUTS.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    <form method="dialog"><button class="btn">Close</button></form>
  </dialog>
  <input type="file" class="file-input" accept=".json,application/json" hidden />
`

/**
 * Opens the board for `parsed` (the invite token) inside `root`.
 * `initialData` (optional) is an export to load into a freshly created board.
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

  // ---------- title ----------
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

  // ---------- presence ----------
  const avatars = $('.avatars')
  const statusText = $('.status-text')
  const statusEl = $('.status')
  function renderPeople() {
    const people = new Map([[me.id, me.name]])
    for (const p of sync.peers.values()) if (p.uid && !people.has(p.uid)) people.set(p.uid, p.name)
    const others = people.size - 1
    statusText.textContent = others ? `${people.size} online` : 'Just you'
    statusEl.classList.toggle('live', others > 0)
    const frag = document.createDocumentFragment()
    let shown = 0
    for (const [uid, name] of people) {
      if (shown++ >= 5) break
      const a = document.createElement('span')
      a.className = `avatar${uid === me.id ? ' me' : ''}`
      a.style.background = userColor(uid)
      a.textContent = initials(name)
      a.title = uid === me.id ? `${name} (you)` : name || 'Anonymous'
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
      toast("Can't reach the public relays used to find your teammates. Check your connection.", {
        tone: 'warn',
        timeout: 8000,
      })
    } else if (err.code === 'peer-connect-failed') {
      toast(
        "Couldn't connect directly to a teammate: your network may block peer-to-peer (see the README, TURN).",
        { tone: 'warn', timeout: 10000 },
      )
    }
  })

  // ---------- commands ----------
  async function share() {
    const url = shareUrl(parsed.token)
    if (await copyText(url)) {
      toast('Link copied. Anyone who has it can join and edit this board.')
    } else {
      window.prompt('Copy this link and send it to your teammates:', url)
    }
  }

  function exportBoard() {
    const data = store.exportData()
    const date = new Date().toISOString().slice(0, 10)
    downloadJson(data, `meshboard-${slug(data.title)}-${date}.json`)
    toast(`Exported ${data.items.length} items.`)
  }

  async function importBoard(file) {
    try {
      const data = await readJsonFile(file)
      store.stopCapturing()
      const ids = store.importData(data)
      store.stopCapturing()
      board.setSelection(ids)
      board.fitTo(ids)
      toast(`Imported ${ids.length} items. Ctrl Z to undo.`)
    } catch (err) {
      toast(err.message || 'Import failed.', { tone: 'error' })
    }
  }

  function rename() {
    const name = window.prompt('Your name', me.name)
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
    install: () => promptInstall(),
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
    // keep focus on the board, so Space and Delete don't press the button again
    if (!b.closest('dialog')) b.blur()
  })
  const onDocPointer = (e) => {
    if (!menu.hidden && !e.target.closest('.menu-wrap')) closeMenu()
  }
  document.addEventListener('pointerdown', onDocPointer)
  const installItem = $('[data-act="install"]')
  const syncInstall = (can) => (installItem.hidden = !can)
  syncInstall(canInstall())
  const offInstall = onInstallChange(syncInstall)
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0]
    fileInput.value = ''
    if (file) importBoard(file)
  })

  // ---------- startup ----------
  await sync.ready
  store.registerUser(me.id, me.name)
  if (initialData) {
    try {
      store.importData(initialData, { keepIds: true })
      store.clearHistory()
      toast('Board created from file. Share the link to work on it together.')
    } catch (err) {
      toast(err.message, { tone: 'error' })
    }
  }
  syncTitle()
  renderPeople()
  board.fitTo()

  // If the board was empty (e.g. just joined from a link), fit the view the first
  // time content arrives from teammates. If the user creates the first item, the
  // view stays where it is.
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
      offInstall()
      store.meta.unobserve(syncTitle)
      board.destroy()
      await sync.destroy()
      store.doc.destroy()
    },
  }
}
