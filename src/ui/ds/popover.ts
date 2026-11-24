// Design system · popover: one floating panel at a time, anchored to an element, a rect or a point.
// Menus, palettes, flyouts and the emoji picker all open through here.
import { h, cls } from './dom.ts'
import type { Placement } from './controls.ts'

export type Align = 'start' | 'center' | 'end'
export type Anchor = Element | DOMRect | { x: number; y: number }

export interface PopoverOptions {
  anchor?: Anchor
  /** flips to the other side when there is no room */
  placement?: Placement
  align?: Align
  /** distance from the anchor, in px */
  offset?: number
  className?: string
  onClose?: () => void
  /** the accessible name */
  label?: string
}

export interface Popover {
  el: HTMLElement
  close: (options?: { restoreFocus?: boolean }) => void
  anchor: HTMLElement | null
}

let current: Popover | null = null

export function openPopover(
  content: Node,
  { anchor, placement = 'bottom', align = 'center', offset = 8, className, onClose, label }: PopoverOptions = {},
): Popover {
  closePopover()
  const el = h(
    'div',
    { class: cls('ds-panel ds-panel--popover ds-popover', className), role: 'dialog', 'aria-label': label },
    content,
  )
  document.body.append(el)
  const anchorEl = anchor instanceof HTMLElement ? anchor : null
  anchorEl?.setAttribute('aria-expanded', 'true')
  place(el, anchor, placement, align, offset)

  const onPointerDown = (e: PointerEvent) => {
    const target = e.target as Node
    if (el.contains(target) || anchorEl?.contains(target)) return
    close()
  }
  const onKeyDown = (e: KeyboardEvent) => {
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

export function closePopover(): void {
  current?.close()
}

export function popoverOpenFor(anchorEl: Element): boolean {
  return Boolean(current && current.anchor === anchorEl)
}

interface Box {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}

function rectOf(anchor: Anchor | undefined): Box {
  if (anchor instanceof Element) return anchor.getBoundingClientRect()
  if (anchor instanceof DOMRect) return anchor
  const x = anchor?.x ?? innerWidth / 2
  const y = anchor?.y ?? innerHeight / 2
  return { left: x, right: x, top: y, bottom: y, width: 0, height: 0 }
}

const OPPOSITE: Record<Placement, Placement> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }

function place(el: HTMLElement, anchor: Anchor | undefined, placement: Placement, align: Align, offset: number) {
  const a = rectOf(anchor)
  const w = el.offsetWidth
  const hgt = el.offsetHeight
  const margin = 8
  const room: Record<Placement, number> = {
    top: a.top - offset - margin,
    bottom: innerHeight - a.bottom - offset - margin,
    left: a.left - offset - margin,
    right: innerWidth - a.right - offset - margin,
  }
  const need = placement === 'top' || placement === 'bottom' ? hgt : w
  if (room[placement] < need && room[OPPOSITE[placement]] > room[placement]) placement = OPPOSITE[placement]

  let x: number
  let y: number
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
