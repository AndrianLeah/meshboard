// Zoom controls at the bottom right: out, level (a menu with zoom steps, the grid and the
// mouse-wheel preference), in, fit, and the shortcuts panel.
import { h, iconButton, button, separator, showMenu } from './ds/index.js'

const WHEEL = [
  ['auto', 'Detect mouse or trackpad'],
  ['zoom', 'Scroll wheel zooms'],
  ['pan', 'Scroll wheel pans'],
]

export function createZoomControls({ commands, board }) {
  const make = (id, icon) =>
    iconButton({ icon: icon || commands.get(id).icon, label: commands.label(id), shortcut: commands.shortcut(id), placement: 'top', onClick: () => commands.run(id) })
  const level = button({ label: '100%', variant: 'ghost', class: 'zoom__level', 'aria-haspopup': 'menu', 'aria-label': 'Zoom options' })
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
        { ...commands.menuItem('toggle-grid'), icon: null, checked: v.grid },
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
    update(view) {
      level.querySelector('.ds-button__label').textContent = `${Math.round(view.s * 100)}%`
    },
  }
}
