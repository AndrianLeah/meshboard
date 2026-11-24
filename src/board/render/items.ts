// Draws board items (everything but connectors) as DOM: sticky notes, shapes, text, frames and
// pen strokes. Each node is repainted only when what it shows changes, and keeps its element.
import { h, svg, cls, reactionChip, iconChip } from '../../ui/ds/index.ts'
import { fitText } from '../text-fit.ts'
import type { Store } from '../../core/store.ts'
import type {
  BoxItem,
  ColorKey,
  FrameItem,
  Item,
  NoteItem,
  PathItem,
  ShapeItem,
  ShapeType,
  TextItem,
  User,
} from '../../core/types.ts'

/** The callbacks of the text being edited, provided by the board. */
export interface EditorHooks {
  onInput(id: string, text: string): void
  onKeyDown(id: string, e: KeyboardEvent): void
  onBlur(id: string): void
}

type ItemElement = HTMLElement | SVGSVGElement

interface PaintState {
  index: number
  editing: boolean
  selected: boolean
}

/** Who wrote a note and who reacted, as names ("You" for the viewer). */
interface NoteNames {
  author: string
  reacted: Record<string, string[]>
}

/** SVG outline of a shape in a w × h box, inset by half the stroke. */
export function shapePath(type: ShapeType, w: number, h: number, i = 1): string {
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
function strokePath(it: PathItem): string {
  const sx = it.w / it.ow
  const sy = it.h / it.oh
  const p = it.points
  let d = `M ${p[0] * sx} ${p[1] * sy}`
  for (let i = 2; i < p.length; i += 2) d += ` L ${p[i] * sx} ${p[i + 1] * sy}`
  return d
}

const colorVars = (color: ColorKey) => ({ '--fill': `var(--note-${color})`, '--stroke': `var(--stroke-${color})` })

function place(el: ItemElement, it: BoxItem, index: number) {
  el.style.transform = `translate(${it.x}px, ${it.y}px)`
  el.style.width = `${it.w}px`
  el.style.height = `${it.h}px`
  el.style.zIndex = String(index)
  for (const [k, v] of Object.entries(colorVars(it.color))) el.style.setProperty(k, v)
}

/** Everything a node shows except where it is: when only this stays the same, the node just moves. */
function contentKey(it: BoxItem, state: string): string {
  const { x, y, z, ...rest } = it
  return JSON.stringify([rest, state])
}

/** An editable text box: plain text only, focus and caret handled by the board. */
function editable(
  className: string,
  text: string,
  {
    onInput,
    onKeyDown,
    onBlur,
    label,
  }: { onInput: (text: string) => void; onKeyDown: (e: KeyboardEvent) => void; onBlur: () => void; label: string },
): HTMLDivElement {
  const el = h('div', {
    class: cls(className, 'is-editing'),
    role: 'textbox',
    'aria-label': label,
    'aria-multiline': 'true',
  })
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

interface RenderedNode {
  el: ItemElement | null
  /** the item as last drawn (the store's frozen object: compared by identity) */
  item: Item | null
  state: string
  content: string
  type: Item['type']
}

export function createItemsRenderer(
  layers: { frames: HTMLElement; items: HTMLElement },
  ctx: { store: Store; me: User; editor: EditorHooks },
) {
  const nodes = new Map<string, RenderedNode>()
  const { store, me } = ctx

  function render(list: readonly Item[], { selection, editingId }: { selection: Set<string>; editingId?: string }) {
    const seen = new Set<string>()
    let index = 0
    for (const it of list) {
      if (it.type === 'arrow') continue
      index++
      seen.add(it.id)
      const editing = editingId === it.id
      const selected = selection.has(it.id)
      const state = `${index}|${editing}|${selected}`
      let n = nodes.get(it.id)
      if (n && n.item === it && n.state === state) continue
      if (n && n.type !== it.type) {
        n.el?.remove()
        n = undefined
      }
      if (!n) {
        n = { el: null, item: null, state: '', content: '', type: it.type }
        nodes.set(it.id, n)
      }
      n.item = it
      n.state = state
      const content = contentKey(it, `${editing}|${selected}`)
      if (n.el && n.content === content) {
        // moved or reordered (a drag, a remote move): keep the node and its measured text
        n.el.style.transform = `translate(${it.x}px, ${it.y}px)`
        n.el.style.zIndex = String(index)
        continue
      }
      n.content = content
      const fresh = paint(n.el, it, { index, editing, selected })
      if (fresh !== n.el) {
        n.el?.remove()
        n.el = fresh
      }
      const parent = it.type === 'frame' ? layers.frames : layers.items
      if (fresh.parentNode !== parent) parent.append(fresh)
    }
    for (const [id, n] of nodes) {
      if (!seen.has(id)) {
        n.el?.remove()
        nodes.delete(id)
      }
    }
  }

  function noteNames(it: NoteItem): NoteNames {
    const name = (uid: string) => (uid === me.id ? 'You' : store.userName(uid))
    const reacted: Record<string, string[]> = {}
    for (const [emoji, by] of Object.entries(it.reactions)) reacted[emoji] = Object.keys(by).map(name)
    return { author: name(it.author), reacted }
  }

  // ---------- painters: each returns the item's element, reused when it already exists ----------

  function paint(el: ItemElement | null, it: BoxItem, state: PaintState): ItemElement {
    switch (it.type) {
      case 'note':
        return paintNote(el as HTMLElement | null, it, state)
      case 'text':
        return paintText(el as HTMLElement | null, it, state)
      case 'frame':
        return paintFrame(el as HTMLElement | null, it, state)
      case 'path':
        return paintPath(el as SVGSVGElement | null, it, state)
      default:
        return paintShape(el as HTMLElement | null, it, state)
    }
  }

  const editor = (it: { id: string; text: string }, className: string, label: string) =>
    editable(className, it.text || '', {
      label,
      onInput: (text) => ctx.editor.onInput(it.id, text),
      onKeyDown: (e) => ctx.editor.onKeyDown(it.id, e),
      onBlur: () => ctx.editor.onBlur(it.id),
    })

  /** Keeps a live editor (and its caret) across repaints of the same item. */
  const liveEditor = (el: HTMLElement | null, selector: string) =>
    el ? el.querySelector<HTMLElement>(`${selector}.is-editing`) : null

  function paintNote(el: HTMLElement | null, it: NoteItem, { index, editing, selected }: PaintState): HTMLElement {
    const keep = editing ? liveEditor(el, '.note__text') : null
    const root = el || h('div', { dataset: { id: it.id } })
    root.className = cls(
      'item item--note',
      selected && 'is-selected',
      editing && 'is-editing',
      it.locked && 'is-locked',
    )
    place(root, it, index)
    const names = noteNames(it)
    const footer = h(
      'div',
      { class: 'note__footer' },
      h('span', { class: 'note__author', text: names.author }),
      h(
        'span',
        { class: 'note__reactions' },
        Object.entries(it.reactions).map(([emoji, by]) =>
          reactionChip({
            emoji,
            count: Object.keys(by).length,
            pressed: me.id in by,
            title: `${names.reacted[emoji].join(', ')} reacted with ${emoji}`,
            'data-reaction': emoji,
          }),
        ),
        iconChip({ icon: 'reaction-add', label: 'Add reaction', class: 'note__add', 'data-add-reaction': '' }),
      ),
    )
    if (keep) {
      root.querySelector('.note__footer')?.replaceWith(footer)
      fitNote(root, keep.innerText)
      return root
    }
    const text = editing
      ? editor(it, 'note__text', 'Sticky note text')
      : h('div', { class: 'note__text', text: it.text || '' })
    root.replaceChildren(h('div', { class: 'note__body' }, text), footer)
    // sizes need layout: measure once the node is in the document
    queueMicrotask(() => fitNote(root, it.text || ''))
    return root
  }

  function fitNote(root: HTMLElement, text: string) {
    const body = root.querySelector<HTMLElement>('.note__body')
    const textEl = root.querySelector<HTMLElement>('.note__text')
    if (!body || !textEl || !root.isConnected) return
    textEl.style.fontSize = `${fitText(text, body.clientWidth, body.clientHeight)}px`
  }

  function paintShape(el: HTMLElement | null, it: ShapeItem, { index, editing, selected }: PaintState): HTMLElement {
    const keep = editing ? liveEditor(el, '.shape__label') : null
    const root = el || h('div', { dataset: { id: it.id } })
    root.className = cls(
      'item item--shape',
      `item--${it.type}`,
      selected && 'is-selected',
      editing && 'is-editing',
      it.locked && 'is-locked',
    )
    place(root, it, index)
    const outline = svg(
      'svg',
      { class: 'shape__svg', width: it.w, height: it.h, 'aria-hidden': 'true' },
      svg('path', { class: 'shape__outline', d: shapePath(it.type, it.w, it.h) }),
    )
    if (keep) {
      root.querySelector('.shape__svg')?.replaceWith(outline)
      return root
    }
    const label = editing
      ? editor(it, 'shape__label', 'Shape text')
      : h('div', { class: 'shape__label', text: it.text || '' })
    root.replaceChildren(outline, label)
    return root
  }

  function paintText(el: HTMLElement | null, it: TextItem, { index, editing, selected }: PaintState): HTMLElement {
    const keep = editing ? liveEditor(el, '.text__content') : null
    const root = el || h('div', { dataset: { id: it.id } })
    root.className = cls(
      'item item--text',
      selected && 'is-selected',
      editing && 'is-editing',
      it.locked && 'is-locked',
    )
    place(root, it, index)
    root.style.height = 'auto'
    root.style.minHeight = `${it.h}px`
    root.style.fontSize = `${it.fontSize}px`
    if (keep) return root
    const content = editing
      ? editor(it, 'text__content', 'Text')
      : h('div', { class: 'text__content', text: it.text || '' })
    root.replaceChildren(content)
    return root
  }

  function paintFrame(el: HTMLElement | null, it: FrameItem, { index, editing, selected }: PaintState): HTMLElement {
    const keep = editing ? liveEditor(el, '.frame__title') : null
    const root = el || h('div')
    root.className = cls('item item--frame', selected && 'is-selected', it.locked && 'is-locked')
    place(root, it, index)
    if (keep) return root
    const title = editing
      ? editor(it, 'frame__title', 'Frame title')
      : h('div', { class: 'frame__title', text: it.text || 'Frame' })
    title.dataset.id = it.id
    root.replaceChildren(title, h('div', { class: 'frame__sheet', dataset: { frameSheet: it.id } }))
    return root
  }

  function paintPath(el: SVGSVGElement | null, it: PathItem, { index, selected }: PaintState): SVGSVGElement {
    const root = el || svg('svg', { 'data-id': it.id, 'aria-hidden': 'true' })
    root.setAttribute('class', cls('item item--path', selected && 'is-selected'))
    root.setAttribute('width', String(it.w))
    root.setAttribute('height', String(it.h))
    root.replaceChildren(
      svg('path', { class: 'path__hit', d: strokePath(it), 'stroke-width': it.width + 12 }),
      svg('path', { class: 'path__stroke', d: strokePath(it), 'stroke-width': it.width }),
    )
    place(root, it, index)
    return root
  }

  return {
    render,
    node: (id: string): ItemElement | null => nodes.get(id)?.el || null,
    /** The live text editor of an item, if it's being edited. */
    editorOf: (id: string): HTMLElement | null =>
      nodes.get(id)?.el?.querySelector<HTMLElement>('.is-editing[contenteditable]') || null,
    /** Repaint everything on the next render (after the font has loaded, for instance). */
    invalidate() {
      for (const n of nodes.values()) {
        n.item = null
        n.content = ''
      }
    },
    destroy() {
      for (const n of nodes.values()) n.el?.remove()
      nodes.clear()
    },
  }
}
