// Teammates' cursors with their names, drawn at a constant size on screen.
import { h, svg } from '../../ui/ds/index.js'
import { userColor } from '../../core/identity.js'

export function createCursors(layer, me) {
  const nodes = new Map() // peerId → element

  function make() {
    const arrow = svg('svg', { viewBox: '0 0 16 16', width: 18, height: 18, 'aria-hidden': 'true' }, svg('path', { d: 'M1 1l5.5 14 2-6 6-2z' }))
    const el = h('div', { class: 'cursor' }, arrow, h('span', { class: 'cursor__name' }))
    layer.append(el)
    return el
  }

  /** peers: Map peerId → {uid, name, x, y}. */
  function render(peers) {
    const seen = new Set()
    for (const [peerId, p] of peers) {
      if (p.x == null || p.y == null || p.uid === me.id) continue
      seen.add(peerId)
      let el = nodes.get(peerId)
      if (!el) {
        el = make()
        nodes.set(peerId, el)
      }
      el.style.setProperty('--cursor', userColor(p.uid))
      el.style.transform = `translate(${p.x}px, ${p.y}px) scale(var(--inv))`
      el.lastChild.textContent = p.name || 'Anonymous'
    }
    for (const [peerId, el] of nodes) {
      if (!seen.has(peerId)) {
        el.remove()
        nodes.delete(peerId)
      }
    }
  }

  return { render, destroy: () => layer.replaceChildren() }
}
