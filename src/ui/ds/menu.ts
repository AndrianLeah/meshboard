// Design system · menu: a list of actions with their shortcuts, navigable with the keyboard.
import { h, cls } from './dom.ts'
import { icon } from '../icons.ts'
import type { IconName } from '../icons.ts'
import { openPopover } from './popover.ts'
import type { Popover, PopoverOptions } from './popover.ts'

export interface MenuAction {
  label: string
  icon?: IconName
  /** the shortcut, formatted */
  hint?: string
  danger?: boolean
  disabled?: boolean
  /** makes it a checkable row */
  checked?: boolean
  run?: () => void
}

/** A row, a separator, a heading; falsy entries are skipped (handy for conditional rows). */
export type MenuItem = MenuAction | 'separator' | { heading: string } | false | null | undefined

export type Menu = HTMLElement & { focusFirst: () => void }

const isAction = (item: MenuItem): item is MenuAction =>
  Boolean(item) && item !== 'separator' && !('heading' in (item as object))

export function createMenu(
  items: readonly MenuItem[],
  { onPick, label }: { onPick?: () => void; label?: string } = {},
): Menu {
  const root: Menu = Object.assign(h('div', { class: 'ds-menu', role: 'menu', 'aria-label': label }), {
    focusFirst: () => enabled()[0]?.focus(),
  })
  const buttons: HTMLButtonElement[] = []
  // when some rows have an icon, the others keep its place so the labels line up
  const iconColumn = items.filter(isAction).some((item) => item.icon || item.checked != null)
  for (const item of items) {
    if (!item) continue
    if (item === 'separator') {
      root.append(h('hr', { class: 'ds-menu__separator' }))
      continue
    }
    if ('heading' in item) {
      root.append(h('p', { class: 'ds-menu__heading ds-overline', text: item.heading }))
      continue
    }
    const checkable = item.checked != null
    const mark = checkable
      ? icon(item.checked ? 'check' : 'line-plain')
      : item.icon
        ? icon(item.icon)
        : iconColumn && h('span', { class: 'ds-menu__icon-space', 'aria-hidden': 'true' })
    if (checkable && !item.checked && mark) mark.style.visibility = 'hidden'
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
      mark,
      h('span', { class: 'ds-menu__label', text: item.label }),
      item.hint && h('span', { class: 'ds-menu__hint', text: item.hint }),
    )
    buttons.push(b)
    root.append(b)
  }

  const enabled = () => buttons.filter((b) => !b.disabled)
  root.addEventListener('keydown', (e) => {
    const list = enabled()
    const i = list.indexOf(document.activeElement as HTMLButtonElement)
    const go = (n: number) => list[(n + list.length) % list.length]?.focus()
    if (e.key === 'ArrowDown') go(i + 1)
    else if (e.key === 'ArrowUp') go(i < 0 ? list.length - 1 : i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(list.length - 1)
    else return
    e.preventDefault()
  })
  root.addEventListener('pointermove', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('.ds-menu__item')
    if (b && !b.disabled && document.activeElement !== b) b.focus({ preventScroll: true })
  })
  return root
}

/** Opens a menu in a popover. Returns the popover handle. */
export function showMenu(
  items: readonly MenuItem[],
  { anchor, placement = 'bottom', align = 'start', focus = false, label }: PopoverOptions & { focus?: boolean } = {},
): Popover {
  let popover: Popover | null = null
  const menu = createMenu(items, { onPick: () => popover?.close(), label })
  popover = openPopover(menu, { anchor, placement, align, label })
  if (focus) menu.focusFirst()
  return popover
}
