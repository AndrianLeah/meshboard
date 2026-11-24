// The right-click menu: the actions on the selection (or on the board), each with its key.
import { showMenu } from './ds/index.js'

export function openContextMenu(point, { commands, board }) {
  const sel = board.selection()
  const item = (id, opts) => commands.menuItem(id, opts)
  const items = sel.length
    ? [
        item('copy'),
        item('cut'),
        item('paste'),
        item('duplicate'),
        'separator',
        item('front'),
        item('forward'),
        item('backward'),
        item('back'),
        'separator',
        sel.length > 1 && item('group'),
        sel.some((it) => it.group) && item('ungroup'),
        item('lock', { label: sel.every((it) => it.locked) ? 'Unlock' : 'Lock' }),
        sel.length === 1 && sel[0].type === 'note' && item('add-reaction'),
        'separator',
        item('delete', { danger: true }),
      ]
    : [item('paste'), item('select-all'), 'separator', item('zoom-fit'), { ...item('toggle-grid'), icon: null, checked: board.view.grid }]
  return showMenu(items.filter(Boolean), { anchor: point, placement: 'bottom', align: 'start', label: 'Actions' })
}
