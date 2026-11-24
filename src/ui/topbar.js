// Top bars: the board (home, title, board menu) on the left; people and Share on the right.
import { h, iconButton, button, logo, avatar, avatarStack, input, showMenu } from './ds/index.js'
import { DEFAULT_TITLE } from '../core/schema.js'
import { initials, userColor } from '../core/identity.js'

const MAX_AVATARS = 5

export function createTopbar({ commands, store, onTitle }) {
  const home = h(
    'button',
    { type: 'button', class: 'topbar__home', 'aria-label': 'All boards', 'data-tooltip': 'All boards', onClick: () => commands.run('home') },
    logo(28),
  )
  const title = input({ quiet: true, class: 'topbar__title', maxlength: 80, 'aria-label': 'Board title', placeholder: DEFAULT_TITLE })
  title.addEventListener('change', () => onTitle(title.value))
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') title.blur()
  })
  const more = iconButton({ icon: 'more', label: 'Board menu', compact: true, 'aria-haspopup': 'menu' })
  more.addEventListener('click', () =>
    showMenu(
      [
        commands.menuItem('export'),
        commands.menuItem('import'),
        'separator',
        commands.menuItem('rename'),
        commands.menuItem('shortcuts'),
        commands.isEnabled('install') && commands.menuItem('install'),
        'separator',
        commands.menuItem('home'),
      ],
      { anchor: more, placement: 'bottom', align: 'start', label: 'Board menu' },
    ),
  )

  const people = h('div', { class: 'topbar__people' })
  const live = h('span', { class: 'ds-visually-hidden', role: 'status' })
  const share = button({ label: 'Share', icon: 'link', variant: 'primary', collapsible: true, onClick: () => commands.run('share') })

  const root = h(
    'header',
    { class: 'topbar' },
    h('div', { class: 'ds-panel ds-bar topbar__board' }, home, title, more),
    h('div', { class: 'ds-panel ds-bar ds-bar--spaced topbar__share' }, people, live, share),
  )

  return {
    root,
    setTitle(t) {
      if (document.activeElement !== title) title.value = t === DEFAULT_TITLE ? '' : t
    },
    /** people: Map uid → name, me first. */
    setPeople(people_, meId) {
      const list = [...people_]
      const shown = list.slice(0, MAX_AVATARS).map(([uid, name]) =>
        avatar({ initials: initials(name), color: userColor(uid), title: uid === meId ? `${name} (you)` : name || 'Anonymous' }),
      )
      if (list.length > MAX_AVATARS) shown.push(avatar({ initials: `+${list.length - MAX_AVATARS}`, title: `${list.length - MAX_AVATARS} more` }))
      people.replaceChildren(avatarStack(shown))
      live.textContent = list.length > 1 ? `${list.length} online` : 'Just you'
      root.classList.toggle('is-live', list.length > 1)
    },
  }
}
