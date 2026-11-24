// The canvas: owns the view, the selection, text editing and the active tool, renders the store
// and exposes the actions the commands call. No app chrome and no keyboard shortcuts here
// (see commands/), except holding Space to pan.
import { h } from '../ui/ds/index.ts'
import { bounds, contains, unionBounds } from '../core/geometry.ts'
import { CONNECTABLE } from '../core/schema.ts'
import { createView } from './view.ts'
import { createItemsRenderer } from './render/items.ts'
import { createConnectorsRenderer } from './render/connectors.ts'
import { createOverlay } from './render/overlay.ts'
import { createCursors } from './render/cursors.ts'
import { createTools } from './tools/index.ts'
import { createActions } from './actions.ts'
import { placeNote } from './tools/note.ts'
import { resetTextFit } from './text-fit.ts'
import type { ViewState } from './view.ts'
import type { OverlayLayers } from './render/overlay.ts'
import type { ColorKind, Gesture, Hit, QuickAddSide, ToolContext, ToolId } from './tools/index.ts'
import type { Store } from '../core/store.ts'
import type { HandlePosition } from '../core/geometry.ts'
import type { ColorKey, Item, Point } from '../core/types.ts'
import type { Peers } from '../sync/presence.ts'

export type Board = ReturnType<typeof createBoard>

/** What the page hears from the board. */
export interface BoardHooks {
  /** the selection, or something about the selected items, changed */
  onSelectionChange?: (items: Item[]) => void
  onToolChange?: (id: ToolId) => void
  onViewChange?: (view: ViewState) => void
  /** a drag started or ended */
  onBusyChange?: (busy: boolean) => void
  onEditingChange?: (id: string | null) => void
  /** the pointer moved over the board (board coordinates), or left it */
  onPointer?: (p: Point | null) => void
  onContextMenu?: (at: Point) => void
  onAddReaction?: (id: string, anchor: HTMLElement) => void
}

const RIGHT_DRAG = 4 // screen px before a right-button press becomes a pan
const HOVER_KEEP = 28 // screen px around a hovered item that keep its connection dots

export function createBoard(viewport: HTMLElement, store: Store, hooks: BoardHooks = {}) {
  viewport.classList.add('board')
  const world = h('div', { class: 'board__world' })
  const framesLayer = h('div', { class: 'board__layer' })
  const connectorsLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  connectorsLayer.setAttribute('class', 'board__connectors')
  const itemsLayer = h('div', { class: 'board__layer' })
  const overlayLayer = h('div', { class: 'board__overlay' })
  const cursorsLayer = h('div', { class: 'board__layer board__cursors' })
  world.append(framesLayer, connectorsLayer, itemsLayer, overlayLayer, cursorsLayer)
  const hint = h('p', {
    class: 'board__hint ds-caption',
    text: 'Double-click to add a sticky note, or pick a tool on the left',
  })
  viewport.append(world, hint)

  // ---------- state ----------
  let cache: { list: readonly Item[]; byId: Map<string, Item> } = { list: [], byId: new Map() }
  let selection = new Set<string>()
  let selectionSig = ''
  /** the item whose text is being edited; `fresh` when it was just created */
  let editing: { id: string; fresh: boolean } | null = null
  let toolId: ToolId = 'select'
  let gesture: Gesture | null | void = null
  let busy = false
  let hoveredId = ''
  let overlayState: OverlayLayers = { marquee: null, guides: [], draft: null, target: null }
  let spaceDown = false
  /** a viewer's board: dragging pans, nothing can be changed */
  let readOnly = false
  let lastPointer: Point | null = null
  let frame = 0
  const pointers = new Map<number, Point>()
  let pinch: { dist: number; mid: Point } | null = null
  let rightPress: { x: number; y: number; hit: Hit; moved: boolean } | null = null
  const lastColor: Record<ColorKind, ColorKey> = {
    note: 'yellow',
    shape: 'blue',
    text: 'gray',
    connector: 'gray',
    pen: 'gray',
  }

  const getItem = (id: string): Item | undefined => cache.byId.get(id)
  const me = store.me

  const view = createView(viewport, world, { onChange: (v) => hooks.onViewChange?.(v) })

  const items = createItemsRenderer(
    { frames: framesLayer, items: itemsLayer },
    {
      store,
      me,
      editor: {
        onInput(id, text) {
          store.update({ [id]: { text } })
          if (getItem(id)?.type === 'text') measure(id)
        },
        onKeyDown(id, e) {
          e.stopPropagation() // typing never triggers board shortcuts
          const it = getItem(id)
          if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey || it?.type === 'frame'))) {
            e.preventDefault()
            stopEditing()
          }
        },
        onBlur(id) {
          if (editing?.id === id) stopEditing()
        },
      },
    },
  )
  const connectors = createConnectorsRenderer(connectorsLayer)
  const overlay = createOverlay(overlayLayer)
  const cursors = createCursors(cursorsLayer, me)

  // ---------- rendering ----------

  function scheduleRender() {
    if (!frame) frame = requestAnimationFrame(render)
  }

  function render() {
    cancelAnimationFrame(frame)
    frame = 0
    const list = store.all()
    cache = { list, byId: new Map(list.map((it) => [it.id, it])) }
    for (const id of selection) if (!cache.byId.has(id)) selection.delete(id)
    if (editing && !cache.byId.has(editing.id)) editing = null
    if (hoveredId && !cache.byId.has(hoveredId)) hoveredId = ''

    const state = { selection, editingId: editing?.id, getItem }
    items.render(list, state)
    connectors.render(list, state)
    const selected = selectedItems()
    overlay.render({
      ...overlayState,
      selected,
      getItem,
      editingId: editing?.id,
      busy,
      hovered: toolId === 'select' && hoveredId ? getItem(hoveredId) : null,
    })
    hint.hidden = list.length > 0
    // the context bar follows colours, sizes and positions too, not only which items are selected
    const sig = JSON.stringify(selected)
    if (sig !== selectionSig) {
      selectionSig = sig
      hooks.onSelectionChange?.(selected)
    }
  }

  const selectedItems = (): Item[] => [...selection].map(getItem).filter((it): it is Item => Boolean(it))

  function setSelection(ids: Iterable<string>) {
    selection = new Set(ids)
    scheduleRender()
  }

  // ---------- text editing ----------

  function startEditing(id: string, { fresh = false } = {}) {
    const it = getItem(id) || store.get(id)
    if (!it || it.type === 'arrow' || it.type === 'path' || it.locked) return
    editing = { id, fresh }
    selection = new Set([id])
    render()
    const el = items.editorOf(id)
    if (el) {
      el.focus({ preventScroll: true })
      const range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false)
      const sel = getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    }
    hooks.onEditingChange?.(id)
  }

  function stopEditing() {
    if (!editing) return
    const { id, fresh } = editing
    editing = null
    items.editorOf(id)?.blur()
    const it = store.get(id)
    // a text box left empty right after placing it is just noise
    if (it?.type === 'text' && fresh && !String(it.text || '').trim()) store.remove([id])
    store.stopCapturing()
    render()
    hooks.onEditingChange?.(null)
  }

  /** Text boxes grow with their content: store the height the text actually takes. */
  function measure(id: string) {
    const node = items.node(id)
    const it = store.get(id)
    if (!(node instanceof HTMLElement) || it?.type !== 'text') return
    const hgt = Math.round(node.offsetHeight)
    if (Math.abs(hgt - it.h) > 1) store.update({ [id]: { h: hgt } })
  }

  // ---------- hit testing ----------

  function hitTest(target: EventTarget | null): Hit {
    const el =
      target instanceof Element
        ? target.closest('[data-handle], [data-end], [data-dot], [data-quick-add], [data-id], [data-frame-sheet]')
        : null
    if (!el || !viewport.contains(el)) return { kind: 'canvas' }
    // SVG items carry data-id too: read attributes, which every element has
    const attr = (name: string) => el.getAttribute(name)
    const handle = attr('data-handle')
    if (handle) return { kind: 'handle', value: handle as HandlePosition }
    const end = attr('data-end')
    if (end) return { kind: 'end', value: end === 'start' ? 'start' : 'end' }
    const dot = attr('data-dot')
    if (dot) return { kind: 'dot', value: dot, item: getItem(hoveredId) }
    const quickAdd = attr('data-quick-add')
    if (quickAdd) return { kind: 'quick-add', value: quickAdd as QuickAddSide }
    const sheet = attr('data-frame-sheet')
    if (sheet) return { kind: 'canvas', frame: sheet } // a frame's inside is canvas
    const item = getItem(attr('data-id') || '')
    return item ? { kind: 'item', item } : { kind: 'canvas' }
  }

  /** The topmost item a connector can attach to under a screen point. */
  function itemAt(clientX: number, clientY: number): Item | null {
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      if (!viewport.contains(el)) continue
      const node = el.closest('[data-id]')
      const it = node && getItem(node.getAttribute('data-id') || '')
      if (it && CONNECTABLE.includes(it.type)) return it
    }
    return null
  }

  /** `ids` plus everything inside the frames among them. */
  function withContents(ids: readonly string[]): string[] {
    const out = new Set(ids)
    const frames = ids.map(getItem).filter((it) => it?.type === 'frame')
    for (const f of frames) {
      for (const it of cache.list) if (it.id !== f.id && contains(f, bounds(it, getItem))) out.add(it.id)
    }
    return [...out]
  }

  // ---------- tools ----------

  const panGesture = (e: { clientX: number; clientY: number }): Gesture => {
    let last = { x: e.clientX, y: e.clientY }
    viewport.classList.add('is-panning')
    return {
      move(ev) {
        view.panBy(ev.clientX - last.x, ev.clientY - last.y)
        last = { x: ev.clientX, y: ev.clientY }
      },
      up: () => viewport.classList.remove('is-panning'),
      cancel: () => viewport.classList.remove('is-panning'),
    }
  }

  const ctx: ToolContext = {
    store,
    view,
    getItem,
    list: () => cache.list,
    selection: {
      ids: () => [...selection],
      items: selectedItems,
      has: (id) => selection.has(id),
      set: setSelection,
      clear: () => setSelection([]),
    },
    overlay(patch) {
      overlayState = { ...overlayState, ...patch }
      scheduleRender()
    },
    setTool,
    startEditing,
    colorFor: (kind) => lastColor[kind] || 'gray',
    withContents,
    itemAt,
    measure,
    px: (n) => n / view.scale,
    pan: panGesture,
  }
  const tools = createTools(ctx)

  function setTool(id: ToolId) {
    const tool = tools.get(id)
    if (!tool) return
    toolId = id
    viewport.dataset.tool = id
    viewport.style.cursor = tool.cursor
    hoveredId = ''
    if (id !== 'select') stopEditing()
    scheduleRender()
    hooks.onToolChange?.(id)
  }

  function setBusy(on: boolean) {
    if (busy === on) return
    busy = on
    scheduleRender()
    hooks.onBusyChange?.(on)
  }

  function endGesture(e: PointerEvent, cancelled = false) {
    const g = gesture
    gesture = null
    setBusy(false)
    if (!g) return
    if (cancelled) g.cancel?.()
    else g.up?.(e, view.toWorld(e.clientX, e.clientY))
    scheduleRender()
  }

  // ---------- pointer input ----------

  const passThrough = (t: EventTarget | null) =>
    t instanceof Element && Boolean(t.closest('[contenteditable], [data-reaction], [data-add-reaction]'))

  function onPointerDown(e: PointerEvent) {
    if (passThrough(e.target)) return
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    viewport.setPointerCapture(e.pointerId)
    if (pointers.size === 2) {
      endGesture(e, true)
      const [a, b] = [...pointers.values()]
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
      return
    }
    if (pointers.size > 2 || gesture) return
    if (editing) stopEditing()

    const p = view.toWorld(e.clientX, e.clientY)
    const hit = hitTest(e.target)
    if (e.button === 2) {
      rightPress = { x: e.clientX, y: e.clientY, hit, moved: false }
      return
    }
    const touchPan = e.pointerType === 'touch' && toolId === 'select' && hit.kind === 'canvas'
    if (e.button === 1 || spaceDown || touchPan || (readOnly && e.button === 0)) {
      gesture = panGesture(e)
      return
    }
    if (e.button !== 0) return
    gesture = tools.get(toolId)?.down(e, p, hit)
  }

  function onPointerMove(e: PointerEvent) {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const p = view.toWorld(e.clientX, e.clientY)
    lastPointer = p
    hooks.onPointer?.(p)

    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const r = viewport.getBoundingClientRect()
      view.panBy(mid.x - pinch.mid.x, mid.y - pinch.mid.y)
      view.zoomAt(dist / pinch.dist, mid.x - r.left, mid.y - r.top)
      pinch = { dist, mid }
      return
    }
    if (rightPress) {
      if (!rightPress.moved && Math.hypot(e.clientX - rightPress.x, e.clientY - rightPress.y) > RIGHT_DRAG) {
        rightPress.moved = true
        gesture = panGesture({ clientX: rightPress.x, clientY: rightPress.y })
      }
    }
    if (gesture) {
      setBusy(true)
      gesture.move?.(e, p)
      return
    }
    if (e.pointerType !== 'touch') updateHover(e, p)
  }

  function updateHover(e: PointerEvent, p: Point) {
    if (toolId !== 'select' || readOnly) return
    const hit = hitTest(e.target)
    let next = hoveredId
    if (hit.kind === 'item' && CONNECTABLE.includes(hit.item.type)) next = hit.item.id
    else if (hit.kind !== 'dot' && hoveredId) {
      const it = getItem(hoveredId)
      const pad = ctx.px(HOVER_KEEP)
      const b = it && bounds(it, getItem)
      const near = b && p.x > b.x - pad && p.x < b.x + b.w + pad && p.y > b.y - pad && p.y < b.y + b.h + pad
      if (!near) next = ''
    }
    if (next !== hoveredId) {
      hoveredId = next
      scheduleRender()
    }
  }

  function onPointerUp(e: PointerEvent) {
    pointers.delete(e.pointerId)
    if (pinch) {
      if (pointers.size < 2) pinch = null
      return
    }
    const press = rightPress
    rightPress = null
    endGesture(e)
    if (press && !press.moved) {
      const hit = press.hit
      if (hit.kind === 'item' && !selection.has(hit.item.id)) setSelection(store.withGroups([hit.item.id]))
      render()
      hooks.onContextMenu?.({ x: e.clientX, y: e.clientY })
    }
  }

  function onPointerCancel(e: PointerEvent) {
    pointers.delete(e.pointerId)
    pinch = null
    rightPress = null
    endGesture(e, true)
  }

  function onDoubleClick(e: MouseEvent) {
    if (readOnly || passThrough(e.target) || toolId !== 'select') return
    const hit = hitTest(e.target)
    if (hit.kind === 'item') return startEditing(hit.item.id)
    if (hit.kind === 'canvas') placeNote(ctx, view.toWorld(e.clientX, e.clientY), lastColor.note)
  }

  function onClick(e: MouseEvent) {
    if (readOnly || !(e.target instanceof Element)) return
    const chip = e.target.closest<HTMLElement>('[data-reaction]')
    const add = e.target.closest<HTMLElement>('[data-add-reaction]')
    const id = (chip || add)?.closest('[data-id]')?.getAttribute('data-id')
    if (!id) return
    if (chip) {
      store.stopCapturing()
      store.toggleReaction(id, chip.dataset.reaction || '')
    } else if (add) hooks.onAddReaction?.(id, add)
  }

  const isTyping = (t: EventTarget | null) =>
    t instanceof Element && Boolean(t.closest('input, textarea, select, [contenteditable], dialog'))

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== ' ' || isTyping(e.target) || e.repeat) return
    e.preventDefault()
    spaceDown = true
    viewport.classList.add('is-space')
  }
  function onKeyUp(e: KeyboardEvent) {
    if (e.key !== ' ') return
    spaceDown = false
    viewport.classList.remove('is-space')
  }
  function onBlur() {
    spaceDown = false
    viewport.classList.remove('is-space', 'is-panning')
  }
  function onLeave() {
    hooks.onPointer?.(null)
    if (hoveredId && !gesture) {
      hoveredId = ''
      scheduleRender()
    }
  }

  viewport.addEventListener('pointerdown', onPointerDown)
  viewport.addEventListener('pointermove', onPointerMove)
  viewport.addEventListener('pointerup', onPointerUp)
  viewport.addEventListener('pointercancel', onPointerCancel)
  viewport.addEventListener('pointerleave', onLeave)
  viewport.addEventListener('dblclick', onDoubleClick)
  viewport.addEventListener('click', onClick)
  viewport.addEventListener('contextmenu', (e) => e.preventDefault())
  // the view moves only through `view`: undo any scrolling the browser does on its own (focus, find)
  viewport.addEventListener('scroll', () => {
    viewport.scrollLeft = 0
    viewport.scrollTop = 0
  })
  // a press on the canvas never moves the focus (it would end the text being edited) or selects text
  viewport.addEventListener('mousedown', (e) => {
    if (!(e.target instanceof Element && e.target.closest('[contenteditable]'))) e.preventDefault()
  })
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)

  const onDoc = () => scheduleRender()
  // names changed: notes show authors and who reacted
  const onUsers = () => {
    items.invalidate()
    scheduleRender()
  }
  store.items.observeDeep(onDoc)
  store.users.observe(onUsers)

  // sticky text sizes depend on the font: measure again once Inter has loaded
  document.fonts?.ready.then(() => {
    resetTextFit()
    items.invalidate()
    scheduleRender()
  })

  setTool('select')
  render()

  // ---------- actions (called by the commands) ----------

  const actions = createActions(ctx, {
    rememberColor: (kind, color) => (lastColor[kind] = color),
    pasteAt() {
      const v = view.visibleRect()
      const p = lastPointer
      const inView = p && p.x > v.x && p.x < v.x + v.w && p.y > v.y && p.y < v.y + v.h
      return inView ? p : { x: v.x + v.w / 2, y: v.y + v.h / 2 }
    },
  })

  const api = {
    view,
    get tool() {
      return toolId
    },
    get readOnly() {
      return readOnly
    },
    /** A viewer's board: dragging pans and nothing can be changed (the server ignores edits anyway). */
    setReadOnly(on: boolean) {
      readOnly = on
      if (on) {
        if (editing) stopEditing()
        setSelection([])
        setTool('select')
        hoveredId = ''
      }
      viewport.classList.toggle('is-read-only', on)
      scheduleRender()
    },
    setTool,
    render: scheduleRender,
    renderNow: render,
    selection: selectedItems,
    select: (ids: readonly string[]) => setSelection(store.withGroups(ids)),
    selectAll: () => setSelection(cache.list.map((it) => it.id)),
    clearSelection: () => setSelection([]),
    get editingId() {
      return editing?.id || null
    },
    startEditing,
    stopEditing,
    editSelection() {
      const [it] = selectedItems()
      if (it && selection.size === 1) startEditing(it.id)
    },

    ...actions,

    zoomIn: () => view.stepZoom(1),
    zoomOut: () => view.stepZoom(-1),
    zoomTo: (s: number) => view.zoomTo(s),
    fitAll() {
      render()
      view.fit(unionBounds(cache.list.map((it) => bounds(it, getItem))))
    },
    fitSelection() {
      const b = actions.selectionBounds()
      if (b) view.fit(b, { pad: 120 })
    },
    toggleGrid: () => view.setGrid(!view.grid),

    /** The selection's box in client coordinates (for the context bar). */
    selectionClientRect(): DOMRect | null {
      const b = actions.selectionBounds()
      if (!b) return null
      const a = view.toClient({ x: b.x, y: b.y })
      const z = view.toClient({ x: b.x + b.w, y: b.y + b.h })
      return new DOMRect(a.x, a.y, z.x - a.x, z.y - a.y)
    },
    /** Where an item is on screen (for popovers anchored to it). */
    nodeOf: (id: string) => items.node(id),
    setCursors: (peers: Peers) => cursors.render(peers),

    destroy() {
      cancelAnimationFrame(frame)
      store.items.unobserveDeep(onDoc)
      store.users.unobserve(onUsers)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      view.destroy()
      items.destroy()
      connectors.destroy()
      overlay.destroy()
      cursors.destroy()
      viewport.replaceChildren()
    },
  }

  return api
}
