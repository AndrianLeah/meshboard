// The board screen: the canvas plus its chrome (top bars, tools, history, zoom, context bar),
// the commands behind every button and key, clipboard, files and presence.
import { h, toast, promptText, closePopover } from '../ui/ds/index.js'
import { createStore } from '../core/store.js'
import { exportBoard, importBoard } from '../core/transfer.js'
import { encodeClipboard } from '../core/clipboard.js'
import { connect } from '../sync/index.js'
import { createBoard } from '../board/board.js'
import { createCommands, bindKeyboard } from '../commands/registry.js'
import { createToolbar } from '../ui/toolbar.js'
import { openShapesFlyout } from '../ui/flyouts.js'
import { createHistory } from '../ui/history.js'
import { createZoomControls } from '../ui/zoom-controls.js'
import { createTopbar } from '../ui/topbar.js'
import { createContextBar } from '../ui/context-bar.js'
import { openContextMenu } from '../ui/context-menu.js'
import { openShortcutsDialog } from '../ui/shortcuts-dialog.js'
import { openEmojiPicker } from '../ui/emoji-picker/emoji-picker.js'
import { setUserName, shareUrl, touchRecent } from '../core/identity.js'
import { readJsonFile, downloadJson, slug, copyText } from '../lib/files.js'
import { canInstall, promptInstall } from '../app/pwa.js'

const phone = window.matchMedia('(max-width: 640px)')
const isTyping = (t) => t?.closest?.('input, textarea, select, [contenteditable]')

/**
 * Opens the board of `token` inside `root`. `initialData` (optional) is an export to load into a
 * freshly created board. Returns {close}.
 */
export async function openBoard(root, token, user, { initialData = null, goHome } = {}) {
  const me = { id: user.id, name: user.name }
  const store = createStore(me)
  const sync = connect(store, token)

  const canvas = h('div', { class: 'board-page__canvas' })
  const page = h('div', { class: 'board-page' }, canvas)
  root.replaceChildren(page)

  let busy = false
  let chrome = null // the UI pieces, once built
  let memory = null // the last copied items, for when the system clipboard can't be read

  const board = createBoard(canvas, store, {
    onSelectionChange: (items) => chrome?.contextBar.update({ items, busy }),
    onToolChange: (tool) => chrome?.toolbar.update(tool),
    onViewChange(view) {
      chrome?.zoom.update(view)
      chrome?.contextBar.place()
    },
    onBusyChange(on) {
      busy = on
      chrome?.contextBar.update({ busy })
    },
    onPointer: (p) => sync.presence.set(p ? { x: Math.round(p.x), y: Math.round(p.y) } : { x: null, y: null }),
    onContextMenu: (point) => openContextMenu(point, { commands, board }),
    onAddReaction: (id, anchor) => openReactionPicker(id, anchor),
  })

  // ---------- page actions ----------

  function openReactionPicker(id, anchor) {
    const node = board.nodeOf(id)
    const at = anchor || node?.querySelector('[data-add-reaction]') || node
    if (!at) return
    openEmojiPicker(at, {
      onPick(emoji) {
        // picking an emoji you already used leaves it in place
        if (!store.get(id)?.reactions?.[emoji]?.[me.id]) board.toggleReaction(id, emoji)
      },
    })
  }

  async function copy() {
    const items = board.copySelection()
    if (!items.length) return
    memory = items
    const { text, html } = encodeClipboard(items)
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ])
    } catch {
      await copyText(text)
    }
  }

  async function paste() {
    try {
      const [entry] = await navigator.clipboard.read()
      const read = async (type) => (entry.types.includes(type) ? (await entry.getType(type)).text() : '')
      if (board.paste({ html: await read('text/html'), text: await read('text/plain') })) return
    } catch {
      /* no permission: fall back to what was copied here */
    }
    if (memory) board.paste({ items: memory })
  }

  async function share() {
    const url = shareUrl(token.token)
    if (await copyText(url)) toast('Link copied. Anyone who has it can join and edit this board.')
    else window.prompt('Copy this link and send it to your teammates:', url)
  }

  function exportFile() {
    const data = exportBoard(store)
    downloadJson(data, `meshboard-${slug(data.title)}-${new Date().toISOString().slice(0, 10)}.json`)
    toast(`Exported ${data.items.length} items.`)
  }

  function importFile() {
    const picker = h('input', { type: 'file', accept: '.json,application/json', hidden: true })
    picker.addEventListener('change', async () => {
      const file = picker.files?.[0]
      picker.remove()
      if (!file) return
      try {
        const ids = importBoard(store, await readJsonFile(file))
        board.renderNow()
        board.select(ids)
        board.fitSelection()
        toast(`Imported ${ids.length} items. ${commands.shortcut('undo')} to undo.`)
      } catch (err) {
        toast(err.message || 'Import failed.', { tone: 'danger' })
      }
    })
    page.append(picker)
    picker.click()
  }

  async function rename() {
    const name = await promptText({ title: 'Your name', label: 'How teammates see you', value: me.name, maxlength: 40 })
    if (!name) return
    me.name = setUserName(name).name
    store.registerUser(me.id, me.name)
    sync.presence.set({ name: me.name })
    renderPeople()
    board.render()
  }

  const commands = createCommands({
    board,
    store,
    ui: {
      openShapes: () => openShapesFlyout(chrome.toolbar.shapesButton, { commands, placement: phone.matches ? 'top' : 'right' }),
      openReactionPicker: (id) => openReactionPicker(id),
      openShortcuts: openShortcutsDialog,
      copy,
      cut: async () => {
        await copy()
        board.deleteSelection()
      },
      paste,
      share,
      exportBoard: exportFile,
      importBoard: importFile,
      rename,
      install: promptInstall,
      canInstall,
      goHome: () => goHome?.(),
    },
  })

  // ---------- chrome ----------

  const placement = phone.matches ? 'top' : 'right'
  chrome = {
    topbar: createTopbar({ commands, store, onTitle: (t) => store.setTitle(t) }),
    toolbar: createToolbar({ commands, placement, compact: phone.matches }),
    history: createHistory({ commands, store, placement }),
    zoom: createZoomControls({ commands, board }),
    contextBar: createContextBar({ commands, board, topInset: () => chrome.topbar.root.getBoundingClientRect().bottom }),
  }
  page.append(chrome.topbar.root, chrome.toolbar.root, chrome.history.root, chrome.zoom.root, chrome.contextBar.root)
  chrome.toolbar.update(board.tool)
  chrome.zoom.update({ s: board.view.scale })

  // ---------- clipboard events (⌘C, ⌘X, ⌘V) ----------

  function onCopy(e, cut = false) {
    if (isTyping(document.activeElement) || !board.selection().length) return
    const items = board.copySelection()
    const { text, html } = encodeClipboard(items)
    e.clipboardData.setData('text/plain', text)
    e.clipboardData.setData('text/html', html)
    e.preventDefault()
    memory = items
    if (cut) board.deleteSelection()
  }
  const onCut = (e) => onCopy(e, true)
  function onPaste(e) {
    if (isTyping(document.activeElement)) return
    e.preventDefault()
    const html = e.clipboardData.getData('text/html')
    const text = e.clipboardData.getData('text/plain')
    if (!board.paste({ html, text }) && memory) board.paste({ items: memory })
  }
  document.addEventListener('copy', onCopy)
  document.addEventListener('cut', onCut)
  document.addEventListener('paste', onPaste)
  const unbindKeys = bindKeyboard(commands)
  const offHistory = store.onHistoryChange(() => chrome.history.update())

  // ---------- title and people ----------

  function syncTitle() {
    const t = store.getTitle()
    chrome.topbar.setTitle(t)
    document.title = `${t} · Meshboard`
    touchRecent(token.token, t)
  }
  store.meta.observe(syncTitle)

  function renderPeople() {
    const people = new Map([[me.id, me.name]])
    for (const p of sync.presence.peers.values()) if (p.uid && !people.has(p.uid)) people.set(p.uid, p.name)
    chrome.topbar.setPeople(people, me.id)
  }
  const offPeers = sync.presence.onPeers(renderPeople)
  const offMove = sync.presence.onMove((peers) => board.setCursors(peers))

  const warned = new Set()
  const offError = sync.onError((err) => {
    if (warned.has(err.code)) return
    warned.add(err.code)
    if (err.code === 'relay-failed') {
      toast("Can't reach the public relays used to find your teammates. Check your connection.", { tone: 'danger', timeout: 8000 })
    } else if (err.code === 'peer-connect-failed') {
      toast("Couldn't connect directly to a teammate: your network may block peer-to-peer (see the README, TURN).", {
        tone: 'danger',
        timeout: 10000,
      })
    }
  })

  // ---------- startup ----------

  await sync.ready
  store.migrate()
  store.registerUser(me.id, me.name)
  if (initialData) {
    try {
      importBoard(store, initialData, { asNewBoard: true })
      store.clearHistory()
      toast('Board created from file. Share the link to work on it together.')
    } catch (err) {
      toast(err.message, { tone: 'danger' })
    }
  }
  syncTitle()
  renderPeople()
  board.fitAll()
  chrome.history.update()

  // A board that's still empty (just joined from a link) fits the view when the first content
  // arrives from teammates; if you draw the first item yourself the view stays put.
  if (store.items.size === 0) {
    const once = (_event, transaction) => {
      if (store.items.size === 0) return
      store.items.unobserve(once)
      if (!transaction.local) setTimeout(() => board.fitAll(), 50)
    }
    store.items.observe(once)
  }

  return {
    async close() {
      closePopover()
      unbindKeys()
      offHistory()
      offPeers()
      offMove()
      offError()
      chrome.history.destroy()
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('cut', onCut)
      document.removeEventListener('paste', onPaste)
      store.meta.unobserve(syncTitle)
      board.destroy()
      await sync.destroy()
      store.doc.destroy()
    },
  }
}
