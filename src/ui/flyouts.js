// Flyouts opened from the toolbar.
import { h, iconButton, openPopover } from './ds/index.js'
import { SHAPES } from '../core/schema.js'

export function openShapesFlyout(anchor, { commands, placement = 'right' }) {
  let popover = null
  const bar = h(
    'div',
    { class: 'ds-bar' },
    SHAPES.map((shape) => {
      const id = `tool.${shape}`
      const c = commands.get(id)
      return iconButton({
        icon: c.icon,
        label: c.label,
        shortcut: commands.shortcut(id),
        pressed: commands.isChecked(id),
        placement: placement === 'right' ? 'bottom' : 'top',
        onClick() {
          commands.run(id)
          popover.close()
        },
      })
    }),
  )
  popover = openPopover(bar, { anchor, placement, align: 'center', label: 'Shapes' })
  return popover
}
