// Emoji for the picker, from emojibase-data (MIT), loaded the first time the picker opens and
// filtered down to the emoji this system can actually draw. Modelled on On Page UI's picker.

export const EMOJI_FONT = '"Twemoji Mozilla", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'

/** emojibase's groups the picker offers, in order, with their tab icons. */
export const EMOJI_GROUPS = [
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

/** Skin tones and hair: they only make up other emoji. */
const COMPONENT_GROUP = 2

/** Lowercase, no accents: what the search compares. */
export const searchText = (...parts) =>
  parts
    .filter(Boolean)
    .join(' ')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()

/** Flags made of letters: a country's two, and England's, Scotland's and Wales's tag sequences. */
const isLetterFlag = (e) => /^1F1[EF][0-9A-F]-1F1[EF][0-9A-F]$|^1F3F4-E00/.test(e.hexcode)
const bare = (unicode) => unicode.replace(/️/g, '')

/** Whether the system draws an emoji whole: in colour whatever the text colour, one emoji wide. */
function emojiTest() {
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!ctx) return () => true
  ctx.canvas.width = ctx.canvas.height = 1
  ctx.font = `100px ${EMOJI_FONT}`
  ctx.textBaseline = 'top'
  ctx.scale(0.01, 0.01)
  const one = ctx.measureText('😀').width
  // the emoji drawn 100 px high into one pixel: the average of its colours
  const pixel = (emoji, color) => {
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
function drawableFilter(emojis, versions) {
  const version = new Map()
  for (const [v, hexcodes] of Object.entries(versions)) for (const hex of hexcodes) version.set(hex, Number(v))
  const first = new Map()
  for (const e of emojis) {
    const v = version.get(e.hexcode)
    if (v !== undefined && !first.has(v)) first.set(v, e.unicode)
  }
  const test = emojiTest()
  const newest = [...first.keys()].sort((a, b) => b - a).find((v) => test(first.get(v))) ?? Infinity
  const flag = emojis.find(isLetterFlag)
  const flags = !flag || test(flag.unicode)
  const joined = new Map()
  const whole = (u) => {
    if (!u.includes('‍')) return true
    if (!joined.has(u)) joined.set(u, test(u))
    return joined.get(u)
  }
  return (e) => (version.get(e.hexcode) ?? 0) <= newest && (flags || !isLetterFlag(e)) && whole(e.unicode)
}

async function build() {
  const [compact, messages, versions] = await Promise.all([
    import('emojibase-data/en/compact.json').then((m) => m.default),
    import('emojibase-data/en/messages.json').then((m) => m.default),
    import('emojibase-data/versions/emoji.json').then((m) => m.default),
  ])
  const listed = compact.filter((e) => e.group !== undefined && e.group !== COMPONENT_GROUP)
  const drawn = drawableFilter(listed, versions)
  const keyOf = new Map(messages.groups.map((g) => [g.order, g.key]))
  const emojis = listed.filter(drawn).map((e) => ({
    unicode: e.unicode,
    label: e.label,
    group: keyOf.get(e.group),
    text: searchText(e.label, ...(e.tags || []), ...[e.emoticon || []].flat()),
  }))
  const used = new Set(emojis.map((e) => e.group))
  const byBare = new Map(emojis.map((e) => [bare(e.unicode), e]))
  return {
    groups: EMOJI_GROUPS.filter((g) => used.has(g.key)),
    emojis,
    /** The emoji with or without variation selectors (as a stored count may have it). */
    find: (unicode) => byBare.get(bare(unicode)),
  }
}

let loading = null
/** Loads once; tries again after a failure. */
export function loadEmojis() {
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

export function readCounts() {
  try {
    const raw = JSON.parse(localStorage.getItem(COUNTS_KEY) || '{}')
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

export function countPick(unicode) {
  const counts = readCounts()
  counts[unicode] = (counts[unicode] || 0) + 1
  try {
    localStorage.setItem(COUNTS_KEY, JSON.stringify(counts))
  } catch {
    /* not remembered */
  }
}
