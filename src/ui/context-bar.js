// The context bar floats 12 px above the selection (below it when there's no room) and offers
// what fits the selected types: colour, text size, line ends and style, order, duplicate, lock,
// delete and the rest of the actions. Hidden while dragging.
import { h, iconButton, button, separator, swatch, showMenu, openPopover } from './ds/index.js'
import { COLOR_KEYS, TEXT_SIZES } from '../core/schema.js'
import { openContextMenu } from './context-menu.js'

const GAP = 12
const COLOR_NAMES = { yellow: 'Yellow', orange: 'Orange', red: 'Red', pink: 'Pink', purple: 'Purple', blue: 'Blue', green: 'Green', gray: 'Gray' }
const SIZE_NAMES = { 16: 'Small', 24: 'Medium', 36: 'Large', 56: 'Huge' }

export function createContextBar({ commands, board, topInset = () => 0 }) {
  const root = h('div', { class: 'ds-panel ds-bar context-bar', role: 'toolbar', 'aria-label': 'Selection', hidden: true })
  let items = []
  let sig = ''

  const action = (id, opts = {}) =>
    iconButton({
      icon: opts.icon || commands.get(id).icon,
      label: opts.label || commands.label(id),
      shortcut: commands.shortcut(id),
      compact: true,
      danger: opts.danger,
      pressed: opts.pressed,
      placement: 'top',
      onClick: () => commands.run(id),
    })

  function colorButton(color, square) {
    const b = swatch({ color, label: 'Colour', round: true, pressed: false })
    b.classList.add('context-bar__color')
    b.setAttribute('aria-haspopup', 'dialog')
    b.addEventListener('click', () => {
      let popover = null
      const grid = h(
        'div',
        { class: 'ds-swatch-grid' },
        COLOR_KEYS.map((key) =>
          swatch({
            color: key,
            label: COLOR_NAMES[key],
            round: !square,
            pressed: key === color,
            onClick() {
              board.setColor(key)
              popover.close()
            },
          }),
        ),
      )
      popover = openPopover(grid, { anchor: b, placement: 'top', label: 'Colour' })
    })
    return b
  }

  function sizeButton(size) {
    const b = button({ label: SIZE_NAMES[size] || `${size}px`, variant: 'ghost', 'aria-haspopup': 'menu', 'data-tooltip': 'Text size' })
    b.addEventListener('click', () =>
      showMenu(
        TEXT_SIZES.map((s) => ({ label: SIZE_NAMES[s], hint: `${s}`, checked: s === size, run: () => board.setTextSize(s) })),
        { anchor: b, placement: 'top', label: 'Text size' },
      ),
    )
    return b
  }

  function connectorButtons(arrows) {
    const both = arrows.every((a) => a.start === 'arrow')
    const dashed = arrows.every((a) => a.dash)
    const ends = iconButton({
      icon: both ? 'arrow-both' : 'arrow-end',
      label: both ? 'Arrow at both ends' : 'Arrow at the end',
      compact: true,
      placement: 'top',
      onClick: () => board.setConnectorStyle({ start: both ? 'none' : 'arrow', end: 'arrow' }),
    })
    const dash = iconButton({
      icon: dashed ? 'line-dashed' : 'line-plain',
      label: dashed ? 'Dashed line' : 'Solid line',
      compact: true,
      placement: 'top',
      onClick: () => board.setConnectorStyle({ dash: !dashed }),
    })
    return [ends, dash]
  }

  function build() {
    const types = new Set(items.map((it) => it.type))
    const colourable = items.filter((it) => it.type !== 'frame')
    const colors = new Set(colourable.map((it) => it.color))
    const locked = items.every((it) => it.locked)
    const parts = []
    if (colourable.length && !locked) {
      parts.push(colorButton(colors.size === 1 ? [...colors][0] : colourable[0].color, types.size === 1 && types.has('note')))
    }
    if (types.size === 1 && types.has('text') && !locked) {
      const sizes = new Set(items.map((it) => it.fontSize))
      parts.push(sizeButton(sizes.size === 1 ? [...sizes][0] : 24))
    }
    if (types.has('arrow') && !locked) parts.push(...connectorButtons(items.filter((it) => it.type === 'arrow')))
    if (parts.length) parts.push(separator())
    if (!locked) parts.push(action('front'), action('back'), action('duplicate'))
    parts.push(action('lock', { icon: locked ? 'unlock' : 'lock', label: locked ? 'Unlock' : 'Lock', pressed: locked }))
    if (!locked) parts.push(action('delete', { danger: true }))
    const more = iconButton({ icon: 'more', label: 'More actions', compact: true, placement: 'top', 'aria-haspopup': 'menu' })
    more.addEventListener('click', () => {
      const r = more.getBoundingClientRect()
      openContextMenu({ x: r.left, y: r.bottom + 4 }, { commands, board })
    })
    parts.push(more)
    root.replaceChildren(...parts)
  }

  function place() {
    const r = board.selectionClientRect()
    if (!r) return
    const w = root.offsetWidth
    const hgt = root.offsetHeight
    let y = r.top - GAP - hgt
    if (y < topInset() + 8) y = r.bottom + GAP
    const x = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8))
    root.style.transform = `translate(${Math.round(x)}px, ${Math.round(Math.min(y, innerHeight - hgt - 8))}px)`
  }

  return {
    root,
    /** state: {items, busy}. */
    update({ items: next = items, busy = false } = {}) {
      items = next
      const hide = !items.length || busy
      root.hidden = hide
      if (hide) return
      const nextSig = JSON.stringify(items.map((it) => [it.type, it.color, it.fontSize, it.start, it.dash, it.locked]))
      if (nextSig !== sig) {
        sig = nextSig
        build()
      }
      place()
    },
    place: () => !root.hidden && place(),

  }
}
