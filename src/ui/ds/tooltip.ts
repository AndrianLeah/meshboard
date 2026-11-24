// Design system · tooltips. One delegated manager for the whole page: any element with
// data-tooltip (and optionally data-shortcut, data-tooltip-placement) gets a dark tooltip
// with the key chip, after a short delay. Touch input never shows them.
import { h } from './dom.ts'
import { kbd } from './controls.ts'

const DELAY = 450

export function installTooltips(root: HTMLElement = document.body): { hide: () => void } {
  const tip = h('div', { class: 'ds-tooltip', role: 'tooltip' })
  document.body.append(tip)
  let target: HTMLElement | null = null
  let timer: ReturnType<typeof setTimeout> | undefined

  function show(el: HTMLElement) {
    tip.replaceChildren(h('span', { text: el.dataset.tooltip }))
    if (el.dataset.shortcut) tip.append(kbd(el.dataset.shortcut, { onDark: true }))
    tip.classList.toggle('ds-tooltip--plain', !el.dataset.shortcut)
    place(el, el.dataset.tooltipPlacement || 'bottom')
    tip.classList.add('is-visible')
  }

  function hide() {
    clearTimeout(timer)
    target = null
    tip.classList.remove('is-visible')
  }

  function place(el: HTMLElement, placement: string) {
    const r = el.getBoundingClientRect()
    const w = tip.offsetWidth
    const t = tip.offsetHeight
    const gap = 8
    let x = r.left + r.width / 2 - w / 2
    let y = r.bottom + gap
    if (placement === 'top' || (placement === 'bottom' && y + t > innerHeight - 8)) y = r.top - gap - t
    if (placement === 'right') {
      x = r.right + gap
      y = r.top + r.height / 2 - t / 2
    }
    if (placement === 'left') {
      x = r.left - gap - w
      y = r.top + r.height / 2 - t / 2
    }
    tip.style.left = `${Math.round(Math.max(8, Math.min(x, innerWidth - w - 8)))}px`
    tip.style.top = `${Math.round(Math.max(8, Math.min(y, innerHeight - t - 8)))}px`
  }

  root.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return
    const el = (e.target as Element).closest?.<HTMLElement>('[data-tooltip]')
    if (!el || el === target) return
    hide()
    target = el
    timer = setTimeout(() => target === el && el.isConnected && show(el), DELAY)
  })
  root.addEventListener('pointerout', (e) => {
    if (target && !target.contains(e.relatedTarget as Node | null)) hide()
  })
  root.addEventListener('pointerdown', hide, true)
  window.addEventListener('blur', hide)
  return { hide }
}
