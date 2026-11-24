// Flyouts opened from the toolbar.
import { h, iconButton, openPopover } from './ds/index.ts'
import type { Placement, Popover } from './ds/index.ts'
import { SHAPES } from '../core/schema.ts'
import type { Commands } from '../commands/registry.ts'

export function openShapesFlyout(
  anchor: HTMLElement,
  { commands, placement = 'right' }: { commands: Commands; placement?: Placement },
): Popover {
  let popover: Popover | null = null
  const bar = h(
    'div',
    { class: 'ds-bar' },
    SHAPES.map((shape) => {
      const id = `tool.${shape}`
      return iconButton({
        icon: commands.icon(id),
        label: commands.label(id),
        shortcut: commands.shortcut(id),
        pressed: commands.isChecked(id),
        placement: placement === 'right' ? 'bottom' : 'top',
        onClick() {
          commands.run(id)
          popover?.close()
        },
      })
    }),
  )
  popover = openPopover(bar, { anchor, placement, align: 'center', label: 'Shapes' })
  return popover
}
