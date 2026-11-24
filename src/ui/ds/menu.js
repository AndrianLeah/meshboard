// Design system · menu: a list of actions with their shortcuts, navigable with the keyboard.
import { h, cls } from './dom.js'
import { icon } from '../icons.js'
import { openPopover } from './popover.js'

/**
 * Items: { label, icon?, hint?, danger?, disabled?, checked?, run } | 'separator' | { heading }
 */
export function createMenu(items, { onPick } = {}) {
  const root = h('div', { class: 'ds-menu', role: 'menu' })
  const buttons = []
  // when some rows have an icon, the others keep its place so the labels line up
  const iconColumn = items.some((item) => item && (item.icon || item.checked != null))
  for (const item of items) {
    if (!item) continue
    if (item === 'separator') {
      root.append(h('hr', { class: 'ds-menu__separator' }))
      continue
    }
    if (item.heading) {
      root.append(h('p', { class: 'ds-menu__heading ds-overline', text: item.heading }))
      continue
    }
    const checkable = item.checked != null
    const b = h(
      'button',
      {
        type: 'button',
        class: cls('ds-menu__item', item.danger && 'ds-menu__item--danger'),
        role: checkable ? 'menuitemcheckbox' : 'menuitem',
        'aria-checked': checkable ? String(Boolean(item.checked)) : null,
        disabled: Boolean(item.disabled),
        tabindex: '-1',
        onClick: () => {
          onPick?.()
          item.run?.()
        },
      },
      checkable
        ? icon(item.checked ? 'check' : 'line-plain')
        : item.icon
          ? icon(item.icon)
          : iconColumn && h('span', { class: 'ds-menu__icon-space', 'aria-hidden': 'true' }),
      h('span', { class: 'ds-menu__label', text: item.label }),
      item.hint && h('span', { class: 'ds-menu__hint', text: item.hint }),
    )
    if (checkable && !item.checked) b.firstChild.style.visibility = 'hidden'
    buttons.push(b)
    root.append(b)
  }

  const enabled = () => buttons.filter((b) => !b.disabled)
  root.addEventListener('keydown', (e) => {
    const list = enabled()
    const i = list.indexOf(document.activeElement)
    const go = (n) => list[(n + list.length) % list.length]?.focus()
    if (e.key === 'ArrowDown') go(i + 1)
    else if (e.key === 'ArrowUp') go(i < 0 ? list.length - 1 : i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(list.length - 1)
    else return
    e.preventDefault()
  })
  root.addEventListener('pointermove', (e) => {
    const b = e.target.closest('.ds-menu__item')
    if (b && !b.disabled && document.activeElement !== b) b.focus({ preventScroll: true })
  })
  root.focusFirst = () => enabled()[0]?.focus()
  return root
}

/** Opens a menu in a popover. Returns the popover handle. */
export function showMenu(items, { anchor, placement = 'bottom', align = 'start', focus = false, label } = {}) {
  let popover = null
  const menu = createMenu(items, { onPick: () => popover?.close() })
  popover = openPopover(menu, { anchor, placement, align, label })
  if (focus) menu.focusFirst()
  return popover
}
