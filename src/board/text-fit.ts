// Sticky-note text auto-fit: the largest size (12–28 px) at which the text fits the note.
// One hidden measuring element, results cached by text and box.
const SIZES = [28, 26, 24, 22, 20, 18, 16, 15, 14, 13, 12]
const CACHE_MAX = 2000

let probe: HTMLDivElement | null = null
const cache = new Map<string, number>()

function getProbe(): HTMLDivElement {
  if (probe?.isConnected) return probe
  probe = document.createElement('div')
  probe.className = 'text-fit-probe'
  probe.setAttribute('aria-hidden', 'true')
  document.body.append(probe)
  return probe
}

/** Font size in px for `text` inside a w × h box (board units). */
export function fitText(text: string, w: number, h: number): number {
  const key = `${Math.round(w)}x${Math.round(h)}:${text}`
  const hit = cache.get(key)
  if (hit) return hit
  const el = getProbe()
  el.style.width = `${Math.max(1, w)}px`
  el.textContent = text || 'M'
  let size = SIZES[SIZES.length - 1]
  for (const s of SIZES) {
    el.style.fontSize = `${s}px`
    if (el.scrollHeight <= h && el.scrollWidth <= w + 1) {
      size = s
      break
    }
  }
  if (cache.size > CACHE_MAX) cache.clear()
  cache.set(key, size)
  return size
}

/** Forget measurements (after the font loads, for instance). */
export function resetTextFit() {
  cache.clear()
}
