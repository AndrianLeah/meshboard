// Undo and redo, in their own panel at the bottom left.
import { h, iconButton } from './ds/index.ts'
import type { Placement } from './ds/index.ts'
import type { Commands } from '../commands/registry.ts'
import type { Store } from '../core/store.ts'

export function createHistory({
  commands,
  store,
  placement = 'right',
}: {
  commands: Commands
  store: Store
  placement?: Placement
}) {
  const make = (id: string) =>
    iconButton({
      icon: commands.icon(id),
      label: commands.label(id),
      shortcut: commands.shortcut(id),
      placement,
      onClick: () => commands.run(id),
    })
  const undo = make('undo')
  const redo = make('redo')
  const root = h(
    'div',
    { class: 'ds-panel ds-bar ds-bar--vertical history', role: 'group', 'aria-label': 'History' },
    undo,
    redo,
  )
  const update = () => {
    undo.disabled = !commands.isEnabled('undo')
    redo.disabled = !commands.isEnabled('redo')
  }
  const off = store.onHistoryChange(update)
  update()
  return { root, update, destroy: off }
}
