// The right-click menu: the actions on the selection (or on the board), each with its key.
import { showMenu } from './ds/index.ts'
import type { MenuItem, Popover } from './ds/index.ts'
import type { Commands } from '../commands/registry.ts'
import type { Board } from '../board/board.ts'
import type { Point } from '../core/types.ts'

export function openContextMenu(point: Point, { commands, board }: { commands: Commands; board: Board }): Popover {
  const sel = board.selection()
  const item = (id: string, opts?: { label?: string; danger?: boolean }) => commands.menuItem(id, opts)
  const items: MenuItem[] = sel.length
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
        sel.some((it) => Boolean(it.group)) && item('ungroup'),
        item('lock', { label: sel.every((it) => it.locked) ? 'Unlock' : 'Lock' }),
        sel.length === 1 && sel[0].type === 'note' && item('add-reaction'),
        'separator',
        item('delete', { danger: true }),
      ]
    : [
        item('paste'),
        item('select-all'),
        'separator',
        item('zoom-fit'),
        { ...item('toggle-grid'), icon: undefined, checked: board.view.grid },
      ]
  return showMenu(items, { anchor: point, placement: 'bottom', align: 'start', label: 'Actions' })
}
