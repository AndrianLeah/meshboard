// The design system's JavaScript side: the only way UI modules build controls.
export { h, cls, svg } from './dom.ts'
export type { Child, Props } from './dom.ts'
export {
  iconButton,
  button,
  setPressed,
  kbd,
  separator,
  swatch,
  reactionChip,
  iconChip,
  avatar,
  avatarStack,
  field,
  input,
  searchInput,
} from './controls.ts'
export type { Placement, IconButtonOptions, ButtonOptions } from './controls.ts'
export { openPopover, closePopover, popoverOpenFor } from './popover.ts'
export type { Anchor, Popover, PopoverOptions } from './popover.ts'
export { createMenu, showMenu } from './menu.ts'
export type { MenuAction, MenuItem } from './menu.ts'
export { installTooltips } from './tooltip.ts'
export { toast, openDialog, promptText } from './feedback.ts'
export { icon, logo } from '../icons.ts'
export type { IconName } from '../icons.ts'
