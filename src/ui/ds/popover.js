// Design system · popover: one floating panel at a time, anchored to an element, a rect or a point.
// Menus, palettes, flyouts and the emoji picker all open through here.
import { h, cls } from './dom.js'

let current = null

/**
 * @param {Node} content
 * @param {object} options
 *   anchor: Element | DOMRect | {x, y}
 *   placement: 'top' | 'bottom' | 'left' | 'right' (flips when there is no room)
 *   align: 'start' | 'center' | 'end'
 */
export function openPopover(content, { anchor, placement = 'bottom', align = 'center', offset = 8, className, onClose, label } = {}) {
  closePopover()
  const el = h('div', { class: cls('ds-panel ds-panel--popover ds-popover', className), role: 'dialog', 'aria-label': label }, content)
  document.body.append(el)
  const anchorEl = anchor instanceof Element ? anchor : null
  anchorEl?.setAttribute('aria-expanded', 'true')
  place(el, anchor, placement, align, offset)

  const onPointerDown = (e) => {
    if (el.contains(e.target) || anchorEl?.contains(e.target)) return
    close()
  }
  const onKeyDown = (e) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    close({ restoreFocus: true })
  }
  const onResize = () => close()
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('resize', onResize)

  function close({ restoreFocus = false } = {}) {
    if (current?.el !== el) return
    current = null
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('resize', onResize)
    anchorEl?.setAttribute('aria-expanded', 'false')
    el.remove()
    if (restoreFocus) anchorEl?.focus()
    onClose?.()
  }

  current = { el, close, anchor: anchorEl }
  return current
}

export function closePopover() {
  current?.close()
}

export function popoverOpenFor(anchorEl) {
  return Boolean(current && current.anchor === anchorEl)
}

function rectOf(anchor) {
  if (anchor instanceof Element) return anchor.getBoundingClientRect()
  if (anchor && 'width' in anchor) return anchor
  const x = anchor?.x ?? innerWidth / 2
  const y = anchor?.y ?? innerHeight / 2
  return { left: x, right: x, top: y, bottom: y, width: 0, height: 0 }
}

function place(el, anchor, placement, align, offset) {
  const a = rectOf(anchor)
  const w = el.offsetWidth
  const hgt = el.offsetHeight
  const margin = 8
  const room = {
    top: a.top - offset - margin,
    bottom: innerHeight - a.bottom - offset - margin,
    left: a.left - offset - margin,
    right: innerWidth - a.right - offset - margin,
  }
  const opposite = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }
  const need = placement === 'top' || placement === 'bottom' ? hgt : w
  if (room[placement] < need && room[opposite[placement]] > room[placement]) placement = opposite[placement]

  let x
  let y
  if (placement === 'top' || placement === 'bottom') {
    y = placement === 'top' ? a.top - offset - hgt : a.bottom + offset
    x = align === 'start' ? a.left : align === 'end' ? a.right - w : a.left + a.width / 2 - w / 2
  } else {
    x = placement === 'left' ? a.left - offset - w : a.right + offset
    y = align === 'start' ? a.top : align === 'end' ? a.bottom - hgt : a.top + a.height / 2 - hgt / 2
  }
  x = Math.max(margin, Math.min(x, innerWidth - w - margin))
  y = Math.max(margin, Math.min(y, innerHeight - hgt - margin))
  el.style.left = `${Math.round(x)}px`
  el.style.top = `${Math.round(y)}px`
}
