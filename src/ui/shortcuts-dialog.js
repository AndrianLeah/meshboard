// The keyboard shortcuts panel, generated from the keymap.
import { h, kbd, openDialog } from './ds/index.js'
import { SHORTCUT_SECTIONS, allShortcutsFor, formatCombo, isApple } from '../commands/keymap.js'

export function openShortcutsDialog() {
  const keysOf = (row) => [...row.commands.map((c) => allShortcutsFor(c)[0]), ...(row.extra || []).map((c) => formatCombo(c))]
  const content = h(
    'div',
    { class: 'shortcuts' },
    SHORTCUT_SECTIONS.map((section) =>
      h(
        'section',
        { class: 'shortcuts__section' },
        h('h3', { class: 'ds-overline', text: section.title }),
        h(
          'dl',
          { class: 'shortcuts__list' },
          section.rows.map((row) => [
            h('dt', { class: 'ds-body', text: row.label }),
            h('dd', {}, kbd(keysOf(row).join(' · '))),
          ]),
        ),
      ),
    ),
  )
  return openDialog({
    title: 'Keyboard shortcuts',
    content,
    className: 'shortcuts-dialog',
    footer: `The shortcuts most whiteboards share, so your muscle memory carries over.${isApple() ? ' ⌘ is Ctrl on Windows and Linux.' : ''}`,
  })
}
