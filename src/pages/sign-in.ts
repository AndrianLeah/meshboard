// Self-hosted screens around the dashboard: asking for a name (AUTH=none), and a short message with
// one action (not signed in, a board you can't open). They reuse the home screen's card.
import { h, button, field, input, logo } from '../ui/ds/index.ts'
import { errorMessage } from '../lib/files.ts'

function card(...children: Node[]): HTMLElement {
  return h(
    'main',
    { class: 'home' },
    h(
      'section',
      { class: 'ds-panel home__panel home__card' },
      h('div', { class: 'home__brand' }, logo(44), h('h1', { class: 'home__title', text: 'Meshboard' })),
      ...children,
    ),
  )
}

/** AUTH=none: a name is all it takes. Resolves once signed in. */
export function renderGuestSignIn(
  root: HTMLElement,
  { orgName, signIn }: { orgName: string; signIn: (name: string) => Promise<void> },
): { close: () => void } {
  document.title = 'Sign in · Meshboard'
  const name = input({ maxlength: 40, autocomplete: 'nickname', placeholder: 'How others will see you' })
  const error = h('p', { class: 'home__error', role: 'alert', hidden: true })
  const go = button({ label: 'Continue', variant: 'primary', large: true, type: 'submit' })
  const form = h(
    'form',
    { class: 'ds-stack' },
    h('p', { class: 'ds-body ds-muted', text: `The whiteboard of ${orgName}. Your boards are kept on this server.` }),
    field({ label: 'Your name', control: name }),
    go,
    error,
  )
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const n = name.value.trim()
    if (!n) {
      error.textContent = 'Enter your name so teammates know who wrote what.'
      error.hidden = false
      return name.focus()
    }
    go.disabled = true
    try {
      await signIn(n)
    } catch (err) {
      error.textContent = errorMessage(err)
      error.hidden = false
      go.disabled = false
    }
  })
  root.replaceChildren(card(form))
  name.focus()
  return { close: () => {} }
}

/** A message with one way forward. */
export function renderMessage(
  root: HTMLElement,
  { title, body, action }: { title: string; body: string; action?: { label: string; run: () => void } },
): { close: () => void } {
  document.title = `${title} · Meshboard`
  root.replaceChildren(
    card(
      h('h2', { class: 'ds-title', text: title }),
      h('p', { class: 'ds-body ds-muted', text: body }),
      action ? button({ label: action.label, variant: 'primary', large: true, onClick: action.run }) : h('span'),
    ),
  )
  return { close: () => {} }
}
