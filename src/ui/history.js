// Undo and redo, in their own panel at the bottom left.
import { h, iconButton } from './ds/index.js'

export function createHistory({ commands, store, placement = 'right' }) {
  const make = (id) =>
    iconButton({ icon: commands.get(id).icon, label: commands.label(id), shortcut: commands.shortcut(id), placement, onClick: () => commands.run(id) })
  const undo = make('undo')
  const redo = make('redo')
  const root = h('div', { class: 'ds-panel ds-bar ds-bar--vertical history', role: 'group', 'aria-label': 'History' }, undo, redo)
  const update = () => {
    undo.disabled = !commands.isEnabled('undo')
    redo.disabled = !commands.isEnabled('redo')
  }
  const off = store.onHistoryChange(update)
  update()
  return { root, update, destroy: off }
}
