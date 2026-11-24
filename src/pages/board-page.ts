// The board screen: the canvas plus its chrome (top bars, tools, history, zoom, context bar),
// the commands behind every button and key, clipboard, files and presence.
import { h, toast, promptText, closePopover } from '../ui/ds/index.ts'
import { createStore } from '../core/store.ts'
import { exportBoard, importBoard } from '../core/transfer.ts'
import { encodeClipboard } from '../core/clipboard.ts'
import { connect } from '../sync/index.ts'
import { connectServer } from '../sync/server.ts'
import type { ServerStatus } from '../sync/server.ts'
import { openShareDialog } from '../ui/share-dialog.ts'
import type { BoardSummary } from '../hosted/api.ts'
import { turnServers } from '../sync/ice.ts'
import { joinState, SEARCH_MS } from '../sync/status.ts'
import type { JoinFacts } from '../sync/status.ts'
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
import { createJoinNotice } from '../ui/join-notice.ts'
import { setUserName, shareUrl, touchRecent } from '../core/identity.ts'
import { readJsonFile, downloadJson, slug, copyText, errorMessage } from '../lib/files.ts'
import { canInstall, promptInstall } from '../app/pwa.ts'
import { measureImage, uploadImage } from '../app/images.ts'
import { NO_UPLOADS, UPLOAD_TYPES, fitImage, imageUrls, isAllowedImage } from '../core/images.ts'
import type { ImageSettings, UploadedImage } from '../core/images.ts'
import { imageSrc } from '../core/schema.ts'
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

/** A board on a self-hosted server. */
export interface HostedBoard {
  board: BoardSummary
  /** the WebSocket address of the server's /sync */
  wsUrl: string
  /** shown as "Everyone at …" in the share dialog */
  orgName: string
  /** the viewer's groups, to share with one of them */
  groups: readonly string[]
  /** AUTH=none: changes the name you signed in with */
  renameSelf?: (name: string) => Promise<void>
  /** the session ended while the board was open */
  onSignedOut?: () => void
  /** asks the server whether the session is still valid */
  checkSession?: () => Promise<boolean>
}

export type BoardTarget = { token: BoardToken } | { hosted: HostedBoard }

export interface OpenBoardOptions {
  /** an export to load into a freshly created board */
  initialData?: BoardExport | null
  /** created here just now: nobody else has it yet */
  isNew?: boolean
  goHome?: () => void
  /** where pictures may come from, and where files are uploaded */
  images?: ImageSettings
}

/** Opens a board inside `root`: peer to peer from its token, or from a self-hosted server. */
export async function openBoard(
  root: HTMLElement,
  target: BoardTarget,
  user: User,
  { initialData = null, isNew = false, goHome, images = NO_UPLOADS }: OpenBoardOptions = {},
): Promise<{ close: () => Promise<void> }> {
  const me = { id: user.id, name: user.name }
  const store = createStore(me)
  const hosted = 'hosted' in target ? target.hosted : null
  const token = 'token' in target ? target.token : null
  const serverSync = hosted ? connectServer(store, hosted.board.id, { url: hosted.wsUrl }) : null
  const sync = serverSync ?? connect(store, token!, { turnConfig: await turnServers() })
  /** viewers can look, not change */
  const readOnly = hosted?.board.role === 'viewer'

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
    canShowImage: (src) => isAllowedImage(src, images),
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

  // ---------- images: addresses on the board, files through the upload endpoint ----------

  /** Puts pictures side by side around `at`, each at its own proportions. */
  async function addImages(list: readonly UploadedImage[], at = board.pastePoint()) {
    const shown = list.filter((img) => isAllowedImage(img.src, images))
    if (shown.length < list.length)
      toast(
        images.origins.length
          ? `Images can only come from ${images.origins.map((o) => new URL(o).host).join(', ')}.`
          : 'Images need an https address.',
        { tone: 'danger' },
      )
    if (!shown.length) return
    const sized = await Promise.all(
      shown.map(async (img) => {
        const size = img.w && img.h ? img : await measureImage(img.src)
        return { src: img.src, ...fitImage(size.w, size.h) }
      }),
    )
    const gap = 24
    const total = sized.reduce((sum, s) => sum + s.w, 0) + gap * (sized.length - 1)
    let x = at.x - total / 2
    store.stopCapturing()
    const ids = sized.map((s) => {
      const id = store.create({
        type: 'image',
        x: Math.round(x),
        y: Math.round(at.y - s.h / 2),
        w: s.w,
        h: s.h,
        src: s.src,
        alt: '',
      })
      x += s.w + gap
      return id
    })
    store.stopCapturing()
    board.renderNow()
    board.select(ids)
  }

  /** Sends files to the upload endpoint, then puts what it answered on the board. */
  async function uploadFiles(files: readonly File[], at = board.pastePoint()) {
    if (readOnly) return
    if (!images.upload) {
      toast("Images can't be uploaded here: paste an image's https address instead.", { tone: 'danger' })
      return
    }
    const upload = images.upload
    const pictures = files.filter((f) => UPLOAD_TYPES.includes(f.type)).slice(0, 10)
    if (!pictures.length) {
      toast('Only PNG, JPEG, GIF, WebP and AVIF images can be added.', { tone: 'danger' })
      return
    }
    toast(pictures.length > 1 ? `Uploading ${pictures.length} images…` : 'Uploading the image…')
    const results = await Promise.allSettled(pictures.map((f) => uploadImage(f, upload)))
    const done = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (failed) toast(errorMessage(failed.reason), { tone: 'danger', timeout: 8000 })
    if (done.length) await addImages(done, at)
  }

  /** Pasted or dropped text: image addresses become images. True when it was handled here. */
  function imagesFromText(text: string, at?: { x: number; y: number }): boolean {
    const urls = imageUrls(text)
    if (!urls || readOnly) return false
    void addImages(
      urls.map((src) => ({ src })),
      at,
    )
    return true
  }

  async function insertImage() {
    if (images.upload) {
      const picker = h('input', { type: 'file', accept: UPLOAD_TYPES.join(','), multiple: true, hidden: true })
      picker.addEventListener('change', () => {
        const files = [...(picker.files ?? [])]
        picker.remove()
        if (files.length) void uploadFiles(files)
      })
      page.append(picker)
      picker.click()
      return
    }
    const address = await promptText({
      title: 'Add an image',
      label: 'Image address (https)',
      confirm: 'Add',
      maxlength: 2048,
    })
    if (!address) return
    const src = imageSrc(address)
    if (!src) return toast('That isn’t an https address.', { tone: 'danger' })
    await addImages([{ src }])
  }

  async function paste() {
    try {
      const [entry] = await navigator.clipboard.read()
      const picture = entry.types.find((t) => UPLOAD_TYPES.includes(t))
      if (picture && !readOnly) {
        const blob = await entry.getType(picture)
        return void uploadFiles([new File([blob], 'pasted-image', { type: picture })])
      }
      const read = async (type: string) => (entry.types.includes(type) ? (await entry.getType(type)).text() : '')
      const text = await read('text/plain')
      if (imagesFromText(text)) return
      if (board.paste({ html: await read('text/html'), text })) return
    } catch {
      /* no permission: fall back to what was copied here */
    }
    if (memory) board.paste({ items: memory })
  }

  async function share() {
    if (hosted) {
      openShareDialog(hosted.board, { orgName: hosted.orgName, groups: hosted.groups, meId: me.id })
      return
    }
    const url = shareUrl(token!.token)
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
    if (hosted && !hosted.renameSelf) {
      toast('Your name comes from how you signed in.')
      return
    }
    const name = await promptText({ title: 'Your name', label: 'How teammates see you', value: me.name, maxlength: 40 })
    if (!name) return
    if (hosted?.renameSelf) {
      try {
        await hosted.renameSelf(name)
      } catch (err) {
        toast(errorMessage(err), { tone: 'danger' })
        return
      }
      me.name = name
    } else me.name = setUserName(name).name
    store.registerUser(me.id, me.name)
    sync.presence.set({ name: me.name })
    renderPeople()
    board.render()
  }

  const commands = createCommands({
    board,
    store,
    readOnly: () => readOnly,
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
      insertImage: () => void insertImage(),
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
  if (readOnly) {
    board.setReadOnly(true)
    chrome.topbar.setReadOnly(true)
    page.append(chrome.topbar.root, chrome.zoom.root)
  } else
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
    if (readOnly) return
    const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
    if (files.length) return void uploadFiles(files)
    const html = e.clipboardData.getData('text/html')
    const text = e.clipboardData.getData('text/plain')
    if (imagesFromText(text)) return
    if (!board.paste({ html, text }) && memory) board.paste({ items: memory })
  }
  document.addEventListener('copy', onCopy)
  document.addEventListener('cut', onCut)
  document.addEventListener('paste', onPaste)

  // dropping pictures (files, or an image dragged from another page) where they should go
  const dropKinds = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])]
  function onDragOver(e: DragEvent) {
    const kinds = dropKinds(e)
    if (readOnly || !(kinds.includes('Files') || kinds.includes('text/uri-list'))) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  }
  function onDrop(e: DragEvent) {
    if (readOnly || !e.dataTransfer) return
    e.preventDefault()
    const at = board.view.toWorld(e.clientX, e.clientY)
    const files = [...e.dataTransfer.files]
    if (files.length) return void uploadFiles(files, at)
    const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')
    if (
      !imagesFromText(
        text
          .split(/\r?\n/)
          .filter((l) => !l.startsWith('#'))
          .join('\n'),
        at,
      )
    )
      toast('Only pictures can be dropped on the board.', { tone: 'danger' })
  }
  canvas.addEventListener('dragover', onDragOver)
  canvas.addEventListener('drop', onDrop)
  const unbindKeys = bindKeyboard(commands)
  const offHistory = store.onHistoryChange(() => chrome.history.update())

  // ---------- title and people ----------

  function syncTitle() {
    const t = store.getTitle()
    chrome.topbar.setTitle(t)
    document.title = `${t} · Meshboard`
    if (token) touchRecent(token.token, t)
  }
  store.meta.observe(syncTitle)

  function renderPeople() {
    const people = new Map([[me.id, me.name]])
    for (const p of sync.presence.peers.values()) if (p.uid && !people.has(p.uid)) people.set(p.uid, p.name)
    chrome.topbar.setPeople(people, me.id)
  }
  const offPeers = sync.presence.onPeers(renderPeople)
  const offMove = sync.presence.onMove((peers) => board.setCursors(peers))

  // ---------- joining: the note on an empty board, warnings on a full one ----------

  const notice = createJoinNotice()
  page.append(notice.root)
  const facts: JoinFacts = { peers: 0, connectFailed: false, relaysFailed: false, waited: false }
  // until the local copy is loaded nothing is known; once a teammate connects or content shows up, the note is done
  let joining: 'loading' | 'open' | 'done' = 'loading'
  function updateJoin() {
    // a self-hosted board's content comes from the server: its notes are about the connection
    if (hosted || joining === 'loading') return
    const state = joinState({ ...facts, peers: sync.peerCount() })
    if (joining === 'open' && (state === 'connected' || store.items.size > 0)) joining = 'done'
    notice.set(joining === 'open' ? state : null)
  }
  const waitTimer = setTimeout(() => {
    facts.waited = true
    updateJoin()
  }, SEARCH_MS)
  const offJoinPeers = sync.presence.onPeers(updateJoin)

  // ---------- a self-hosted board: connection status and access ----------

  let offStatus = () => {}
  let sessionTimer: ReturnType<typeof setTimeout> | undefined
  if (serverSync && hosted) {
    let wasOffline = false
    const showStatus = (status: ServerStatus) => {
      if (status === 'connected') {
        if (wasOffline) toast('Back online. Your changes are synced.')
        wasOffline = false
        clearTimeout(sessionTimer)
        if (notice.root.dataset.state !== 'forbidden') notice.set(null)
        return
      }
      if (status === 'offline' && !wasOffline) {
        wasOffline = true
        // a refused connection may mean the session ended: ask once it has failed for a while
        clearTimeout(sessionTimer)
        sessionTimer = setTimeout(async () => {
          if (serverSync.status() === 'connected' || !hosted.checkSession) return
          if (!(await hosted.checkSession())) hosted.onSignedOut?.()
          else if (store.items.size) toast("You're offline. Changes are kept here and sent when you're back.")
        }, 3000)
      }
      if (!store.items.size) notice.set(status === 'offline' ? 'server-offline' : 'server-connecting')
    }
    offStatus = serverSync.onStatus(showStatus)
    showStatus(serverSync.status())
  }

  const warned = new Set<string>()
  const offError = sync.onError((err) => {
    if (hosted) {
      // the server refused this board: access was removed, or it went to the trash
      notice.set('forbidden')
      return
    }
    if (err.code === 'relay-failed') facts.relaysFailed = true
    else if (err.code === 'peer-connect-failed') facts.connectFailed = true
    else return
    updateJoin()
    if (joining === 'open' || warned.has(err.code)) return
    warned.add(err.code)
    toast(
      err.code === 'relay-failed'
        ? "Can't reach the relays that introduce teammates. Check your connection."
        : "Couldn't connect to a teammate: your networks won't connect to each other. Mobile data and office networks often block direct connections.",
      { tone: 'danger', timeout: 10000 },
    )
  })

  // ---------- startup ----------

  await sync.ready
  if (!readOnly) {
    store.migrate()
    store.registerUser(me.id, me.name)
  }
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

  // A board that's still empty (just joined from a link) says where its content is until it
  // arrives, then fits the view to it; if you draw the first item yourself the view stays put.
  joining = hosted || isNew || initialData || store.items.size > 0 ? 'done' : 'open'
  updateJoin()
  if (store.items.size === 0) {
    const once = (_event: unknown, transaction: Y.Transaction) => {
      if (store.items.size === 0) return
      store.items.unobserve(once)
      updateJoin()
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
      offJoinPeers()
      offStatus()
      clearTimeout(waitTimer)
      clearTimeout(sessionTimer)
      chrome.history.destroy()
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('cut', onCut)
      document.removeEventListener('paste', onPaste)
      canvas.removeEventListener('dragover', onDragOver)
      canvas.removeEventListener('drop', onDrop)
      store.meta.unobserve(syncTitle)
      board.destroy()
      await sync.destroy()
      store.doc.destroy()
    },
  }
}
