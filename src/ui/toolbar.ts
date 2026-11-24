// The tools: navigate (select, hand) and create (sticky, text, shapes, connector, pen, eraser,
// frame). Vertical on the left; a horizontal bar at the bottom on phones.
import { h, icon, iconButton, separator, setPressed } from './ds/index.ts'
import type { IconName, Placement } from './ds/index.ts'
import type { Commands } from '../commands/registry.ts'
import type { ToolId } from '../board/tools/index.ts'
import { isShapeType } from '../core/schema.ts'

const GROUPS = [
  ['select', 'hand'],
  ['note', 'text', 'shapes', 'connector', 'pen', 'eraser', 'frame'],
]

export function createToolbar({
  commands,
  placement = 'right',
  compact = false,
}: {
  commands: Commands
  placement?: Placement
  compact?: boolean
}) {
  const buttons = new Map<string, HTMLButtonElement>()
  let shapeIcon: IconName = 'shapes'
  const root = h('nav', { class: 'ds-panel ds-bar ds-bar--vertical toolbar', 'aria-label': 'Tools' })
  GROUPS.forEach((group, i) => {
    if (i) root.append(separator())
    for (const tool of group) {
      const id = `tool.${tool}`
      const c = commands.get(id)
      const b = iconButton({
        icon: commands.icon(id),
        label: c.label,
        shortcut: commands.shortcut(id),
        placement,
        compact,
        pressed: false,
        onClick: () => commands.run(id),
      })
      if (tool === 'shapes') b.setAttribute('aria-haspopup', 'true')
      buttons.set(id, b)
      root.append(b)
    }
  })

  return {
    root,
    /** The shapes button, where the shapes flyout opens. */
    shapesButton: buttons.get('tool.shapes')!,
    update(tool: ToolId) {
      for (const [id, b] of buttons) setPressed(b, commands.isChecked(id))
      // the shapes button shows the shape in use
      const next: IconName = isShapeType(tool) ? tool : 'shapes'
      if (next !== shapeIcon) {
        shapeIcon = next
        buttons.get('tool.shapes')?.querySelector('svg')?.replaceWith(icon(next))
      }
    },
  }
}
