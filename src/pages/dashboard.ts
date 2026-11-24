// The home of a self-hosted Meshboard (mockup: page Dashboard): the boards you can open, views in
// the sidebar, groups from the sign-in service, filters, and cards with a preview of each board.
import {
  h,
  button,
  iconButton,
  avatar,
  avatarStack,
  logo,
  icon,
  searchInput,
  showMenu,
  openPopover,
  closePopover,
  toast,
  promptText,
} from '../ui/ds/index.ts'
import type { IconName, MenuItem } from '../ui/ds/index.ts'
import { api } from '../hosted/api.ts'
import type { AccessFilter, BoardSummary, Counts, ListQuery, Me, Sort, View } from '../hosted/api.ts'
import { openShareDialog } from '../ui/share-dialog.ts'
import { initials, userColor } from '../core/identity.ts'
import { isExport } from '../core/transfer.ts'
import { errorMessage, readJsonFile, relativeTime } from '../lib/files.ts'

export interface DashboardOptions {
  me: Me
  orgName: string
  authKind: string
  canSignOut: boolean
  /** opens a board in this tab */
  open: (board: BoardSummary) => void
  signOut: () => void
}

const VIEWS: Array<[View, string, IconName]> = [
  ['all', 'All boards', 'grid'],
  ['recent', 'Recent', 'clock'],
  ['starred', 'Starred', 'star'],
  ['shared', 'Shared with me', 'user'],
  ['trash', 'Trash', 'trash'],
]
const SORTS: Array<[Sort, string]> = [
  ['opened', 'Last opened'],
  ['edited', 'Last edited'],
  ['title', 'Title'],
  ['created', 'Date created'],
]
const EDITED: Array<[number, string]> = [
  [1, 'Today'],
  [7, 'Last 7 days'],
  [30, 'Last 30 days'],
  [90, 'Last 90 days'],
]
const PAGE = 48
const LAYOUT_KEY = 'meshboard:dashboard-layout'

const groupColor = (name: string) => userColor(`group:${name}`)

export function renderDashboard(root: HTMLElement, opts: DashboardOptions): { close: () => void } {
  const { me, orgName } = opts
  document.title = 'Meshboard'
  const state: ListQuery & { view: View; sort: Sort; ownerName?: string } = { view: 'all', sort: 'opened' }
  let layout: 'grid' | 'list' = localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'grid'
  let boards: BoardSummary[] = []
  let total = 0
  let counts: Counts | null = null
  let loading = 0
  let closed = false

  const accessLabel = (b: BoardSummary): [string, 'user' | 'lock'] => {
    if (b.access.level === 'none') return ['Only members', 'lock']
    const who = b.access.group ?? orgName
    return [`${who} can ${b.access.level === 'edit' ? 'edit' : 'view'}`, 'user']
  }

  // ---------- top bar ----------

  const search = searchInput({ placeholder: 'Search boards', 'aria-label': 'Search boards' })
  let searchTimer: ReturnType<typeof setTimeout> | undefined
  search.input.addEventListener('input', () => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      state.q = search.input.value.trim() || undefined
      void refresh()
    }, 200)
  })
  const onSlash = (e: KeyboardEvent) => {
    const typing = e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')
    if (!typing && (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'))) {
      e.preventDefault()
      search.input.focus()
    }
  }
  window.addEventListener('keydown', onSlash)

  const account = h(
    'button',
    { type: 'button', class: 'dash__account', 'aria-haspopup': 'menu', 'aria-label': `Account: ${me.name}` },
    avatar({ initials: initials(me.name), color: userColor(me.id) }),
    h(
      'span',
      { class: 'dash__who' },
      h('span', { class: 'dash__name', text: me.name }),
      me.email && h('span', { class: 'ds-caption', text: me.email }),
    ),
    icon('chevron'),
  )
  account.addEventListener('click', () =>
    showMenu(
      [
        { heading: me.email ?? me.name },
        opts.authKind === 'none' && {
          label: 'Change your name',
          icon: 'user',
          run: async () => {
            const name = await promptText({
              title: 'Your name',
              label: 'How teammates see you',
              value: me.name,
              maxlength: 40,
            })
            if (!name) return
            try {
              await api.guest(name)
              me.name = name
              account.querySelector('.dash__name')!.textContent = name
            } catch (err) {
              toast(errorMessage(err), { tone: 'danger' })
            }
          },
        },
        opts.canSignOut && { label: 'Sign out', icon: 'sign-out', run: () => opts.signOut() },
      ],
      { anchor: account, placement: 'bottom', align: 'end', label: 'Account' },
    ),
  )

  const topbar = h(
    'header',
    { class: 'dash__topbar' },
    h(
      'div',
      { class: 'dash__brand' },
      logo(32),
      h('span', { class: 'dash__product', text: 'Meshboard' }),
      h('span', { class: 'dash__org', text: orgName }),
    ),
    h('div', { class: 'dash__search' }, search.root),
    account,
  )

  // ---------- sidebar ----------

  const nav = h('nav', { class: 'dash__nav', 'aria-label': 'Boards' })
  const groupsNav = h('nav', { class: 'dash__nav', 'aria-label': 'Groups' })
  const signedIn = {
    none: 'Signed in with your name',
    oidc: 'Signed in with your organisation account',
    proxy: 'Signed in through your organisation',
    webhook: 'Signed in through your organisation',
  }[opts.authKind]
  const sidebar = h(
    'aside',
    { class: 'dash__sidebar' },
    nav,
    groupsNav,
    h('p', { class: 'dash__foot ds-caption', text: signedIn ?? '' }),
  )

  function navItem(label: string, iconEl: Node, count: number | undefined, active: boolean, onClick: () => void) {
    return h(
      'button',
      { type: 'button', class: 'dash__nav-item', 'aria-current': active ? 'page' : null, onClick },
      iconEl,
      h('span', { class: 'dash__nav-label', text: label }),
      count !== undefined && count > 0 && h('span', { class: 'dash__count', text: String(count) }),
    )
  }

  function renderSidebar() {
    nav.replaceChildren(
      ...VIEWS.map(([view, label, ic]) =>
        navItem(label, icon(ic), counts?.[view], state.view === view && !state.group, () => {
          state.view = view
          state.group = undefined
          void refresh()
        }),
      ),
    )
    const groups = counts?.groups ?? []
    groupsNav.hidden = !groups.length
    groupsNav.replaceChildren(
      h('h2', { class: 'ds-overline dash__nav-heading', text: 'Groups' }),
      ...groups.map((g) =>
        navItem(
          g.name,
          h('span', { class: 'dash__dot', vars: { '--dot': groupColor(g.name) } }),
          g.count,
          state.group === g.name,
          () => {
            state.view = 'all'
            state.group = g.name
            void refresh()
          },
        ),
      ),
    )
  }

  // ---------- header and filters ----------

  const title = h('h1', { class: 'dash__title', text: 'All boards' })
  const subtitle = h('p', { class: 'ds-body ds-muted dash__subtitle' })
  const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true })
  file.addEventListener('change', async () => {
    const f = file.files?.[0]
    file.value = ''
    if (!f) return
    try {
      const data = await readJsonFile(f)
      if (!isExport(data)) throw new Error("This file isn't a Meshboard export.")
      opts.open(await api.create({ template: data }))
    } catch (err) {
      toast(errorMessage(err), { tone: 'danger' })
    }
  })
  const create = button({
    label: 'New board',
    icon: 'plus',
    variant: 'primary',
    onClick: async () => {
      try {
        opts.open(await api.create(state.group ? { group: state.group, access: 'edit' } : {}))
      } catch (err) {
        toast(errorMessage(err), { tone: 'danger' })
      }
    },
  })
  const header = h(
    'div',
    { class: 'dash__header' },
    h('div', { class: 'dash__titles' }, title, subtitle),
    button({ label: 'Import', icon: 'upload', onClick: () => file.click() }),
    create,
    file,
  )

  const filters = h('div', { class: 'dash__filters', role: 'toolbar', 'aria-label': 'Filters' })

  function chip(
    key: string,
    value: string,
    active: boolean,
    onOpen: (anchor: HTMLElement) => void,
    onClear?: () => void,
  ) {
    const el = h(
      'button',
      { type: 'button', class: 'dash__chip', 'aria-haspopup': 'menu', 'data-active': active ? '' : null },
      h('span', { class: 'dash__chip-key', text: key }),
      h('span', { class: 'dash__chip-value', text: value }),
      active && onClear ? null : icon('chevron'),
    )
    el.addEventListener('click', () => onOpen(el))
    if (!active || !onClear) return el
    const clear = iconButton({
      icon: 'close',
      label: `Clear ${key.toLowerCase()}`,
      compact: true,
      tooltip: false,
      onClick: onClear,
    })
    return h('span', { class: 'dash__chip-group', 'data-active': '' }, el, clear)
  }

  function ownerPicker(anchor: HTMLElement) {
    const box = searchInput({ placeholder: 'Find a person', 'aria-label': 'Find a person' })
    const list = h('div', { class: 'ds-menu dash__people', role: 'menu' })
    const pick = (owner: string | undefined, name?: string) => {
      state.owner = owner
      state.ownerName = name
      closePopover()
      void refresh()
    }
    const row = (label: string, checked: boolean, onClick: () => void, lead?: Node) =>
      h(
        'button',
        { type: 'button', class: 'ds-menu__item', role: 'menuitemradio', 'aria-checked': String(checked), onClick },
        lead ?? h('span', { class: 'ds-menu__icon-space' }),
        h('span', { class: 'ds-menu__label', text: label }),
        checked && icon('check'),
      )
    async function fill(q: string) {
      let people: Awaited<ReturnType<typeof api.people>>['people'] = []
      try {
        people = (await api.people(q)).people.filter((p) => p.id !== me.id)
      } catch {
        /* the fixed rows still work */
      }
      list.replaceChildren(
        row('Anyone', !state.owner, () => pick(undefined)),
        row(
          'Me',
          state.owner === 'me',
          () => pick('me'),
          avatar({ initials: initials(me.name), color: userColor(me.id) }),
        ),
        ...(people.length ? [h('div', { class: 'ds-menu__heading', text: `People at ${orgName}` })] : []),
        ...people.map((p) =>
          row(
            p.name,
            state.owner === p.id,
            () => pick(p.id, p.name),
            avatar({ initials: initials(p.name), color: userColor(p.id) }),
          ),
        ),
      )
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    box.input.addEventListener('input', () => {
      clearTimeout(timer)
      timer = setTimeout(() => void fill(box.input.value), 200)
    })
    void fill('')
    openPopover(h('div', { class: 'dash__picker' }, box.root, list), {
      anchor,
      placement: 'bottom',
      align: 'start',
      label: 'Owner',
    })
    box.input.focus()
  }

  function renderFilters() {
    const ownerValue = state.owner === 'me' ? 'Me' : state.owner ? (state.ownerName ?? 'Someone') : 'Anyone'
    const accessNames: Record<AccessFilter, string> = {
      members: 'Only members',
      org_view: `${orgName} can view`,
      org_edit: `${orgName} can edit`,
      group: 'A group',
    }
    const edited = EDITED.find(([d]) => d === state.edited)
    const any = state.owner || state.access || state.edited || state.q
    filters.replaceChildren(
      chip('Owner', ownerValue, Boolean(state.owner), ownerPicker, () => {
        state.owner = undefined
        void refresh()
      }),
      chip(
        'Access',
        state.access ? accessNames[state.access] : 'Any',
        Boolean(state.access),
        (anchor) =>
          showMenu(
            [
              { label: 'Any', checked: !state.access, run: () => setFilter({ access: undefined }) },
              ...(Object.entries(accessNames) as Array<[AccessFilter, string]>).map(([k, label]) => ({
                label,
                checked: state.access === k,
                run: () => setFilter({ access: k }),
              })),
            ],
            { anchor, placement: 'bottom', align: 'start', label: 'Access' },
          ),
        () => setFilter({ access: undefined }),
      ),
      chip(
        'Edited',
        edited ? edited[1] : 'Any time',
        Boolean(state.edited),
        (anchor) =>
          showMenu(
            [
              { label: 'Any time', checked: !state.edited, run: () => setFilter({ edited: undefined }) },
              ...EDITED.map(([d, label]) => ({
                label,
                checked: state.edited === d,
                run: () => setFilter({ edited: d }),
              })),
            ],
            { anchor, placement: 'bottom', align: 'start', label: 'Edited' },
          ),
        () => setFilter({ edited: undefined }),
      ),
      ...(any
        ? [
            button({
              label: 'Clear filters',
              variant: 'ghost',
              onClick: () => {
                search.input.value = ''
                setFilter({ owner: undefined, access: undefined, edited: undefined, q: undefined })
              },
            }),
          ]
        : []),
      h('span', { class: 'dash__spacer' }),
      chip('Sort by', SORTS.find(([s]) => s === state.sort)![1], false, (anchor) =>
        showMenu(
          SORTS.map(([s, label]): MenuItem => ({
            label,
            checked: state.sort === s,
            run: () => setFilter({ sort: s }),
          })),
          { anchor, placement: 'bottom', align: 'end', label: 'Sort by' },
        ),
      ),
      h(
        'div',
        { class: 'dash__layout', role: 'group', 'aria-label': 'Layout' },
        iconButton({
          icon: 'grid',
          label: 'Grid',
          compact: true,
          pressed: layout === 'grid',
          onClick: () => setLayout('grid'),
        }),
        iconButton({
          icon: 'list',
          label: 'List',
          compact: true,
          pressed: layout === 'list',
          onClick: () => setLayout('list'),
        }),
      ),
    )
  }

  function setFilter(patch: Partial<typeof state>) {
    Object.assign(state, patch)
    void refresh()
  }

  function setLayout(next: 'grid' | 'list') {
    layout = next
    try {
      localStorage.setItem(LAYOUT_KEY, next)
    } catch {
      /* remembered for this visit only */
    }
    renderFilters()
    renderBoards()
  }

  // ---------- boards ----------

  const grid = h('div', { class: 'dash__boards', 'aria-live': 'polite' })
  const more = button({ label: 'Show more', variant: 'ghost', class: 'dash__more', onClick: () => void load(true) })

  function starIcon(on: boolean) {
    const el = icon('star')
    if (on) el.classList.add('is-on')
    return el
  }

  function boardMenu(b: BoardSummary, anchor: HTMLElement) {
    const items: MenuItem[] =
      state.view === 'trash'
        ? [
            { label: 'Restore', icon: 'undo', run: () => act(() => api.restore(b.id), `Restored “${b.title}”`) },
            {
              label: 'Delete forever',
              icon: 'trash',
              danger: true,
              run: () => {
                if (confirm(`Delete “${b.title}” for good? This can't be undone.`))
                  act(() => api.destroy(b.id), `Deleted “${b.title}”`)
              },
            },
          ]
        : [
            { label: 'Open', run: () => opts.open(b) },
            { label: 'Open in a new tab', icon: 'external', run: () => window.open(b.url, '_blank', 'noopener') },
            'separator',
            {
              label: b.starred ? 'Remove star' : 'Star',
              icon: 'star',
              run: () => act(() => api.star(b.id, !b.starred)),
            },
            b.role !== 'viewer' && {
              label: 'Rename',
              icon: 'text',
              run: async () => {
                const t = await promptText({ title: 'Rename board', label: 'Title', value: b.title, maxlength: 200 })
                if (t) act(() => api.update(b.id, { title: t }))
              },
            },
            {
              label: 'Share',
              icon: 'link',
              run: () =>
                openShareDialog(b, { orgName, groups: me.groups, meId: me.id, onChange: () => void refresh() }),
            },
            b.role === 'owner' && 'separator',
            b.role === 'owner' && {
              label: 'Move to trash',
              icon: 'trash',
              danger: true,
              run: () => act(() => api.trash(b.id), `Moved “${b.title}” to the trash`),
            },
          ]
    showMenu(items, { anchor, placement: 'bottom', align: 'end', label: `${b.title} menu` })
  }

  async function act(fn: () => Promise<unknown>, done?: string) {
    try {
      await fn()
      if (done) toast(done)
      await refresh()
    } catch (err) {
      toast(errorMessage(err), { tone: 'danger' })
    }
  }

  function card(b: BoardSummary): HTMLElement {
    const [access, accessIcon] = accessLabel(b)
    const by = b.updatedBy ? (b.updatedBy.id === me.id ? 'you' : b.updatedBy.name) : null
    const meta = `Edited ${relativeTime(b.updatedAt)}${by ? ` by ${by}` : ''}`
    const people = [b.owner, ...b.members.filter((m) => m.id !== b.owner.id)].slice(0, 3)
    const extra = b.memberCount + 1 - people.length
    const thumb = h(
      'div',
      { class: 'dash__thumb' },
      b.preview ? h('img', { src: b.preview, alt: '', loading: 'lazy', decoding: 'async' }) : null,
      b.online > 0 &&
        h('span', { class: 'dash__online' }, h('span', { class: 'dash__online-dot' }), `${b.online} here now`),
    )
    const open = h(
      'a',
      {
        class: 'dash__open',
        href: b.url,
        onClick: (e: MouseEvent) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
          e.preventDefault()
          if (state.view !== 'trash') opts.open(b)
        },
      },
      h('span', { class: 'ds-visually-hidden', text: `Open ${b.title}` }),
    )
    const menuButton = iconButton({ icon: 'more', label: `${b.title}: more`, compact: true, class: 'dash__card-menu' })
    menuButton.addEventListener('click', () => boardMenu(b, menuButton))
    return h(
      'article',
      { class: 'dash__card' },
      thumb,
      h(
        'div',
        { class: 'dash__card-body' },
        h('h3', { class: 'dash__card-title', text: b.title }, b.starred && starIcon(true)),
        h('p', {
          class: 'ds-caption dash__meta',
          text: state.view === 'trash' && b.deletedAt ? `In the trash since ${relativeTime(b.deletedAt)}` : meta,
        }),
        h(
          'div',
          { class: 'dash__card-foot' },
          h('span', { class: 'dash__access ds-caption' }, icon(accessIcon), h('span', { text: access })),
          avatarStack([
            ...people.map((p) => avatar({ initials: initials(p.name), color: userColor(p.id), title: p.name })),
            ...(extra > 0 ? [avatar({ initials: `+${extra}`, title: `${extra} more` })] : []),
          ]),
        ),
      ),
      open,
      menuButton,
    )
  }

  function renderBoards() {
    grid.dataset.layout = layout
    if (!boards.length) {
      const empty =
        state.view === 'trash'
          ? 'The trash is empty.'
          : state.q || state.owner || state.access || state.edited
            ? 'No boards match these filters.'
            : state.view === 'starred'
              ? 'Star a board from its menu to find it here.'
              : state.view === 'shared'
                ? 'Boards others add you to show up here.'
                : 'No boards yet. Create one to get started.'
      grid.replaceChildren(h('p', { class: 'dash__empty ds-body ds-muted', text: empty }))
    } else grid.replaceChildren(...boards.map(card))
    more.hidden = boards.length >= total
  }

  function renderHeader() {
    const view = VIEWS.find(([v]) => v === state.view)!
    title.textContent = state.group ? state.group : view[1]
    const filtered = state.owner || state.access || state.edited || state.q
    subtitle.textContent = filtered
      ? `${total} ${total === 1 ? 'board matches' : 'boards match'} your filters`
      : `${total} ${total === 1 ? 'board' : 'boards'}`
    create.hidden = state.view === 'trash'
  }

  async function load(append = false) {
    const ticket = ++loading
    try {
      const res = await api.boards({ ...state, limit: PAGE, offset: append ? boards.length : 0 })
      if (ticket !== loading || closed) return
      boards = append ? [...boards, ...res.boards] : res.boards
      total = res.total
      renderHeader()
      renderBoards()
    } catch (err) {
      if (!closed) toast(errorMessage(err), { tone: 'danger' })
    }
  }

  async function refresh() {
    renderSidebar()
    renderFilters()
    await Promise.all([
      load(),
      api
        .counts()
        .then((c) => {
          counts = c
          if (!closed) renderSidebar()
        })
        .catch(() => {}),
    ])
  }

  const page = h(
    'div',
    { class: 'dash' },
    topbar,
    h('div', { class: 'dash__body' }, sidebar, h('main', { class: 'dash__main' }, header, filters, grid, more)),
  )
  root.replaceChildren(page)
  void refresh()

  // people opening and closing boards: the "here now" badges stay roughly current
  const poll = setInterval(() => {
    if (document.visibilityState === 'visible' && !document.querySelector('.ds-popover, dialog[open]')) void load()
  }, 30_000)

  return {
    close() {
      closed = true
      clearInterval(poll)
      clearTimeout(searchTimer)
      window.removeEventListener('keydown', onSlash)
      closePopover()
    },
  }
}
