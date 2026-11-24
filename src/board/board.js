// The canvas: owns the view, the selection, text editing and the active tool, renders the store
// and exposes the actions the commands call. No app chrome and no keyboard shortcuts here
// (see commands/), except holding Space to pan.
import { h } from '../ui/ds/index.js'
import { bounds, contains, unionBounds } from '../core/geometry.js'
import { CONNECTABLE, isShape } from '../core/schema.js'
import { decodeClipboard, notesFromLines, pasteOffset } from '../core/clipboard.js'
import { createView } from './view.js'
import { createItemsRenderer } from './render/items.js'
import { createConnectorsRenderer } from './render/connectors.js'
import { createOverlay } from './render/overlay.js'
import { createCursors } from './render/cursors.js'
import { createTools } from './tools/index.js'
import { placeNote } from './tools/note.js'
import { resetTextFit } from './text-fit.js'

const GAP = 24
const RIGHT_DRAG = 4 // screen px before a right-button press becomes a pan
const HOVER_KEEP = 28 // screen px around a hovered item that keep its connection dots

const colorKind = (type) =>
  type === 'note' ? 'note' : isShape({ type }) ? 'shape' : type === 'arrow' ? 'connector' : type === 'path' ? 'pen' : type === 'text' ? 'text' : null

/**
 * hooks: onSelectionChange(items), onToolChange(id), onViewChange(view), onBusyChange(busy),
 * onEditingChange(id), onPointer(point | null), onContextMenu({x, y}), onAddReaction(id, anchor)
 */
export function createBoard(viewport, store, hooks = {}) {
  viewport.classList.add('board')
  const world = h('div', { class: 'board__world' })
  const framesLayer = h('div', { class: 'board__layer' })
  const connectorsLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  connectorsLayer.setAttribute('class', 'board__connectors')
  const itemsLayer = h('div', { class: 'board__layer' })
  const overlayLayer = h('div', { class: 'board__overlay' })
  const cursorsLayer = h('div', { class: 'board__layer board__cursors' })
  world.append(framesLayer, connectorsLayer, itemsLayer, overlayLayer, cursorsLayer)
  const hint = h('p', { class: 'board__hint ds-caption', text: 'Double-click to add a sticky note, or pick a tool on the left' })
  viewport.append(world, hint)

  // ---------- state ----------
  let cache = { list: [], byId: new Map() }
  let selection = new Set()
  let selectionSig = ''
  let editing = null // {id, fresh}
  let toolId = 'select'
  let gesture = null
  let busy = false
  let hoveredId = ''
  let overlayState = { marquee: null, guides: [], draft: null, target: null }
  let spaceDown = false
  let lastPointer = null
  let frame = 0
  const pointers = new Map()
  let pinch = null
  let rightPress = null
  const lastColor = { note: 'yellow', shape: 'blue', text: 'gray', connector: 'gray', pen: 'gray' }

  const getItem = (id) => cache.byId.get(id)
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

  const selectedItems = () => [...selection].map(getItem).filter(Boolean)

  function setSelection(ids) {
    selection = new Set(ids)
    scheduleRender()
  }

  // ---------- text editing ----------

  function startEditing(id, { fresh = false } = {}) {
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
      sel.removeAllRanges()
      sel.addRange(range)
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
  function measure(id) {
    const node = items.node(id)
    const it = store.get(id)
    if (!node || it?.type !== 'text') return
    const hgt = Math.round(node.offsetHeight)
    if (Math.abs(hgt - it.h) > 1) store.update({ [id]: { h: hgt } })
  }

  // ---------- hit testing ----------

  function hitTest(target) {
    const el = target?.closest?.('[data-handle], [data-end], [data-dot], [data-quick-add], [data-id], [data-frame-sheet]')
    if (!el || !viewport.contains(el)) return { kind: 'canvas' }
    const d = el.dataset
    if (d.handle) return { kind: 'handle', value: d.handle }
    if (d.end) return { kind: 'end', value: d.end }
    if (d.dot) return { kind: 'dot', value: d.dot, item: getItem(hoveredId) }
    if (d.quickAdd) return { kind: 'quick-add', value: d.quickAdd }
    if (d.frameSheet) return { kind: 'canvas', frame: d.frameSheet } // a frame's inside is canvas
    const item = getItem(el.dataset.id || el.getAttribute('data-id'))
    return item ? { kind: 'item', item } : { kind: 'canvas' }
  }

  /** The topmost item a connector can attach to under a screen point. */
  function itemAt(clientX, clientY) {
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      if (!viewport.contains(el)) continue
      const node = el.closest('[data-id]')
      const it = node && getItem(node.dataset.id)
      if (it && CONNECTABLE.includes(it.type)) return it
    }
    return null
  }

  /** `ids` plus everything inside the frames among them. */
  function withContents(ids) {
    const out = new Set(ids)
    const frames = ids.map(getItem).filter((it) => it?.type === 'frame')
    for (const f of frames) {
      for (const it of cache.list) if (it.id !== f.id && contains(f, bounds(it, getItem))) out.add(it.id)
    }
    return [...out]
  }

  // ---------- tools ----------

  const panGesture = (e) => {
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

  const ctx = {
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

  function setTool(id) {
    if (!tools.has(id)) return
    toolId = id
    viewport.dataset.tool = id
    viewport.style.cursor = tools.get(id).cursor
    hoveredId = ''
    if (id !== 'select') stopEditing()
    scheduleRender()
    hooks.onToolChange?.(id)
  }

  function setBusy(on) {
    if (busy === on) return
    busy = on
    scheduleRender()
    hooks.onBusyChange?.(on)
  }

  function endGesture(e, cancelled = false) {
    const g = gesture
    gesture = null
    setBusy(false)
    if (!g) return
    if (cancelled) g.cancel?.()
    else g.up?.(e, view.toWorld(e.clientX, e.clientY))
    scheduleRender()
  }

  // ---------- pointer input ----------

  const passThrough = (t) => t.closest?.('[contenteditable], [data-reaction], [data-add-reaction]')

  function onPointerDown(e) {
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
    if (e.button === 1 || spaceDown || touchPan) {
      gesture = panGesture(e)
      return
    }
    if (e.button !== 0) return
    gesture = tools.get(toolId).down(e, p, hit)
  }

  function onPointerMove(e) {
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

  function updateHover(e, p) {
    if (toolId !== 'select') return
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

  function onPointerUp(e) {
    pointers.delete(e.pointerId)
    if (pinch) {
      if (pointers.size < 2) pinch = null
      return
    }
    const press = rightPress
    rightPress = null
    endGesture(e)
    if (press && !press.moved) {
      if (press.hit.kind === 'item' && !selection.has(press.hit.item.id)) setSelection(store.withGroups([press.hit.item.id]))
      render()
      hooks.onContextMenu?.({ x: e.clientX, y: e.clientY })
    }
  }

  function onPointerCancel(e) {
    pointers.delete(e.pointerId)
    pinch = null
    rightPress = null
    endGesture(e, true)
  }

  function onDoubleClick(e) {
    if (passThrough(e.target) || toolId !== 'select') return
    const hit = hitTest(e.target)
    if (hit.kind === 'item') return startEditing(hit.item.id)
    if (hit.kind === 'canvas') placeNote(ctx, view.toWorld(e.clientX, e.clientY), lastColor.note)
  }

  function onClick(e) {
    const chip = e.target.closest('[data-reaction]')
    const add = e.target.closest('[data-add-reaction]')
    const node = (chip || add)?.closest('[data-id]')
    if (!node) return
    if (chip) {
      store.stopCapturing()
      store.toggleReaction(node.dataset.id, chip.dataset.reaction)
    } else hooks.onAddReaction?.(node.dataset.id, add)
  }

  const isTyping = (t) => t?.closest?.('input, textarea, select, [contenteditable], dialog')

  function onKeyDown(e) {
    if (e.key !== ' ' || isTyping(e.target) || e.repeat) return
    e.preventDefault()
    spaceDown = true
    viewport.classList.add('is-space')
  }
  function onKeyUp(e) {
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
    if (!e.target.closest('[contenteditable]')) e.preventDefault()
  })
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)

  const onDoc = () => scheduleRender()
  store.items.observeDeep(onDoc)
  store.users.observe(onDoc)

  // sticky text sizes depend on the font: measure again once Inter has loaded
  document.fonts?.ready.then(() => {
    resetTextFit()
    items.invalidate()
    scheduleRender()
  })

  setTool('select')
  render()

  // ---------- actions (called by the commands) ----------

  const editable = (ids) => ids.map(getItem).filter((it) => it && !it.locked)

  function remember(type, color) {
    const kind = colorKind(type)
    if (kind) lastColor[kind] = color
  }

  function moveBy(ids, dx, dy) {
    const patches = {}
    for (const it of editable(withContents(ids))) {
      if (it.type === 'arrow') {
        if (!it.from) patches[it.id] = { x1: it.x1 + dx, y1: it.y1 + dy }
        if (!it.to) Object.assign((patches[it.id] ??= {}), { x2: it.x2 + dx, y2: it.y2 + dy })
      } else patches[it.id] = { x: it.x + dx, y: it.y + dy }
    }
    store.update(patches)
  }

  function selectionBounds() {
    return unionBounds(selectedItems().map((it) => bounds(it, getItem)))
  }

  const api = {
    view,
    get tool() {
      return toolId
    },
    setTool,
    render: scheduleRender,
    renderNow: render,
    selection: selectedItems,
    select: (ids) => setSelection(store.withGroups(ids)),
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

    deleteSelection() {
      const ids = editable(withContents([...selection])).map((it) => it.id)
      if (!ids.length) return
      store.stopCapturing()
      store.remove(ids)
      setSelection([])
    },
    duplicateSelection() {
      if (!selection.size) return
      store.stopCapturing()
      setSelection(store.duplicate(withContents([...selection])))
    },
    /** ⌥ + arrow: a copy right next to the selection, on that side. */
    duplicateBeside(dx, dy) {
      const b = selectionBounds()
      if (!b) return
      store.stopCapturing()
      const ids = store.insert(store.snapshot(store.withGroups(withContents([...selection]))), {
        dx: dx * (b.w + GAP),
        dy: dy * (b.h + GAP),
      })
      setSelection(ids)
    },
    nudge(dx, dy) {
      if (selection.size) moveBy([...selection], dx, dy)
      else view.panBy(-dx * 8, -dy * 8)
    },
    setColor(color) {
      const patches = {}
      for (const it of editable([...selection])) {
        if (it.type === 'frame') continue
        patches[it.id] = { color }
        remember(it.type, color)
      }
      store.stopCapturing()
      store.update(patches)
    },
    setTextSize(fontSize) {
      const texts = editable([...selection]).filter((it) => it.type === 'text')
      store.stopCapturing()
      store.update(Object.fromEntries(texts.map((it) => [it.id, { fontSize }])))
      requestAnimationFrame(() => texts.forEach((it) => measure(it.id)))
    },
    setConnectorStyle(patch) {
      const arrows = editable([...selection]).filter((it) => it.type === 'arrow')
      store.stopCapturing()
      store.update(Object.fromEntries(arrows.map((it) => [it.id, patch])))
    },
    reorder(mode) {
      if (!selection.size) return
      store.stopCapturing()
      store.reorder([...selection], mode)
    },
    group() {
      store.stopCapturing()
      store.group([...selection])
      scheduleRender()
    },
    ungroup() {
      store.stopCapturing()
      store.ungroup([...selection])
    },
    toggleLock() {
      const list = selectedItems()
      if (!list.length) return
      store.stopCapturing()
      store.setLocked(
        list.map((it) => it.id),
        list.some((it) => !it.locked),
      )
    },
    /** Snapshot of the selection (frames with their contents) for the clipboard. */
    copySelection: () => store.snapshot(withContents([...selection])),
    /** Pastes decoded clipboard content centred on the pointer (or the middle of the screen). */
    paste(content) {
      const data = content?.items || content?.lines ? content : decodeClipboard(content)
      if (!data) return false
      const at = pointerOrCentre()
      store.stopCapturing()
      const ids = data.items
        ? store.insert(data.items, pasteOffset(data.items, at))
        : store.insert(notesFromLines(data.lines, at, lastColor.note))
      store.stopCapturing()
      setSelection(ids)
      return ids.length > 0
    },
    toggleReaction(id, emoji) {
      store.stopCapturing()
      store.toggleReaction(id, emoji)
    },

    zoomIn: () => view.stepZoom(1),
    zoomOut: () => view.stepZoom(-1),
    zoomTo: (s) => view.zoomTo(s),
    fitAll() {
      render()
      view.fit(unionBounds(cache.list.map((it) => bounds(it, getItem))))
    },
    fitSelection() {
      const b = selectionBounds()
      if (b) view.fit(b, { pad: 120 })
    },
    toggleGrid: () => view.setGrid(!view.grid),

    /** The selection's box in client coordinates (for the context bar). */
    selectionClientRect() {
      const b = selectionBounds()
      if (!b) return null
      const a = view.toClient({ x: b.x, y: b.y })
      const z = view.toClient({ x: b.x + b.w, y: b.y + b.h })
      return new DOMRect(a.x, a.y, z.x - a.x, z.y - a.y)
    },
    /** Where an item is on screen (for popovers anchored to it). */
    nodeOf: (id) => items.node(id),
    setCursors: (peers) => cursors.render(peers),

    destroy() {
      cancelAnimationFrame(frame)
      store.items.unobserveDeep(onDoc)
      store.users.unobserve(onDoc)
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

  function pointerOrCentre() {
    const v = view.visibleRect()
    const inView = lastPointer && lastPointer.x > v.x && lastPointer.x < v.x + v.w && lastPointer.y > v.y && lastPointer.y < v.y + v.h
    return inView ? lastPointer : { x: v.x + v.w / 2, y: v.y + v.h / 2 }
  }

  return api
}
