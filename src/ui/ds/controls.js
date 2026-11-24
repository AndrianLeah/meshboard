// Design system · controls: buttons, key chips, swatches, chips, avatars, fields.
// Every interactive piece of the app is built from these.
import { h, cls } from './dom.js'
import { icon } from '../icons.js'

/**
 * Square icon button (toolbars, context bar, zoom, dialogs).
 * `label` is the accessible name and the tooltip; `shortcut` (already formatted) shows in the tooltip.
 */
export function iconButton({ icon: name, label, shortcut, onClick, pressed, compact, danger, tooltip = true, placement, class: extra, ...rest }) {
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

/**
 * Text button: `primary` for the one main action of a view, `secondary`, `ghost`.
 * `collapsible` hides the label on narrow screens (the icon stays, the label becomes its name).
 */
export function button({ label, icon: name, variant = 'secondary', large, square, collapsible, onClick, type = 'button', class: extra, ...rest }) {
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

export function setPressed(buttonEl, pressed) {
  buttonEl.setAttribute('aria-pressed', String(Boolean(pressed)))
}

/** Keyboard key(s), e.g. "⌘⇧Z". `onDark` inside tooltips. */
export function kbd(text, { onDark = false } = {}) {
  return h('kbd', { class: cls('ds-kbd', onDark && 'ds-kbd--on-dark'), text })
}

export function separator({ horizontal = false } = {}) {
  return h('hr', { class: cls('ds-separator', horizontal && 'ds-separator--horizontal'), 'aria-hidden': 'true' })
}

/** Colour swatch for one palette key (yellow, blue…): square for sticky colours, round for strokes. */
export function swatch({ color, label, pressed, round, onClick }) {
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

/** Reaction chip: emoji + count; pressed when the viewer reacted. */
export function reactionChip({ emoji, count, pressed, title, onClick, class: extra, ...rest }) {
  return h(
    'button',
    { type: 'button', class: cls('ds-chip', extra), 'aria-pressed': String(Boolean(pressed)), title, onClick, ...rest },
    h('span', { class: 'ds-chip__emoji', text: emoji }),
    h('span', { text: String(count) }),
  )
}

export function iconChip({ icon: name, label, onClick, class: extra, ...rest }) {
  return h(
    'button',
    { type: 'button', class: cls('ds-chip ds-chip--icon', extra), 'aria-label': label, 'data-tooltip': label, onClick, ...rest },
    icon(name),
  )
}

export function avatar({ initials, color, title }) {
  return h('span', { class: 'ds-avatar', vars: { '--avatar': color }, title, text: initials })
}

export function avatarStack(avatars) {
  return h('span', { class: 'ds-avatar-stack' }, avatars)
}

export function field({ label, control }) {
  return h('label', { class: 'ds-field' }, h('span', { class: 'ds-field__label', text: label }), control)
}

export function input({ quiet = false, class: extra, ...attrs }) {
  return h('input', { class: cls('ds-input', quiet && 'ds-input--quiet', extra), ...attrs })
}

export function searchInput(attrs) {
  const el = input({ type: 'search', autocomplete: 'off', spellcheck: 'false', ...attrs })
  return { root: h('div', { class: 'ds-search' }, icon('search'), el), input: el }
}
