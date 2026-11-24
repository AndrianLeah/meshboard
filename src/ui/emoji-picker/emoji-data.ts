// Emoji for the picker, from emojibase-data (MIT), loaded the first time the picker opens and
// filtered down to the emoji this system can actually draw. Modelled on On Page UI's picker.
import type { IconName } from '../icons.ts'

export const EMOJI_FONT = '"Twemoji Mozilla", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'

export interface EmojiGroup {
  key: string
  label: string
  icon: IconName
}

/** emojibase's groups the picker offers, in order, with their tab icons. */
export const EMOJI_GROUPS: readonly EmojiGroup[] = [
  { key: 'smileys-emotion', label: 'Smileys & emotion', icon: 'emoji-smileys' },
  { key: 'people-body', label: 'People & body', icon: 'emoji-people' },
  { key: 'animals-nature', label: 'Animals & nature', icon: 'emoji-nature' },
  { key: 'food-drink', label: 'Food & drink', icon: 'emoji-food' },
  { key: 'travel-places', label: 'Travel & places', icon: 'emoji-travel' },
  { key: 'activities', label: 'Activities', icon: 'emoji-activities' },
  { key: 'objects', label: 'Objects', icon: 'emoji-objects' },
  { key: 'symbols', label: 'Symbols', icon: 'emoji-symbols' },
  { key: 'flags', label: 'Flags', icon: 'emoji-flags' },
]

/** An emoji the picker shows. */
export interface Emoji {
  unicode: string
  label: string
  group: string
  /** what the search reads: the name, the tags and the emoticons, as searchText() */
  text: string
}

export interface EmojiData {
  groups: EmojiGroup[]
  /** in emojibase's order, only those the system draws */
  emojis: Emoji[]
  /** The emoji with or without variation selectors (as a stored count may have it). */
  find: (unicode: string) => Emoji | undefined
}

/** What the picker reads of an entry of emojibase's `compact.json`. */
interface CompactEmoji {
  hexcode: string
  label: string
  unicode: string
  /** none for the regional indicators */
  group?: number
  tags?: string[]
  emoticon?: string | string[]
}

/** Skin tones and hair: they only make up other emoji. */
const COMPONENT_GROUP = 2

/** Lowercase, no accents: what the search compares. */
export const searchText = (...parts: Array<string | undefined>): string =>
  parts
    .filter(Boolean)
    .join(' ')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()

/**
 * The emoji matching `query` across every group: names starting with it first, then names with a
 * word that does ("rocket" before "pocket rocket"), then the rest.
 */
export function searchEmojis<E extends { text: string }>(emojis: readonly E[], query: string): E[] {
  const q = searchText(query).trim()
  if (!q) return []
  const word = ` ${q.split(/\s+/)[0]}`
  const rank = (e: E) => (e.text.startsWith(q) ? 0 : ` ${e.text}`.includes(word) ? 1 : 2)
  return emojis
    .filter((e) => e.text.includes(q))
    .map((e) => ({ e, r: rank(e) }))
    .sort((a, b) => a.r - b.r)
    .map(({ e }) => e)
}

/** Flags made of letters: a country's two, and England's, Scotland's and Wales's tag sequences. */
const isLetterFlag = (e: CompactEmoji) => /^1F1[EF][0-9A-F]-1F1[EF][0-9A-F]$|^1F3F4-E00/.test(e.hexcode)
const bare = (unicode: string) => unicode.replace(/️/g, '')

/** Whether the system draws an emoji whole: in colour whatever the text colour, one emoji wide. */
function emojiTest(): (emoji: string) => boolean {
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!ctx) return () => true
  ctx.canvas.width = ctx.canvas.height = 1
  ctx.font = `100px ${EMOJI_FONT}`
  ctx.textBaseline = 'top'
  ctx.scale(0.01, 0.01)
  const one = ctx.measureText('😀').width
  // the emoji drawn 100 px high into one pixel: the average of its colours
  const pixel = (emoji: string, color: string) => {
    ctx.clearRect(0, 0, 100, 100)
    ctx.fillStyle = color
    ctx.fillText(emoji, 0, 0)
    return ctx.getImageData(0, 0, 1, 1).data.join()
  }
  return (emoji) => {
    const black = pixel(emoji, '#000')
    return black === pixel(emoji, '#fff') && !black.startsWith('0,0,0,') && ctx.measureText(emoji).width < one * 1.5
  }
}

/**
 * The emoji the system draws, worked out once. An emoji from a Unicode version the system doesn't
 * know comes out as a box (or as the emoji it joins), and Windows draws letter flags as letters:
 * each version's first emoji stands for the version, one country flag for all of them, and a ZWJ
 * sequence for itself.
 */
function drawableFilter(emojis: CompactEmoji[], versions: Record<string, string[]>): (e: CompactEmoji) => boolean {
  const version = new Map<string, number>()
  for (const [v, hexcodes] of Object.entries(versions)) for (const hex of hexcodes) version.set(hex, Number(v))
  const first = new Map<number, string>()
  for (const e of emojis) {
    const v = version.get(e.hexcode)
    if (v !== undefined && !first.has(v)) first.set(v, e.unicode)
  }
  const test = emojiTest()
  const newest = [...first.keys()].sort((a, b) => b - a).find((v) => test(first.get(v)!)) ?? Infinity
  const flag = emojis.find(isLetterFlag)
  const flags = !flag || test(flag.unicode)
  const joined = new Map<string, boolean>()
  const whole = (u: string) => {
    if (!u.includes('‍')) return true
    if (!joined.has(u)) joined.set(u, test(u))
    return joined.get(u)!
  }
  return (e) => (version.get(e.hexcode) ?? 0) <= newest && (flags || !isLetterFlag(e)) && whole(e.unicode)
}

async function build(): Promise<EmojiData> {
  const [compact, messages, versions] = await Promise.all([
    import('emojibase-data/en/compact.json').then((m) => m.default as CompactEmoji[]),
    import('emojibase-data/en/messages.json').then(
      (m) => m.default as { groups: Array<{ key: string; order: number }> },
    ),
    import('emojibase-data/versions/emoji.json').then((m) => m.default as Record<string, string[]>),
  ])
  const listed = compact.filter((e) => e.group !== undefined && e.group !== COMPONENT_GROUP)
  const drawn = drawableFilter(listed, versions)
  const keyOf = new Map(messages.groups.map((g) => [g.order, g.key]))
  const emojis: Emoji[] = listed.filter(drawn).map((e) => ({
    unicode: e.unicode,
    label: e.label,
    group: keyOf.get(e.group!) ?? '',
    text: searchText(e.label, ...(e.tags || []), ...[e.emoticon || []].flat()),
  }))
  const used = new Set(emojis.map((e) => e.group))
  const byBare = new Map(emojis.map((e) => [bare(e.unicode), e]))
  return {
    groups: EMOJI_GROUPS.filter((g) => used.has(g.key)),
    emojis,
    find: (unicode) => byBare.get(bare(unicode)),
  }
}

let loading: Promise<EmojiData> | null = null
/** Loads once; tries again after a failure. */
export function loadEmojis(): Promise<EmojiData> {
  if (!loading) {
    loading = build()
    loading.catch(() => {
      loading = null
    })
  }
  return loading
}

// ---------- the emoji you use most, counted in this browser ----------

const COUNTS_KEY = 'meshboard:emoji-counts'

export function readCounts(): Record<string, number> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(COUNTS_KEY) || '{}')
    if (!raw || typeof raw !== 'object') return {}
    return Object.fromEntries(Object.entries(raw).filter(([, n]) => typeof n === 'number')) as Record<string, number>
  } catch {
    return {}
  }
}

export function countPick(unicode: string): void {
  const counts = readCounts()
  counts[unicode] = (counts[unicode] || 0) + 1
  try {
    localStorage.setItem(COUNTS_KEY, JSON.stringify(counts))
  } catch {
    /* not remembered */
  }
}
