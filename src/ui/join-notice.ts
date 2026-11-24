// The note in the middle of a board that's still empty after opening its link: the content lives
// with the teammates who have the board, so it says whether one of them is coming and, if not, why.
import { h } from './ds/index.ts'
import type { JoinState } from '../sync/status.ts'

const COPY: Record<Exclude<JoinState, 'connected'>, { title: string; body: string }> = {
  searching: {
    title: 'Looking for teammates…',
    body: 'This board is kept in the browsers of the people who use it, not on a server. It appears as soon as one of them is connected.',
  },
  alone: {
    title: 'Nobody with this board is online',
    body: "Its content is kept in your teammates' browsers. It will load as soon as one of them opens the board: keep this tab open.",
  },
  blocked: {
    title: "Can't connect to your teammates",
    body: "Someone with this board is online, but your networks won't connect to each other. Mobile data and office networks often block direct connections: try another Wi-Fi network.",
  },
  offline: {
    title: "Can't look for teammates",
    body: "The relays that introduce teammates can't be reached. Check your connection: the board will load once you're back online.",
  },
}

export function createJoinNotice() {
  const title = h('h2', { class: 'ds-heading' })
  const body = h('p', { class: 'ds-body ds-muted join-notice__body' })
  const root = h('div', { class: 'ds-panel join-notice', role: 'status', hidden: true }, title, body)
  return {
    root,
    /** Shows what `state` means, or hides the note (null, or connected). */
    set(state: JoinState | null) {
      const copy = state && state !== 'connected' ? COPY[state] : null
      root.hidden = !copy
      if (!copy) return
      title.textContent = copy.title
      body.textContent = copy.body
    },
  }
}
