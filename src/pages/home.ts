// Home: your name, a new board, join from a link, open an exported file, recent boards.
import { h, button, iconButton, field, input, logo } from '../ui/ds/index.ts'
import { getRecent, forgetRecent, parseToken } from '../core/identity.ts'
import { isExport } from '../core/transfer.ts'
import { errorMessage, readJsonFile, relativeTime } from '../lib/files.ts'
import { canInstall, onInstallChange, promptInstall } from '../app/pwa.ts'
import type { BoardExport, BoardToken, User } from '../core/types.ts'

export interface HomeOptions {
  user: User
  /** the token in the URL, when the page was opened from an invite */
  parsed: BoardToken | null
  /** joins a board */
  enter: (token: string, name: string) => void
  /** makes a new board, from an export when there is one */
  create: (name: string, data?: BoardExport) => void
  /** the source code link, when the build knows it */
  repoUrl: string
}

export function renderHome(
  root: HTMLElement,
  { user, parsed, enter, create, repoUrl }: HomeOptions,
): { close: () => void } {
  document.title = 'Meshboard'
  let offInstall = () => {}
  const name = input({
    value: user.name || '',
    maxlength: 40,
    autocomplete: 'nickname',
    placeholder: 'How others will see you',
  })
  const error = h('p', { class: 'home__error', role: 'alert', hidden: true })

  const showError = (msg: string) => {
    error.textContent = msg
    error.hidden = !msg
  }
  function requireName() {
    const n = name.value.trim()
    if (!n) {
      showError('Enter your name so teammates know who wrote what.')
      name.focus()
      return null
    }
    showError('')
    return n
  }
  const withName = (fn: (name: string) => void) => () => {
    const n = requireName()
    if (n) fn(n)
  }

  // invited: one action. Otherwise: create, join from a link, open a file
  let actions
  if (parsed) {
    const join = button({
      label: 'Join the board',
      variant: 'primary',
      large: true,
      onClick: withName((n) => enter(parsed.token, n)),
    })
    name.addEventListener('keydown', (e) => e.key === 'Enter' && join.click())
    actions = h(
      'div',
      { class: 'ds-stack' },
      h('p', { class: 'ds-body', text: "You've been invited to a board." }),
      join,
    )
  } else {
    const link = input({ placeholder: '…or paste an invite link', 'aria-label': 'Invite link' })
    const joinForm = h('form', { class: 'home__join' }, link, button({ label: 'Join', type: 'submit' }))
    joinForm.addEventListener('submit', (e) => {
      e.preventDefault()
      const p = parseToken(link.value)
      if (!p) return showError("That doesn't look like a Meshboard invite link.")
      withName((n) => enter(p.token, n))()
    })
    const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true })
    file.addEventListener('change', async () => {
      const f = file.files?.[0]
      file.value = ''
      if (!f) return
      try {
        const data = await readJsonFile(f)
        if (!isExport(data)) throw new Error("This file isn't a Meshboard export.")
        create(name.value.trim(), data)
      } catch (err) {
        showError(errorMessage(err))
      }
    })
    const install = button({
      label: 'Install as app',
      icon: 'install',
      variant: 'ghost',
      class: 'home__install',
      onClick: () => promptInstall(),
    })
    install.hidden = !canInstall()
    offInstall = onInstallChange((can) => (install.hidden = !can))
    actions = h(
      'div',
      { class: 'ds-stack' },
      button({ label: 'Create a new board', variant: 'primary', large: true, onClick: withName((n) => create(n)) }),
      joinForm,
      button({
        label: 'Open an exported file',
        icon: 'upload',
        variant: 'ghost',
        onClick: withName(() => file.click()),
      }),
      install,
      file,
    )
  }

  const recent = h('ul', { class: 'home__recent-list' })
  const recentPanel = h(
    'section',
    { class: 'ds-panel home__panel home__recent' },
    h('h2', { class: 'ds-overline', text: 'Recent boards in this browser' }),
    recent,
  )
  function renderRecent() {
    const list = getRecent()
    recentPanel.hidden = !list.length
    recent.replaceChildren(
      ...list.map((r) =>
        h(
          'li',
          { class: 'home__recent-item' },
          h(
            'button',
            { type: 'button', class: 'home__recent-open', onClick: withName((n) => enter(r.token, n)) },
            h('span', { class: 'ds-heading', text: r.title }),
            h('span', { class: 'ds-caption', text: relativeTime(r.opened) }),
          ),
          iconButton({
            icon: 'close',
            label: `Remove ${r.title} from the list (its data stays in this browser)`,
            compact: true,
            tooltip: false,
            onClick() {
              forgetRecent(r.token)
              renderRecent()
            },
          }),
        ),
      ),
    )
  }
  renderRecent()

  const foot = h('p', { class: 'home__foot ds-caption' }, "Open source · your data stays in the participants' browsers")
  if (repoUrl) foot.append(' · ', h('a', { href: repoUrl, target: '_blank', rel: 'noopener', text: 'source' }))

  const page = h(
    'main',
    { class: 'home' },
    h(
      'section',
      { class: 'ds-panel home__panel home__card' },
      h('div', { class: 'home__brand' }, logo(44), h('h1', { class: 'home__title', text: 'Meshboard' })),
      h('p', {
        class: 'ds-body ds-muted',
        text: 'A whiteboard for your team. No server, no accounts: browsers talk to each other directly.',
      }),
      field({ label: 'Your name', control: name }),
      actions,
      error,
    ),
    recentPanel,
    foot,
  )
  root.replaceChildren(page)
  // focus the name only when it's missing: a focused button on load looks already pressed
  if (parsed || !user.name) name.focus()

  return { close: () => offInstall() }
}
