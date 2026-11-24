// Zoom controls at the bottom right: out, level (a menu with zoom steps, the grid and the
// mouse-wheel preference), in, fit, and the shortcuts panel.
import { h, iconButton, button, separator, showMenu } from './ds/index.ts'
import type { IconName } from './ds/index.ts'
import type { Commands } from '../commands/registry.ts'
import type { Board } from '../board/board.ts'
import type { ScrollMode, ViewState } from '../board/view.ts'

const WHEEL: Array<[ScrollMode, string]> = [
  ['auto', 'Detect mouse or trackpad'],
  ['zoom', 'Scroll wheel zooms'],
  ['pan', 'Scroll wheel pans'],
]

export function createZoomControls({ commands, board }: { commands: Commands; board: Board }) {
  const make = (id: string, icon?: IconName) =>
    iconButton({
      icon: icon || commands.icon(id),
      label: commands.label(id),
      shortcut: commands.shortcut(id),
      placement: 'top',
      onClick: () => commands.run(id),
    })
  const level = button({
    label: '100%',
    variant: 'ghost',
    class: 'zoom__level',
    'aria-haspopup': 'menu',
    'aria-label': 'Zoom options',
  })
  level.addEventListener('click', () => {
    const v = board.view
    showMenu(
      [
        commands.menuItem('zoom-in'),
        commands.menuItem('zoom-out'),
        commands.menuItem('zoom-reset'),
        commands.menuItem('zoom-fit'),
        commands.menuItem('zoom-selection'),
        'separator',
        { ...commands.menuItem('toggle-grid'), icon: undefined, checked: v.grid },
        'separator',
        { heading: 'Mouse wheel' },
        ...WHEEL.map(([mode, label]) => ({ label, checked: v.scrollMode === mode, run: () => v.setScrollMode(mode) })),
      ],
      { anchor: level, placement: 'top', align: 'end', label: 'Zoom' },
    )
  })
  const root = h(
    'div',
    { class: 'ds-panel ds-bar zoom', role: 'group', 'aria-label': 'Zoom' },
    make('zoom-out'),
    level,
    make('zoom-in'),
    separator(),
    make('zoom-fit'),
    make('shortcuts', 'help'),
  )
  return {
    root,
    update(view: Pick<ViewState, 's'>) {
      const label = level.querySelector('.ds-button__label')
      if (label) label.textContent = `${Math.round(view.s * 100)}%`
    },
  }
}
