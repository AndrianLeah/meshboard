// The board screen: the canvas plus its chrome (top bars, tools, history, zoom, context bar),
// the commands behind every button and key, clipboard, files and presence.
import { h, toast, promptText, closePopover } from '../ui/ds/index.ts'
import { createStore } from '../core/store.ts'
import { exportBoard, importBoard } from '../core/transfer.ts'
import { encodeClipboard } from '../core/clipboard.ts'
import { connect } from '../sync/index.ts'
import { createBoard } from '../board/board.ts'
import { createCommands, bindKeyboard } from '../commands/registry.ts'
import { createToolbar } from '../ui/toolbar.ts'
import { openShapesFlyout } from '../ui/flyouts.ts'
import { createHistory } from '../ui/history.ts'
import { createZoomControls } from '../ui/zoom-controls.ts'
import { createTopbar } from '../ui/topbar.ts'
import { createContextBar } from '../ui/context-bar.ts'
import { openContextMenu } from '../ui/context-menu.ts'
import { openShortcutsDialog } from '../ui/shortcuts-dialog.ts'
import { openEmojiPicker } from '../ui/emoji-picker/emoji-picker.ts'
import { setUserName, shareUrl, touchRecent } from '../core/identity.ts'
import { readJsonFile, downloadJson, slug, copyText, errorMessage } from '../lib/files.ts'
import { canInstall, promptInstall } from '../app/pwa.ts'
import type * as Y from 'yjs'
import type { BoardExport, BoardToken, Item, User } from '../core/types.ts'

const phone = window.matchMedia('(max-width: 640px)')
const isTyping = (t: Element | null) => Boolean(t?.closest('input, textarea, select, [contenteditable]'))

/** The chrome around the canvas. */
interface Chrome {
  topbar: ReturnType<typeof createTopbar>
  toolbar: ReturnType<typeof createToolbar>
  history: ReturnType<typeof createHistory>
  zoom: ReturnType<typeof createZoomControls>
  contextBar: ReturnType<typeof createContextBar>
}

export interface OpenBoardOptions {
  /** an export to load into a freshly created board */
  initialData?: BoardExport | null
  goHome?: () => void
}

/** Opens the board of `token` inside `root`. */
export async function openBoard(
  root: HTMLElement,
  token: BoardToken,
  user: User,
  { initialData = null, goHome }: OpenBoardOptions = {},
): Promise<{ close: () => Promise<void> }> {
  const me = { id: user.id, name: user.name }
  const store = createStore(me)
  const sync = connect(store, token)

  const canvas = h('div', { class: 'board-page__canvas' })
  const page = h('div', { class: 'board-page' }, canvas)
  root.replaceChildren(page)

  let busy = false
  let built: Chrome | null = null // the board talks to the chrome once it exists
  let memory: Item[] | null = null // the last copied items, for when the system clipboard can't be read

  const board = createBoard(canvas, store, {
    onSelectionChange: (items) => built?.contextBar.update({ items, busy }),
    onToolChange: (tool) => built?.toolbar.update(tool),
    onViewChange(view) {
      built?.zoom.update(view)
      built?.contextBar.place()
    },
    onBusyChange(on) {
      busy = on
      built?.contextBar.update({ busy })
    },
    onPointer: (p) => sync.presence.set(p ? { x: Math.round(p.x), y: Math.round(p.y) } : { x: null, y: null }),
    onContextMenu: (point) => openContextMenu(point, { commands, board }),
    onAddReaction: (id, anchor) => openReactionPicker(id, anchor),
  })

  // ---------- page actions ----------

  function openReactionPicker(id: string, anchor?: Element) {
    const node = board.nodeOf(id)
    const at = anchor || node?.querySelector('[data-add-reaction]') || node
    if (!at) return
    openEmojiPicker(at, {
      onPick(emoji) {
        // picking an emoji you already used leaves it in place
        const it = store.get(id)
        if (it?.type === 'note' && !it.reactions[emoji]?.[me.id]) board.toggleReaction(id, emoji)
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
      const read = async (type: string) => (entry.types.includes(type) ? (await entry.getType(type)).text() : '')
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
    downloadJson(data, `meshboard-${slug(data.title ?? '')}-${new Date().toISOString().slice(0, 10)}.json`)
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
        toast(errorMessage(err, 'Import failed.'), { tone: 'danger' })
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
      openShapes: () =>
        void openShapesFlyout(chrome.toolbar.shapesButton, { commands, placement: phone.matches ? 'top' : 'right' }),
      openReactionPicker: (id) => openReactionPicker(id),
      openShortcuts: () => void openShortcutsDialog(),
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
      install: () => void promptInstall(),
      canInstall,
      goHome: () => goHome?.(),
    },
  })

  // ---------- chrome ----------

  const placement = phone.matches ? 'top' : 'right'
  const chrome: Chrome = {
    topbar: createTopbar({ commands, onTitle: (t) => store.setTitle(t) }),
    toolbar: createToolbar({ commands, placement, compact: phone.matches }),
    history: createHistory({ commands, store, placement }),
    zoom: createZoomControls({ commands, board }),
    contextBar: createContextBar({
      commands,
      board,
      topInset: () => chrome.topbar.root.getBoundingClientRect().bottom,
    }),
  }
  built = chrome
  page.append(chrome.topbar.root, chrome.toolbar.root, chrome.history.root, chrome.zoom.root, chrome.contextBar.root)
  chrome.toolbar.update(board.tool)
  chrome.zoom.update({ s: board.view.scale })

  // ---------- clipboard events (⌘C, ⌘X, ⌘V) ----------

  function onCopy(e: ClipboardEvent, cut = false) {
    if (isTyping(document.activeElement) || !board.selection().length || !e.clipboardData) return
    const items = board.copySelection()
    const { text, html } = encodeClipboard(items)
    e.clipboardData.setData('text/plain', text)
    e.clipboardData.setData('text/html', html)
    e.preventDefault()
    memory = items
    if (cut) board.deleteSelection()
  }
  const onCut = (e: ClipboardEvent) => onCopy(e, true)
  function onPaste(e: ClipboardEvent) {
    if (isTyping(document.activeElement) || !e.clipboardData) return
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

  const warned = new Set<string>()
  const offError = sync.onError((err) => {
    if (warned.has(err.code)) return
    warned.add(err.code)
    if (err.code === 'relay-failed') {
      toast("Can't reach the public relays used to find your teammates. Check your connection.", {
        tone: 'danger',
        timeout: 8000,
      })
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
      toast(errorMessage(err), { tone: 'danger' })
    }
  }
  syncTitle()
  renderPeople()
  board.fitAll()
  chrome.history.update()

  // A board that's still empty (just joined from a link) fits the view when the first content
  // arrives from teammates; if you draw the first item yourself the view stays put.
  if (store.items.size === 0) {
    const once = (_event: unknown, transaction: Y.Transaction) => {
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
