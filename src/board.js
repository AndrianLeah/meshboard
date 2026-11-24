// Canvas infinito: rendering degli elementi e interazioni (strumenti,
// selezione, spostamento, ridimensionamento, frecce, pan e zoom).
import { COLORS } from './store.js'
import { arrowEnds, bounds, intersects, normRect } from './geometry.js'
import { userColor } from './identity.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
const MIN_SIZE = 24
const ZOOM_MIN = 0.1
const ZOOM_MAX = 4
const DEFAULT_SIZE = {
  note: { w: 200, h: 200 },
  text: { w: 260, h: 56 },
  rect: { w: 180, h: 110 },
  ellipse: { w: 160, h: 120 },
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

function el(tag, className, parent) {
  const e = document.createElement(tag)
  if (className) e.className = className
  if (parent) parent.append(e)
  return e
}

function svg(tag, attrs, parent) {
  const e = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  if (parent) parent.append(e)
  return e
}

export function createBoard(viewport, store, hooks = {}) {
  const me = store.me
  viewport.classList.add('viewport')
  const world = el('div', 'world', viewport)
  const itemsLayer = el('div', 'items', world)
  const arrowsLayer = svg('svg', { class: 'arrows' }, world)
  const arrowsGroup = svg('g', {}, arrowsLayer)
  const previewGroup = svg('g', { class: 'preview' }, arrowsLayer)
  const overlay = el('div', 'overlay', world)
  const cursorsLayer = el('div', 'cursors', world)
  const emptyHint = el('div', 'empty-hint', viewport)
  emptyHint.textContent =
    'Doppio clic per un post-it · N post-it · R rettangolo · O ellisse · T testo · A freccia'

  const rect0 = viewport.getBoundingClientRect()
  const view = { x: rect0.width / 2, y: rect0.height / 2, s: 1 }
  let tool = 'select'
  let selection = new Set()
  let editingId = null
  let editingFresh = false
  let gesture = null
  let spaceDown = false
  let frame = 0
  let cache = { list: [], byId: new Map() }
  const nodes = new Map() // id -> {el, sig}
  const pointers = new Map() // pointerId -> {x, y} (per il pinch)
  let pinch = null
  const lastColor = { note: 'yellow', rect: 'blue', ellipse: 'green', text: 'gray', arrow: 'gray' }

  const getItem = (id) => cache.byId.get(id)

  // ---------- vista ----------

  function applyView() {
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.s})`
    world.style.setProperty('--inv', String(1 / view.s))
    const g = 24 * view.s
    viewport.style.backgroundSize = `${g}px ${g}px`
    viewport.style.backgroundPosition = `${view.x}px ${view.y}px`
    hooks.onViewChange?.({ ...view })
  }

  function toWorld(clientX, clientY) {
    const r = viewport.getBoundingClientRect()
    return { x: (clientX - r.left - view.x) / view.s, y: (clientY - r.top - view.y) / view.s }
  }

  function zoomAt(factor, cx, cy) {
    const r = viewport.getBoundingClientRect()
    const px = cx ?? r.width / 2
    const py = cy ?? r.height / 2
    const s = clamp(view.s * factor, ZOOM_MIN, ZOOM_MAX)
    const wx = (px - view.x) / view.s
    const wy = (py - view.y) / view.s
    view.x = px - wx * s
    view.y = py - wy * s
    view.s = s
    applyView()
  }

  function fitTo(ids) {
    const list = ids ? cache.list.filter((it) => ids.includes(it.id)) : cache.list
    const r = viewport.getBoundingClientRect()
    if (!list.length) {
      Object.assign(view, { x: r.width / 2, y: r.height / 2, s: 1 })
      return applyView()
    }
    let x1 = Infinity
    let y1 = Infinity
    let x2 = -Infinity
    let y2 = -Infinity
    for (const it of list) {
      const b = bounds(it, getItem)
      x1 = Math.min(x1, b.x)
      y1 = Math.min(y1, b.y)
      x2 = Math.max(x2, b.x + b.w)
      y2 = Math.max(y2, b.y + b.h)
    }
    const pad = 80
    const s = clamp(Math.min(r.width / (x2 - x1 + pad * 2), r.height / (y2 - y1 + pad * 2), 1), ZOOM_MIN, ZOOM_MAX)
    view.s = s
    view.x = r.width / 2 - ((x1 + x2) / 2) * s
    view.y = r.height / 2 - ((y1 + y2) / 2) * s
    applyView()
  }

  // ---------- rendering ----------

  function scheduleRender() {
    if (!frame) frame = requestAnimationFrame(render)
  }

  function render() {
    frame = 0
    const list = store.all()
    cache = { list, byId: new Map(list.map((it) => [it.id, it])) }
    let selChanged = false
    for (const id of selection) {
      if (!cache.byId.has(id)) {
        selection.delete(id)
        selChanged = true
      }
    }
    if (editingId && !cache.byId.has(editingId)) editingId = null
    renderItems(list)
    renderArrows(list)
    renderOverlay()
    emptyHint.hidden = list.length > 0
    // anche senza cambi di selezione: colori e ordine possono essere cambiati
    if (selChanged || selection.size) hooks.onSelectionChange?.([...selection])
  }

  function voteSummary(it) {
    const up = []
    const down = []
    for (const [uid, v] of Object.entries(it.votes || {})) (v === 1 ? up : v === -1 ? down : []).push(uid)
    return { up, down, mine: it.votes?.[me.id] || 0 }
  }

  function renderItems(list) {
    const seen = new Set()
    let index = 0
    for (const it of list) {
      if (it.type === 'arrow') continue
      index++
      seen.add(it.id)
      let n = nodes.get(it.id)
      if (!n) {
        n = { el: el('div', '', itemsLayer), sig: '' }
        n.el.dataset.id = it.id
        nodes.set(it.id, n)
      }
      const editing = editingId === it.id
      const votes = it.type === 'note' ? voteSummary(it) : null
      const names = votes
        ? [store.userName(it.author), ...votes.up.map(store.userName), ...votes.down.map(store.userName)]
        : []
      const sig = JSON.stringify([it, index, editing, names])
      if (sig === n.sig) continue
      n.sig = sig
      paintItem(n.el, it, index, editing, votes)
    }
    for (const [id, n] of nodes) {
      if (!seen.has(id)) {
        n.el.remove()
        nodes.delete(id)
      }
    }
  }

  function paintItem(node, it, index, editing, votes) {
    const c = COLORS[it.color] || COLORS.gray
    node.className = `item ${it.type}${editing ? ' editing' : ''}`
    node.style.transform = `translate(${it.x}px, ${it.y}px)`
    node.style.width = `${it.w}px`
    node.style.height = `${it.h}px`
    node.style.zIndex = String(index)
    node.style.setProperty('--fill', c.fill)
    node.style.setProperty('--stroke', c.stroke)

    // mentre si scrive non si tocca la textarea (perderebbe il focus)
    const ta = node.querySelector(':scope > .body > textarea')
    if (editing && ta) return

    const body = el('div', 'body')
    if (editing) {
      const area = el('textarea', '', body)
      area.value = it.text || ''
      area.spellcheck = true
      area.setAttribute('aria-label', 'Testo')
      area.addEventListener('input', () => store.update({ [it.id]: { text: area.value } }))
      area.addEventListener('keydown', (e) => {
        e.stopPropagation()
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          e.preventDefault()
          stopEditing()
        }
      })
      area.addEventListener('blur', () => stopEditing())
    } else {
      const text = el('div', 'text', body)
      text.textContent = it.text || ''
    }
    const parts = [body]

    if (it.type === 'note') {
      const footer = el('div', 'note-footer')
      const author = el('span', 'author', footer)
      author.textContent = it.author === me.id ? 'tu' : store.userName(it.author)
      const box = el('span', 'votes', footer)
      const own = it.author === me.id
      for (const [value, icon, ids] of [
        [1, '👍', votes.up],
        [-1, '👎', votes.down],
      ]) {
        const b = el('button', `vote${votes.mine === value ? ' active' : ''}`, box)
        b.type = 'button'
        b.dataset.vote = String(value)
        b.disabled = own
        const who = ids.map(store.userName).join(', ')
        b.title = own
          ? `${who || 'Nessun voto'} · non puoi votare i tuoi post-it`
          : who || (value === 1 ? 'Mi piace' : 'Non mi piace')
        b.setAttribute('aria-pressed', String(votes.mine === value))
        const i = el('span', '', b)
        i.textContent = icon
        const count = el('b', '', b)
        count.textContent = String(ids.length)
      }
      parts.push(footer)
    }
    node.replaceChildren(...parts)
  }

  function renderArrows(list) {
    const frag = document.createDocumentFragment()
    for (const it of list) {
      if (it.type !== 'arrow') continue
      const e = arrowEnds(it, getItem)
      const color = (COLORS[it.color] || COLORS.gray).stroke
      const g = svg('g', { class: `arrow${selection.has(it.id) ? ' selected' : ''}`, 'data-id': it.id }, frag)
      drawArrow(g, e, color)
    }
    arrowsGroup.replaceChildren(frag)

    // anteprima mentre si disegna una freccia
    previewGroup.replaceChildren()
    if (gesture?.type === 'arrow') {
      const from = gesture.from ? getItem(gesture.from) : null
      const e = arrowEnds(
        { from: from ? from.id : '', to: '', x1: gesture.x0, y1: gesture.y0, x2: gesture.x1, y2: gesture.y1 },
        getItem,
      )
      drawArrow(previewGroup, e, (COLORS[lastColor.arrow] || COLORS.gray).stroke)
    }
  }

  function drawArrow(g, e, color) {
    const dx = e.x2 - e.x1
    const dy = e.y2 - e.y1
    const len = Math.hypot(dx, dy) || 1
    const ux = dx / len
    const uy = dy / len
    const head = Math.min(14, len / 2)
    const bx = e.x2 - ux * head
    const by = e.y2 - uy * head
    svg('line', { class: 'hit', x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2 }, g)
    svg('line', { class: 'line', x1: e.x1, y1: e.y1, x2: bx, y2: by, stroke: color }, g)
    const pts = [
      [e.x2, e.y2],
      [bx - uy * head * 0.5, by + ux * head * 0.5],
      [bx + uy * head * 0.5, by - ux * head * 0.5],
    ]
    svg('polygon', { class: 'head', points: pts.map((p) => p.join(',')).join(' '), fill: color }, g)
  }

  function renderOverlay() {
    const frag = document.createDocumentFragment()
    const boxes = [...selection].map(getItem).filter((it) => it && it.type !== 'arrow')
    for (const it of boxes) {
      const b = el('div', 'sel-box', frag)
      place(b, it)
    }
    if (boxes.length === 1 && selection.size === 1 && !editingId && !gesture) {
      const it = boxes[0]
      for (const corner of ['nw', 'ne', 'sw', 'se']) {
        const h = el('div', `handle ${corner}`, frag)
        h.dataset.handle = corner
        h.style.left = `${it.x + (corner.includes('e') ? it.w : 0)}px`
        h.style.top = `${it.y + (corner.includes('s') ? it.h : 0)}px`
      }
    }
    if (gesture?.type === 'marquee') {
      place(el('div', 'marquee', frag), normRect(gesture.x0, gesture.y0, gesture.x1, gesture.y1))
    }
    if (gesture?.type === 'draw') {
      const r = drawRect(gesture)
      const p = el('div', `draw-preview ${gesture.shape}`, frag)
      p.style.setProperty('--stroke', COLORS[lastColor[gesture.shape]].stroke)
      place(p, r)
    }
    overlay.replaceChildren(frag)
  }

  function place(node, r) {
    node.style.transform = `translate(${r.x}px, ${r.y}px)`
    node.style.width = `${r.w}px`
    node.style.height = `${r.h}px`
  }

  // ---------- cursori degli altri ----------

  const cursorNodes = new Map()
  function setCursors(peers) {
    const seen = new Set()
    for (const [peerId, p] of peers) {
      if (p.x == null || p.y == null || p.uid === me.id) continue
      seen.add(peerId)
      let c = cursorNodes.get(peerId)
      if (!c) {
        c = el('div', 'cursor', cursorsLayer)
        c.innerHTML =
          '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path d="M1 1l5.5 14 2-6 6-2z"/></svg><span></span>'
        cursorNodes.set(peerId, c)
      }
      c.style.setProperty('--c', userColor(p.uid))
      c.style.transform = `translate(${p.x}px, ${p.y}px) scale(var(--inv))`
      c.lastChild.textContent = p.name || 'Anonimo'
    }
    for (const [peerId, c] of cursorNodes) {
      if (!seen.has(peerId)) {
        c.remove()
        cursorNodes.delete(peerId)
      }
    }
  }

  // ---------- selezione e strumenti ----------

  function setSelection(ids) {
    selection = new Set(ids)
    hooks.onSelectionChange?.([...selection])
    scheduleRender()
  }

  function setTool(t) {
    tool = t
    viewport.dataset.tool = t
    if (t !== 'select') setSelection([])
    hooks.onToolChange?.(t)
  }

  function startEditing(id, fresh = false) {
    const it = getItem(id)
    if (!it || it.type === 'arrow') return
    editingId = id
    editingFresh = fresh
    selection = new Set([id])
    hooks.onSelectionChange?.([id])
    render()
    const area = nodes.get(id)?.el.querySelector('textarea')
    if (area) {
      area.focus()
      area.setSelectionRange(area.value.length, area.value.length)
    }
  }

  function stopEditing() {
    if (!editingId) return
    const id = editingId
    const fresh = editingFresh
    editingId = null
    editingFresh = false
    // via il focus subito, così il prossimo tasto è una scorciatoia e non testo
    nodes.get(id)?.el.querySelector('textarea')?.blur()
    const it = store.get(id)
    // un testo lasciato vuoto subito dopo la creazione non serve a nulla
    if (it && it.type === 'text' && fresh && !String(it.text || '').trim()) store.remove([id])
    store.stopCapturing()
    render()
  }

  function createAt(type, p) {
    const size = DEFAULT_SIZE[type]
    store.stopCapturing()
    const id = store.create({
      type,
      x: Math.round(p.x - size.w / 2),
      y: Math.round(p.y - size.h / 2),
      ...size,
      color: lastColor[type],
      text: '',
    })
    setTool('select')
    render()
    startEditing(id, true)
    return id
  }

  function drawRect(g) {
    let r = normRect(g.x0, g.y0, g.x1, g.y1)
    if (r.w * view.s < 6 && r.h * view.s < 6) {
      const d = DEFAULT_SIZE[g.shape]
      r = { x: g.x0 - d.w / 2, y: g.y0 - d.h / 2, ...d }
    }
    return r
  }

  function itemIdAt(target) {
    const node = target?.closest?.('[data-id]')
    return node && viewport.contains(node) ? node.dataset.id : ''
  }

  // ---------- input ----------

  function onPointerDown(e) {
    if (e.target.closest('textarea, button, input')) return
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    viewport.setPointerCapture(e.pointerId)
    if (pointers.size === 2) {
      gesture = null
      startPinch()
      return
    }
    if (pointers.size > 2) return
    if (editingId) stopEditing()

    const p = toWorld(e.clientX, e.clientY)
    const id = itemIdAt(e.target)
    const target = id ? getItem(id) : null

    const touchPan =
      e.pointerType === 'touch' && tool === 'select' && !target && !e.target.closest('[data-handle]')
    if (e.button === 1 || spaceDown || tool === 'hand' || touchPan) {
      gesture = { type: 'pan', cx: e.clientX, cy: e.clientY }
      viewport.classList.add('panning')
      return
    }
    if (e.button !== 0) return

    switch (tool) {
      case 'note':
      case 'text':
        // si crea al rilascio: se il focus andasse alla textarea adesso,
        // il mousedown che segue glielo toglierebbe subito
        gesture = { type: 'place', what: tool, p }
        return
      case 'rect':
      case 'ellipse':
        gesture = { type: 'draw', shape: tool, x0: p.x, y0: p.y, x1: p.x, y1: p.y }
        scheduleRender()
        return
      case 'arrow':
        gesture = {
          type: 'arrow',
          from: target && target.type !== 'arrow' ? id : '',
          x0: p.x,
          y0: p.y,
          x1: p.x,
          y1: p.y,
        }
        scheduleRender()
        return
    }

    // strumento selezione
    const handle = e.target.closest('[data-handle]')
    if (handle && selection.size === 1) {
      const it = getItem([...selection][0])
      if (it) {
        store.stopCapturing()
        gesture = { type: 'resize', id: it.id, corner: handle.dataset.handle, orig: { ...it } }
        return
      }
    }
    if (target) {
      if (e.shiftKey) {
        const next = new Set(selection)
        next.has(id) ? next.delete(id) : next.add(id)
        setSelection(next)
        if (!next.has(id)) return
      } else if (!selection.has(id)) {
        setSelection([id])
      }
      store.stopCapturing()
      const orig = new Map()
      for (const sid of selection) {
        const it = getItem(sid)
        if (it) orig.set(sid, { ...it })
      }
      gesture = { type: 'move', start: p, moved: false, orig }
      return
    }
    gesture = {
      type: 'marquee',
      x0: p.x,
      y0: p.y,
      x1: p.x,
      y1: p.y,
      base: e.shiftKey ? new Set(selection) : new Set(),
    }
    if (!e.shiftKey) setSelection([])
  }

  function onPointerMove(e) {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const p = toWorld(e.clientX, e.clientY)
    hooks.onPointer?.(p)
    if (pinch) return movePinch()
    if (!gesture) return

    switch (gesture.type) {
      case 'pan':
        view.x += e.clientX - gesture.cx
        view.y += e.clientY - gesture.cy
        gesture.cx = e.clientX
        gesture.cy = e.clientY
        applyView()
        break
      case 'draw':
      case 'arrow':
      case 'marquee':
        gesture.x1 = p.x
        gesture.y1 = p.y
        if (gesture.type === 'marquee') {
          const m = normRect(gesture.x0, gesture.y0, gesture.x1, gesture.y1)
          const next = new Set(gesture.base)
          for (const it of cache.list) if (intersects(m, bounds(it, getItem))) next.add(it.id)
          selection = next
          hooks.onSelectionChange?.([...selection])
        }
        scheduleRender()
        break
      case 'move': {
        const dx = p.x - gesture.start.x
        const dy = p.y - gesture.start.y
        if (!gesture.moved && Math.hypot(dx, dy) * view.s < 3) return
        gesture.moved = true
        const patches = {}
        for (const [id, o] of gesture.orig) {
          if (o.type === 'arrow') {
            const moveAll = !o.from && !o.to
            if (!o.from || moveAll) Object.assign((patches[id] ??= {}), { x1: o.x1 + dx, y1: o.y1 + dy })
            if (!o.to || moveAll) Object.assign((patches[id] ??= {}), { x2: o.x2 + dx, y2: o.y2 + dy })
          } else {
            patches[id] = { x: Math.round(o.x + dx), y: Math.round(o.y + dy) }
          }
        }
        store.update(patches)
        break
      }
      case 'resize': {
        const o = gesture.orig
        const c = gesture.corner
        let x1 = o.x
        let y1 = o.y
        let x2 = o.x + o.w
        let y2 = o.y + o.h
        if (c.includes('w')) x1 = Math.min(p.x, x2 - MIN_SIZE)
        if (c.includes('e')) x2 = Math.max(p.x, x1 + MIN_SIZE)
        if (c.includes('n')) y1 = Math.min(p.y, y2 - MIN_SIZE)
        if (c.includes('s')) y2 = Math.max(p.y, y1 + MIN_SIZE)
        store.update({
          [o.id]: { x: Math.round(x1), y: Math.round(y1), w: Math.round(x2 - x1), h: Math.round(y2 - y1) },
        })
        break
      }
    }
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId)
    if (pinch) {
      if (pointers.size < 2) pinch = null
      return
    }
    const g = gesture
    gesture = null
    viewport.classList.remove('panning')
    if (!g) return

    if (g.type === 'place') {
      createAt(g.what, g.p)
    } else if (g.type === 'draw') {
      const r = drawRect(g)
      store.stopCapturing()
      const id = store.create({ type: g.shape, ...roundRect(r), color: lastColor[g.shape], text: '' })
      setTool('select')
      setSelection([id])
    } else if (g.type === 'arrow') {
      const under = document.elementFromPoint(e.clientX, e.clientY)
      const toId = itemIdAt(under)
      const to = toId && toId !== g.from && getItem(toId)?.type !== 'arrow' ? toId : ''
      const long = Math.hypot(g.x1 - g.x0, g.y1 - g.y0) * view.s > 12
      if ((g.from && to) || long) {
        store.stopCapturing()
        const id = store.create({
          type: 'arrow',
          x1: g.x0,
          y1: g.y0,
          x2: g.x1,
          y2: g.y1,
          from: g.from,
          to,
          color: lastColor.arrow,
        })
        setTool('select')
        setSelection([id])
      }
    } else if (g.type === 'move' || g.type === 'resize') {
      store.stopCapturing()
    }
    scheduleRender()
  }

  const roundRect = (r) => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) })

  function startPinch() {
    const [a, b] = [...pointers.values()]
    pinch = {
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      view: { ...view },
    }
  }

  function movePinch() {
    if (pointers.size < 2) return
    const [a, b] = [...pointers.values()]
    const r = viewport.getBoundingClientRect()
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const v0 = pinch.view
    const s = clamp(v0.s * (dist / pinch.dist), ZOOM_MIN, ZOOM_MAX)
    const wx = (pinch.mid.x - r.left - v0.x) / v0.s
    const wy = (pinch.mid.y - r.top - v0.y) / v0.s
    view.s = s
    view.x = mid.x - r.left - wx * s
    view.y = mid.y - r.top - wy * s
    applyView()
  }

  function onDoubleClick(e) {
    if (e.target.closest('textarea, button, input')) return
    const id = itemIdAt(e.target)
    const it = id ? getItem(id) : null
    if (it && it.type !== 'arrow') return startEditing(id)
    if (!it && tool === 'select') createAt('note', toWorld(e.clientX, e.clientY))
  }

  function onWheel(e) {
    e.preventDefault()
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
    const r = viewport.getBoundingClientRect()
    if (e.ctrlKey || e.metaKey) {
      zoomAt(Math.exp(-e.deltaY * unit * 0.01), e.clientX - r.left, e.clientY - r.top)
    } else {
      view.x -= e.deltaX * unit
      view.y -= e.deltaY * unit
      applyView()
    }
  }

  function onClick(e) {
    const b = e.target.closest('button[data-vote]')
    if (!b || b.disabled) return
    const id = itemIdAt(b)
    if (id) store.vote(id, Number(b.dataset.vote))
  }

  const isTyping = (t) => t?.closest?.('input, textarea, select, [contenteditable="true"], dialog')

  function onKeyDown(e) {
    if (isTyping(e.target)) return
    const mod = e.metaKey || e.ctrlKey
    const k = e.key.toLowerCase()
    if (mod) {
      if (k === 'z') {
        e.preventDefault()
        e.shiftKey ? store.redo() : store.undo()
      } else if (k === 'y') {
        e.preventDefault()
        store.redo()
      } else if (k === 'd') {
        e.preventDefault()
        duplicateSelection()
      } else if (k === 'a') {
        e.preventDefault()
        setSelection(cache.list.map((it) => it.id))
      }
      return
    }
    if (e.altKey) return
    const tools = { v: 'select', h: 'hand', n: 'note', r: 'rect', o: 'ellipse', t: 'text', a: 'arrow' }
    if (e.code === 'Digit1' && e.shiftKey) return fitTo()
    if (tools[k] && !e.shiftKey) return setTool(tools[k])
    switch (e.key) {
      case ' ':
        e.preventDefault()
        if (!spaceDown) {
          spaceDown = true
          viewport.classList.add('space')
        }
        break
      case 'Delete':
      case 'Backspace':
        if (selection.size) {
          e.preventDefault()
          deleteSelection()
        }
        break
      case 'Escape':
        setSelection([])
        setTool('select')
        break
      case 'Enter':
        if (selection.size === 1) {
          e.preventDefault()
          startEditing([...selection][0])
        }
        break
      case '+':
      case '=':
        zoomAt(1.2)
        break
      case '-':
        zoomAt(1 / 1.2)
        break
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight': {
        if (!selection.size) return
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        nudge(dx, dy)
        break
      }
    }
  }

  function onKeyUp(e) {
    if (e.key === ' ') {
      spaceDown = false
      viewport.classList.remove('space')
    }
  }

  function nudge(dx, dy) {
    const patches = {}
    for (const id of selection) {
      const it = getItem(id)
      if (!it) continue
      if (it.type === 'arrow') {
        if (!it.from) patches[id] = { x1: it.x1 + dx, y1: it.y1 + dy }
        if (!it.to) Object.assign((patches[id] ??= {}), { x2: it.x2 + dx, y2: it.y2 + dy })
      } else patches[id] = { x: it.x + dx, y: it.y + dy }
    }
    store.update(patches)
  }

  // ---------- azioni sulla selezione ----------

  function deleteSelection() {
    if (!selection.size) return
    store.stopCapturing()
    store.remove([...selection])
    setSelection([])
  }

  function duplicateSelection() {
    if (!selection.size) return
    store.stopCapturing()
    setSelection(store.duplicate([...selection]))
  }

  function colorSelection(color) {
    const patches = {}
    for (const id of selection) {
      const it = getItem(id)
      if (!it) continue
      patches[id] = { color }
      lastColor[it.type] = color
    }
    store.stopCapturing()
    store.update(patches)
  }

  function reorderSelection(toFront) {
    if (!selection.size) return
    store.stopCapturing()
    store.reorder([...selection], toFront)
  }

  // ---------- collegamenti ----------

  const onLeave = () => hooks.onPointer?.(null)
  const onBlur = () => {
    spaceDown = false
    viewport.classList.remove('space', 'panning')
  }
  viewport.addEventListener('pointerdown', onPointerDown)
  viewport.addEventListener('pointermove', onPointerMove)
  viewport.addEventListener('pointerup', onPointerUp)
  viewport.addEventListener('pointercancel', onPointerUp)
  viewport.addEventListener('pointerleave', onLeave)
  viewport.addEventListener('dblclick', onDoubleClick)
  viewport.addEventListener('wheel', onWheel, { passive: false })
  viewport.addEventListener('click', onClick)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)

  const onDoc = () => scheduleRender()
  store.items.observeDeep(onDoc)
  store.users.observe(onDoc)

  setTool('select')
  applyView()
  render()

  return {
    render: scheduleRender,
    setTool,
    getTool: () => tool,
    getSelection: () => [...selection].map(getItem).filter(Boolean),
    setSelection,
    colorSelection,
    deleteSelection,
    duplicateSelection,
    reorderSelection,
    zoomIn: () => zoomAt(1.2),
    zoomOut: () => zoomAt(1 / 1.2),
    zoomReset: () => zoomAt(1 / view.s),
    fitTo: (ids) => {
      render()
      fitTo(ids)
    },
    setCursors,
    destroy() {
      cancelAnimationFrame(frame)
      store.items.unobserveDeep(onDoc)
      store.users.unobserve(onDoc)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      viewport.replaceChildren()
    },
  }
}
