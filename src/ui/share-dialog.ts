// Sharing a self-hosted board: its link, who in the organisation can open it, and the people added
// to it. Only the owner changes access; everyone else sees it (and can leave).
import { h, button, iconButton, avatar, input, openDialog, toast, searchInput } from './ds/index.ts'
import { api } from '../hosted/api.ts'
import type { BoardSummary, Level, Members, MemberInfo } from '../hosted/api.ts'
import { initials, userColor } from '../core/identity.ts'
import { copyText, errorMessage } from '../lib/files.ts'

export interface ShareOptions {
  orgName: string
  groups: readonly string[]
  meId: string
  /** after a change, so the dashboard can refresh */
  onChange?: () => void
}

const LEVELS: Array<[Level, string]> = [
  ['edit', 'can edit'],
  ['view', 'can view'],
]

function select(options: Array<[string, string]>, value: string, label: string): HTMLSelectElement {
  const el = h('select', { class: 'ds-input share__select', 'aria-label': label })
  for (const [v, text] of options) el.append(h('option', { value: v, text, selected: v === value }))
  return el
}

function personRow(p: MemberInfo, side: Node): HTMLElement {
  return h(
    'li',
    { class: 'share__person' },
    avatar({ initials: initials(p.name), color: userColor(p.id), title: p.name }),
    h(
      'span',
      { class: 'share__who' },
      h('span', { class: 'ds-body', text: p.name }),
      p.email && h('span', { class: 'ds-caption', text: p.email }),
    ),
    side,
  )
}

export function openShareDialog(board: BoardSummary, { orgName, groups, meId, onChange }: ShareOptions): void {
  const body = h('div', { class: 'share' }, h('p', { class: 'ds-body ds-muted', text: 'Loading…' }))
  const dialog = openDialog({ title: `Share “${board.title}”`, content: body, className: 'share-dialog' })

  async function load() {
    try {
      render(await api.members(board.id))
    } catch (err) {
      body.replaceChildren(h('p', { class: 'ds-body home__error', text: errorMessage(err) }))
    }
  }

  async function act(fn: () => Promise<unknown>, done?: string) {
    try {
      await fn()
      if (done) toast(done)
      onChange?.()
      await load()
    } catch (err) {
      toast(errorMessage(err), { tone: 'danger' })
    }
  }

  function render(info: Members) {
    const owner = info.yourRole === 'owner'

    // the link
    const link = input({ value: board.url, readonly: true, 'aria-label': 'Board link' })
    const linkRow = h(
      'div',
      { class: 'share__link' },
      link,
      button({
        label: 'Copy link',
        icon: 'link',
        onClick: async () => {
          if (await copyText(board.url)) toast('Link copied. Only people with access can open it.')
          else link.select()
        },
      }),
    )

    // general access: nobody else, the organisation, or one group; viewing or editing
    const audience = info.access.level === 'none' ? 'none' : (info.access.group ?? 'org')
    const audiences: Array<[string, string]> = [
      ['none', 'Only people added'],
      ['org', `Everyone at ${orgName}`],
      ...groups.map((g): [string, string] => [`group:${g}`, `Everyone in ${g}`]),
    ]
    if (info.access.group && !groups.includes(info.access.group))
      audiences.push([`group:${info.access.group}`, `Everyone in ${info.access.group}`])
    const who = select(
      audiences,
      audience === 'none' || audience === 'org' ? audience : `group:${audience}`,
      'Who can open it',
    )
    const level = select(LEVELS, info.access.level === 'view' ? 'view' : 'edit', 'What they can do')
    level.hidden = audience === 'none'
    who.disabled = level.disabled = !owner
    const saveAccess = () => {
      const a = who.value
      level.hidden = a === 'none'
      void act(() =>
        api.update(board.id, {
          access: a === 'none' ? 'none' : (level.value as Level),
          group: a.startsWith('group:') ? a.slice(6) : null,
        }),
      )
    }
    who.addEventListener('change', saveAccess)
    level.addEventListener('change', saveAccess)

    // people
    const people = h('ul', { class: 'share__people' })
    people.append(personRow(info.owner, h('span', { class: 'ds-caption', text: 'Owner' })))
    for (const m of info.members) {
      let side: Node
      if (owner) {
        const role = select(
          [
            ['editor', 'Can edit'],
            ['viewer', 'Can view'],
          ],
          m.role,
          `${m.name}'s access`,
        )
        role.addEventListener('change', () =>
          act(() => api.setMember(board.id, m.id, role.value as 'editor' | 'viewer')),
        )
        side = h(
          'span',
          { class: 'share__side' },
          role,
          iconButton({
            icon: 'close',
            label: `Remove ${m.name}`,
            compact: true,
            onClick: () => act(() => api.removeMember(board.id, m.id), `${m.name} removed`),
          }),
        )
      } else if (m.id === meId) {
        side = button({
          label: 'Leave',
          variant: 'ghost',
          onClick: () =>
            act(async () => {
              await api.removeMember(board.id, meId)
              dialog.close()
            }, 'You left the board'),
        })
      } else side = h('span', { class: 'ds-caption', text: m.role === 'editor' ? 'Can edit' : 'Can view' })
      people.append(personRow(m, side))
    }

    // adding someone: people who have signed in to this Meshboard
    let add: Node = document.createTextNode('')
    if (owner) {
      const search = searchInput({ placeholder: 'Add people by name or email', 'aria-label': 'Add people' })
      const results = h('ul', { class: 'share__results', role: 'listbox', 'aria-label': 'People' })
      let timer: ReturnType<typeof setTimeout> | undefined
      let asked = ''
      search.input.addEventListener('input', () => {
        clearTimeout(timer)
        const q = search.input.value.trim()
        if (!q) return results.replaceChildren()
        timer = setTimeout(async () => {
          asked = q
          try {
            const { people: found } = await api.people(q)
            if (asked !== q) return
            const known = new Set([info.owner.id, ...info.members.map((m) => m.id)])
            const fresh = found.filter((p) => !known.has(p.id))
            results.replaceChildren(
              ...(fresh.length
                ? fresh.map((p) =>
                    personRow(
                      p,
                      button({
                        label: 'Add',
                        onClick: () => act(() => api.setMember(board.id, p.id, 'editor'), `${p.name} can now edit`),
                      }),
                    ),
                  )
                : [h('li', { class: 'ds-caption share__empty', text: 'Nobody with that name has signed in yet.' })]),
            )
          } catch (err) {
            toast(errorMessage(err), { tone: 'danger' })
          }
        }, 200)
      })
      add = h('div', { class: 'share__add' }, search.root, results)
    }

    body.replaceChildren(
      linkRow,
      h(
        'section',
        { class: 'share__section' },
        h('h3', { class: 'ds-overline', text: 'General access' }),
        h('div', { class: 'share__access' }, who, level),
      ),
      h('section', { class: 'share__section' }, h('h3', { class: 'ds-overline', text: 'People' }), add, people),
    )
  }

  void load()
}
