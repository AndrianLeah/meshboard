// Teammates' cursors with their names, drawn at a constant size on screen.
import { h, svg } from '../../ui/ds/index.ts'
import { userColor } from '../../core/identity.ts'
import type { Peers } from '../../sync/presence.ts'
import type { User } from '../../core/types.ts'

export function createCursors(layer: HTMLElement, me: User) {
  const nodes = new Map<string, { el: HTMLElement; name: HTMLElement }>() // by peerId

  function make() {
    const arrow = svg(
      'svg',
      { viewBox: '0 0 16 16', width: 18, height: 18, 'aria-hidden': 'true' },
      svg('path', { d: 'M1 1l5.5 14 2-6 6-2z' }),
    )
    const name = h('span', { class: 'cursor__name' })
    const el = h('div', { class: 'cursor' }, arrow, name)
    layer.append(el)
    return { el, name }
  }

  function render(peers: Peers) {
    const seen = new Set<string>()
    for (const [peerId, p] of peers) {
      if (p.x == null || p.y == null || p.uid === me.id) continue
      seen.add(peerId)
      let node = nodes.get(peerId)
      if (!node) {
        node = make()
        nodes.set(peerId, node)
      }
      node.el.style.setProperty('--cursor', userColor(p.uid))
      node.el.style.transform = `translate(${p.x}px, ${p.y}px) scale(var(--inv))`
      node.name.textContent = p.name || 'Anonymous'
    }
    for (const [peerId, node] of nodes) {
      if (!seen.has(peerId)) {
        node.el.remove()
        nodes.delete(peerId)
      }
    }
  }

  return { render, destroy: () => layer.replaceChildren() }
}
