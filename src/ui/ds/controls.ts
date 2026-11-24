// Design system · controls: buttons, key chips, swatches, chips, avatars, fields.
// Every interactive piece of the app is built from these.
import { h, cls } from './dom.ts'
import type { Props } from './dom.ts'
import { icon } from '../icons.ts'
import type { IconName } from '../icons.ts'
import type { ColorKey } from '../../core/types.ts'

export type Placement = 'top' | 'bottom' | 'left' | 'right'
type Click = (e: MouseEvent) => void

export interface IconButtonOptions extends Props {
  icon: IconName
  /** the accessible name, and the tooltip */
  label: string
  /** already formatted, shown in the tooltip */
  shortcut?: string
  onClick?: Click
  pressed?: boolean
  compact?: boolean
  danger?: boolean
  tooltip?: boolean
  /** where the tooltip goes */
  placement?: Placement
}

/** Square icon button (toolbars, context bar, zoom, dialogs). Other options become attributes. */
export function iconButton({
  icon: name,
  label,
  shortcut,
  onClick,
  pressed,
  compact,
  danger,
  tooltip = true,
  placement,
  class: extra,
  ...rest
}: IconButtonOptions): HTMLButtonElement {
  return h(
    'button',
    {
      type: 'button',
      class: cls('ds-icon-button', compact && 'ds-icon-button--compact', danger && 'ds-icon-button--danger', extra),
      'aria-label': label,
      'aria-pressed': pressed == null ? null : String(Boolean(pressed)),
      'data-tooltip': tooltip ? label : null,
      'data-shortcut': tooltip ? shortcut : null,
      'data-tooltip-placement': placement,
      onClick,
      ...rest,
    },
    icon(name),
  )
}

export interface ButtonOptions extends Props {
  label: string
  icon?: IconName
  /** `primary` for the one main action of a view */
  variant?: 'primary' | 'secondary' | 'ghost'
  large?: boolean
  /** icon only; the label becomes its name */
  square?: boolean
  /** hides the label on narrow screens */
  collapsible?: boolean
  onClick?: Click
  type?: 'button' | 'submit'
}

/** Text button. Other options become attributes. */
export function button({
  label,
  icon: name,
  variant = 'secondary',
  large,
  square,
  collapsible,
  onClick,
  type = 'button',
  class: extra,
  ...rest
}: ButtonOptions): HTMLButtonElement {
  return h(
    'button',
    {
      type,
      class: cls(
        'ds-button',
        `ds-button--${variant}`,
        large && 'ds-button--large',
        square && 'ds-button--square',
        collapsible && 'ds-button--collapsible',
        extra,
      ),
      'aria-label': square ? label : null,
      onClick,
      ...rest,
    },
    name && icon(name),
    !square && h('span', { class: 'ds-button__label', text: label }),
  )
}

export function setPressed(buttonEl: Element, pressed: boolean): void {
  buttonEl.setAttribute('aria-pressed', String(Boolean(pressed)))
}

/** Keyboard key(s), e.g. "⌘⇧Z". `onDark` inside tooltips. */
export function kbd(text: string, { onDark = false } = {}): HTMLElement {
  return h('kbd', { class: cls('ds-kbd', onDark && 'ds-kbd--on-dark'), text })
}

export function separator({ horizontal = false } = {}): HTMLHRElement {
  return h('hr', { class: cls('ds-separator', horizontal && 'ds-separator--horizontal'), 'aria-hidden': 'true' })
}

/** Colour swatch for one palette key: square for sticky colours, round for strokes. */
export function swatch({
  color,
  label,
  pressed,
  round,
  onClick,
}: {
  color: ColorKey
  label: string
  pressed?: boolean
  round?: boolean
  onClick?: Click
}): HTMLButtonElement {
  return h('button', {
    type: 'button',
    class: cls('ds-swatch', round && 'ds-swatch--round'),
    vars: { '--swatch': `var(--note-${color})`, '--swatch-stroke': `var(--stroke-${color})` },
    'aria-label': label,
    'aria-pressed': String(Boolean(pressed)),
    'data-tooltip': label,
    onClick,
  })
}

export interface ReactionChipOptions extends Props {
  emoji: string
  count: number
  /** the viewer reacted with this emoji */
  pressed?: boolean
  title?: string
  onClick?: Click
}

/** Reaction chip: emoji + count. Other options become attributes. */
export function reactionChip({
  emoji,
  count,
  pressed,
  title,
  onClick,
  class: extra,
  ...rest
}: ReactionChipOptions): HTMLButtonElement {
  return h(
    'button',
    { type: 'button', class: cls('ds-chip', extra), 'aria-pressed': String(Boolean(pressed)), title, onClick, ...rest },
    h('span', { class: 'ds-chip__emoji', text: emoji }),
    h('span', { text: String(count) }),
  )
}

export function iconChip({
  icon: name,
  label,
  onClick,
  class: extra,
  ...rest
}: Props & { icon: IconName; label: string; onClick?: Click }): HTMLButtonElement {
  return h(
    'button',
    {
      type: 'button',
      class: cls('ds-chip ds-chip--icon', extra),
      'aria-label': label,
      'data-tooltip': label,
      onClick,
      ...rest,
    },
    icon(name),
  )
}

export function avatar({ initials, color, title }: { initials: string; color?: string; title?: string }): HTMLElement {
  return h('span', { class: 'ds-avatar', vars: { '--avatar': color }, title, text: initials })
}

export function avatarStack(avatars: readonly HTMLElement[]): HTMLElement {
  return h('span', { class: 'ds-avatar-stack' }, avatars)
}

export function field({ label, control }: { label: string; control: Node }): HTMLLabelElement {
  return h('label', { class: 'ds-field' }, h('span', { class: 'ds-field__label', text: label }), control)
}

export function input({ quiet = false, class: extra, ...attrs }: Props & { quiet?: boolean } = {}): HTMLInputElement {
  return h('input', { class: cls('ds-input', quiet && 'ds-input--quiet', extra), ...attrs })
}

export function searchInput(attrs: Props = {}): { root: HTMLElement; input: HTMLInputElement } {
  const el = input({ type: 'search', autocomplete: 'off', spellcheck: 'false', ...attrs })
  return { root: h('div', { class: 'ds-search' }, icon('search'), el), input: el }
}
