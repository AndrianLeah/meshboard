// Draws board items (everything but connectors) as DOM: sticky notes, shapes, text, frames and
// pen strokes. Each node is repainted only when what it shows changes.
import { h, svg, cls, reactionChip, iconChip } from '../../ui/ds/index.js'
import { fitText } from '../text-fit.js'

/** SVG outline of a shape in a w × h box, inset by half the stroke. */
export function shapePath(type, w, h, i = 1) {
  switch (type) {
    case 'ellipse':
      return `M ${w / 2} ${i} A ${w / 2 - i} ${h / 2 - i} 0 1 1 ${w / 2} ${h - i} A ${w / 2 - i} ${h / 2 - i} 0 1 1 ${w / 2} ${i} Z`
    case 'triangle':
      return `M ${w / 2} ${i} L ${w - i} ${h - i} L ${i} ${h - i} Z`
    case 'diamond':
      return `M ${w / 2} ${i} L ${w - i} ${h / 2} L ${w / 2} ${h - i} L ${i} ${h / 2} Z`
    default: {
      const r = Math.min(6, w / 4, h / 4)
      return `M ${i + r} ${i} H ${w - i - r} Q ${w - i} ${i} ${w - i} ${i + r} V ${h - i - r} Q ${w - i} ${h - i} ${w - i - r} ${h - i} H ${i + r} Q ${i} ${h - i} ${i} ${h - i - r} V ${i + r} Q ${i} ${i} ${i + r} ${i} Z`
    }
  }
}

/** Pen stroke points (relative, in the original box) → path data in the current box. */
function strokePath(it) {
  const sx = it.w / it.ow
  const sy = it.h / it.oh
  const p = it.points
  let d = `M ${p[0] * sx} ${p[1] * sy}`
  for (let i = 2; i < p.length; i += 2) d += ` L ${p[i] * sx} ${p[i + 1] * sy}`
  return d
}

const colorVars = (color) => ({ '--fill': `var(--note-${color})`, '--stroke': `var(--stroke-${color})` })

function place(el, it, index) {
  el.style.transform = `translate(${it.x}px, ${it.y}px)`
  el.style.width = `${it.w}px`
  el.style.height = `${it.h}px`
  el.style.zIndex = String(index)
  for (const [k, v] of Object.entries(colorVars(it.color))) el.style.setProperty(k, v)
}

/** An editable text box: plain text only, focus and caret handled by the board. */
function editable(className, text, { onInput, onKeyDown, onBlur, label }) {
  const el = h('div', { class: cls(className, 'is-editing'), role: 'textbox', 'aria-label': label, 'aria-multiline': 'true' })
  try {
    el.contentEditable = 'plaintext-only'
  } catch {
    el.contentEditable = 'true'
  }
  el.textContent = text
  el.addEventListener('input', () => onInput(el.innerText.replace(/\n$/, '')))
  el.addEventListener('keydown', onKeyDown)
  el.addEventListener('blur', onBlur)
  el.addEventListener('paste', (e) => {
    e.preventDefault()
    document.execCommand('insertText', false, e.clipboardData?.getData('text/plain') || '')
  })
  return el
}

/**
 * layers: {frames, items} containers. ctx: {store, me, editor} where `editor` gives the
 * callbacks of the text being edited: {onInput(id, text, el), onKeyDown(id, e), onBlur(id)}.
 */
export function createItemsRenderer(layers, ctx) {
  const nodes = new Map() // id → {el, sig}
  const { store, me } = ctx

  function render(list, { selection, editingId }) {
    const seen = new Set()
    let index = 0
    for (const it of list) {
      if (it.type === 'arrow') continue
      index++
      seen.add(it.id)
      const editing = editingId === it.id
      const selected = selection.has(it.id)
      const names = it.type === 'note' ? noteNames(it) : null
      const sig = JSON.stringify([it, index, editing, selected, names])
      let n = nodes.get(it.id)
      if (n && n.sig === sig) continue
      if (n && n.type !== it.type) {
        n.el.remove()
        n = null
      }
      if (!n) {
        n = { el: null, sig: '', type: it.type }
        nodes.set(it.id, n)
      }
      n.sig = sig
      const fresh = paint(n.el, it, { index, editing, selected, names })
      if (fresh !== n.el) {
        n.el?.remove()
        n.el = fresh
      }
      const parent = it.type === 'frame' ? layers.frames : layers.items
      if (n.el.parentNode !== parent) parent.append(n.el)
    }
    for (const [id, n] of nodes) {
      if (!seen.has(id)) {
        n.el.remove()
        nodes.delete(id)
      }
    }
  }

  function noteNames(it) {
    const out = { author: it.author === me.id ? 'You' : store.userName(it.author) }
    for (const [emoji, by] of Object.entries(it.reactions || {})) {
      out[emoji] = Object.keys(by).map((uid) => (uid === me.id ? 'You' : store.userName(uid)))
    }
    return out
  }

  // ---------- painters: return the node (the same one when it can be updated in place) ----------

  function paint(el, it, state) {
    switch (it.type) {
      case 'note':
        return paintNote(el, it, state)
      case 'text':
        return paintText(el, it, state)
      case 'frame':
        return paintFrame(el, it, state)
      case 'path':
        return paintPath(el, it, state)
      default:
        return paintShape(el, it, state)
    }
  }

  const editor = (it, className, label) =>
    editable(className, it.text || '', {
      label,
      onInput: (text) => ctx.editor.onInput(it.id, text),
      onKeyDown: (e) => ctx.editor.onKeyDown(it.id, e),
      onBlur: () => ctx.editor.onBlur(it.id),
    })

  /** Keeps a live editor (and its caret) across repaints of the same item. */
  const liveEditor = (el, selector) => (el ? el.querySelector(`${selector}.is-editing`) : null)

  function paintNote(el, it, { index, editing, selected, names }) {
    const keep = editing ? liveEditor(el, '.note__text') : null
    const root = keep ? el : h('div', { dataset: { id: it.id } })
    root.className = cls('item item--note', selected && 'is-selected', editing && 'is-editing', it.locked && 'is-locked')
    place(root, it, index)
    const footer = h(
      'div',
      { class: 'note__footer' },
      h('span', { class: 'note__author', text: names.author }),
      h(
        'span',
        { class: 'note__reactions' },
        Object.entries(it.reactions || {}).map(([emoji, by]) =>
          reactionChip({
            emoji,
            count: Object.keys(by).length,
            pressed: me.id in by,
            title: `${names[emoji].join(', ')} reacted with ${emoji}`,
            'data-reaction': emoji,
          }),
        ),
        iconChip({ icon: 'reaction-add', label: 'Add reaction', class: 'note__add', 'data-add-reaction': '' }),
      ),
    )
    if (keep) {
      root.querySelector('.note__footer').replaceWith(footer)
      fitNote(root, keep.innerText)
      return root
    }
    const text = editing ? editor(it, 'note__text', 'Sticky note text') : h('div', { class: 'note__text', text: it.text || '' })
    root.replaceChildren(h('div', { class: 'note__body' }, text), footer)
    // sizes need layout: measure once the node is in the document
    queueMicrotask(() => fitNote(root, it.text || ''))
    return root
  }

  function fitNote(root, text) {
    const body = root.querySelector('.note__body')
    const textEl = root.querySelector('.note__text')
    if (!body || !textEl || !root.isConnected) return
    textEl.style.fontSize = `${fitText(text, body.clientWidth, body.clientHeight)}px`
  }

  function paintShape(el, it, { index, editing, selected }) {
    const keep = editing ? liveEditor(el, '.shape__label') : null
    const root = keep ? el : h('div', { dataset: { id: it.id } })
    root.className = cls('item item--shape', `item--${it.type}`, selected && 'is-selected', editing && 'is-editing', it.locked && 'is-locked')
    place(root, it, index)
    const outline = svg('svg', { class: 'shape__svg', width: it.w, height: it.h, 'aria-hidden': 'true' }, svg('path', { class: 'shape__outline', d: shapePath(it.type, it.w, it.h) }))
    if (keep) {
      root.querySelector('.shape__svg').replaceWith(outline)
      return root
    }
    const label = editing ? editor(it, 'shape__label', 'Shape text') : h('div', { class: 'shape__label', text: it.text || '' })
    root.replaceChildren(outline, label)
    return root
  }

  function paintText(el, it, { index, editing, selected }) {
    const keep = editing ? liveEditor(el, '.text__content') : null
    const root = keep ? el : h('div', { dataset: { id: it.id } })
    root.className = cls('item item--text', selected && 'is-selected', editing && 'is-editing', it.locked && 'is-locked')
    place(root, it, index)
    root.style.height = 'auto'
    root.style.minHeight = `${it.h}px`
    root.style.fontSize = `${it.fontSize}px`
    if (keep) return root
    const content = editing ? editor(it, 'text__content', 'Text') : h('div', { class: 'text__content', text: it.text || '' })
    root.replaceChildren(content)
    return root
  }

  function paintFrame(el, it, { index, editing, selected }) {
    const keep = editing ? liveEditor(el, '.frame__title') : null
    const root = keep ? el : h('div')
    root.className = cls('item item--frame', selected && 'is-selected', it.locked && 'is-locked')
    place(root, it, index)
    if (keep) return root
    const title = editing
      ? editor(it, 'frame__title', 'Frame title')
      : h('div', { class: 'frame__title', dataset: { id: it.id }, text: it.text || 'Frame' })
    if (editing) title.dataset.id = it.id
    root.replaceChildren(title, h('div', { class: 'frame__sheet', dataset: { frameSheet: it.id } }))
    return root
  }

  function paintPath(_el, it, { index, selected }) {
    const root = svg(
      'svg',
      { class: cls('item item--path', selected && 'is-selected'), 'data-id': it.id, width: it.w, height: it.h, 'aria-hidden': 'true' },
      svg('path', { class: 'path__hit', d: strokePath(it), 'stroke-width': it.width + 12 }),
      svg('path', { class: 'path__stroke', d: strokePath(it), 'stroke-width': it.width }),
    )
    place(root, it, index)
    return root
  }

  return {
    render,
    node: (id) => nodes.get(id)?.el || null,
    /** The live text editor of an item, if it's being edited. */
    editorOf: (id) => nodes.get(id)?.el.querySelector('.is-editing[contenteditable]') || null,
    /** Repaint everything on the next render (after the font has loaded, for instance). */
    invalidate() {
      for (const n of nodes.values()) n.sig = ''
    },
    destroy() {
      for (const n of nodes.values()) n.el.remove()
      nodes.clear()
    },
  }
}
