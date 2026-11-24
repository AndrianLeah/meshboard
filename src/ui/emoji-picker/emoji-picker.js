// The emoji picker: a search over every group, a tab per group, a 9-column grid of 32 px cells,
// and the emoji you use most in a row below. The search keeps the focus: arrows move in the grid,
// Enter picks, Esc closes.
import { h, cls, icon, searchInput, button, openPopover } from '../ds/index.js'
import { EMOJI_GROUPS, countPick, loadEmojis, readCounts, searchText } from './emoji-data.js'

const COLUMNS = 9

/** Opens the picker anchored to `anchor`; `onPick(unicode)` gets the chosen emoji. */
export function openEmojiPicker(anchor, { onPick, placement = 'bottom', align = 'start' }) {
  let data = null
  let failed = false
  let tab = EMOJI_GROUPS[0].key
  let query = ''
  let rows = []
  let active = 0

  const search = searchInput({ placeholder: 'Search emoji', 'aria-label': 'Search emoji', 'aria-controls': 'emoji-grid' })
  const tabs = h('div', { class: 'ds-tabs emoji-picker__tabs', role: 'tablist', 'aria-label': 'Emoji groups' })
  const grid = h('div', { class: 'emoji-picker__grid', id: 'emoji-grid', role: 'listbox', tabindex: '-1' })
  const frequent = h('div', { class: 'emoji-picker__frequent', role: 'group', 'aria-label': 'Frequently used' })
  const content = h('div', { class: 'emoji-picker' }, h('div', { class: 'emoji-picker__search' }, search.root), tabs, grid, frequent)

  const popover = openPopover(content, { anchor, placement, align, label: 'Emoji', className: 'emoji-picker__popover' })

  function pick(unicode) {
    countPick(unicode)
    popover.close()
    onPick(unicode)
  }

  const cell = (e, i, role = 'option') =>
    h('button', {
      type: 'button',
      class: cls('ds-icon-button ds-icon-button--compact ds-emoji emoji-picker__cell', i === active && role === 'option' && 'is-active'),
      role,
      tabindex: '-1',
      id: role === 'option' ? `emoji-${i}` : null,
      'aria-label': e.label,
      'aria-selected': role === 'option' ? String(i === active) : null,
      text: e.unicode,
      onClick: () => pick(e.unicode),
      onPointermove: role === 'option' ? () => highlight(i, false) : null,
      onPointerdown: (ev) => ev.preventDefault(), // keep the focus in the search
    })

  function renderTabs() {
    const groups = data ? data.groups : EMOJI_GROUPS
    tabs.replaceChildren(
      ...groups.map((g) =>
        h(
          'button',
          {
            type: 'button',
            class: 'ds-tab',
            role: 'tab',
            'aria-selected': String(!query && g.key === tab),
            'aria-label': g.label,
            'data-tooltip': g.label,
            disabled: !data,
            onClick() {
              tab = g.key
              query = ''
              search.input.value = ''
              update()
              grid.scrollTop = 0
            },
          },
          icon(g.icon),
        ),
      ),
    )
  }

  function computeRows() {
    if (!data) return []
    const q = searchText(query).trim()
    if (!q) return data.emojis.filter((e) => e.group === tab)
    // names starting with the query first, then a word that does ("rocket" before "pocket rocket")
    const word = ` ${q.split(/\s+/)[0]}`
    return data.emojis
      .filter((e) => e.text.includes(q))
      .map((e) => [e, e.text.startsWith(q) ? 0 : ` ${e.text}`.includes(word) ? 1 : 2])
      .sort((a, b) => a[1] - b[1])
      .map(([e]) => e)
  }

  function renderGrid() {
    if (failed) {
      grid.replaceChildren(
        h(
          'div',
          { class: 'emoji-picker__message' },
          h('p', { class: 'ds-caption', text: "Couldn't load the emoji." }),
          button({ label: 'Try again', variant: 'secondary', onClick: load }),
        ),
      )
      return
    }
    if (!data) return grid.replaceChildren(h('p', { class: 'emoji-picker__message ds-caption', text: 'Loading emoji…' }))
    if (!rows.length) return grid.replaceChildren(h('p', { class: 'emoji-picker__message ds-caption', text: 'No emoji found' }))
    grid.replaceChildren(h('div', { class: 'emoji-picker__cells' }, rows.map((e, i) => cell(e, i))))
    grid.setAttribute('aria-label', query ? 'Search results' : EMOJI_GROUPS.find((g) => g.key === tab)?.label || '')
    search.input.setAttribute('aria-activedescendant', `emoji-${active}`)
  }

  function renderFrequent() {
    const counts = readCounts()
    const top = data
      ? [...new Set(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([u]) => data.find(u)).filter(Boolean))].slice(0, COLUMNS)
      : []
    frequent.hidden = !top.length
    frequent.replaceChildren(...top.map((e, i) => cell(e, i, 'button')))
  }

  function highlight(i, scroll = true) {
    if (!rows.length) return
    active = Math.max(0, Math.min(rows.length - 1, i))
    for (const el of grid.querySelectorAll('.is-active')) {
      el.classList.remove('is-active')
      el.setAttribute('aria-selected', 'false')
    }
    const el = grid.querySelector(`#emoji-${active}`)
    if (!el) return
    el.classList.add('is-active')
    el.setAttribute('aria-selected', 'true')
    search.input.setAttribute('aria-activedescendant', el.id)
    if (scroll) el.scrollIntoView({ block: 'nearest' })
  }

  function update() {
    rows = computeRows()
    active = 0
    renderTabs()
    renderGrid()
  }

  search.input.addEventListener('input', () => {
    query = search.input.value
    update()
    grid.scrollTop = 0
  })
  search.input.addEventListener('keydown', (e) => {
    const moves = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLUMNS, ArrowUp: -COLUMNS }
    if (e.key in moves) {
      e.preventDefault()
      highlight(active + moves[e.key])
    } else if (e.key === 'Enter' && rows[active]) {
      e.preventDefault()
      pick(rows[active].unicode)
    }
  })

  async function load() {
    failed = false
    update()
    try {
      data = await loadEmojis()
    } catch (err) {
      console.error('Emoji data failed to load', err)
      failed = true
    }
    tab = data?.groups[0]?.key || tab
    update()
    renderFrequent()
  }

  renderFrequent()
  load()
  search.input.focus()
  return popover
}
