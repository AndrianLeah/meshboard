// Pan and zoom of the infinite canvas: screen ↔ board coordinates, the dot grid, and the wheel
// (a mouse wheel zooms at the cursor, a trackpad pans and pinches; a preference can force either).
import type { Point, Rect } from '../core/types.ts'

const ZOOM_MIN = 0.1
const ZOOM_MAX = 4
const GRID = 24
const SCROLL_KEY = 'meshboard:scroll'
export const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]
export const SCROLL_MODES = ['auto', 'zoom', 'pan'] as const
/** What the scroll wheel does: decided per device, or always zoom, or always pan. */
export type ScrollMode = (typeof SCROLL_MODES)[number]
export type WheelKind = 'mouse' | 'trackpad'
/** The part of a wheel event the classifier reads (`wheelDeltaY` is non-standard, Blink and WebKit). */
export type WheelSample = Pick<WheelEvent, 'deltaMode' | 'deltaX' | 'deltaY'> & { wheelDeltaY?: number }
/** Where the view is: translation in screen px, and scale. */
export interface ViewState {
  x: number
  y: number
  s: number
}
export type View = ReturnType<typeof createView>

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const isScrollMode = (v: unknown): v is ScrollMode => SCROLL_MODES.includes(v as ScrollMode)

function readScrollMode(): ScrollMode {
  try {
    const v = localStorage.getItem(SCROLL_KEY)
    return isScrollMode(v) ? v : 'auto'
  } catch {
    return 'auto'
  }
}

/**
 * Wheel events from a trackpad come in streams of small, often fractional, two-axis deltas;
 * a mouse wheel sends whole notches (WebKit/Blink report them as multiples of 120 in the
 * legacy wheelDelta, Firefox in lines). A decision sticks for the rest of a stream.
 * `now` is the clock, in ms.
 */
export function createWheelClassifier(now: () => number = () => performance.now()): (e: WheelSample) => WheelKind {
  let last = -Infinity
  let kind: WheelKind = 'mouse'
  return (e) => {
    const t = now()
    if (t - last < 250) {
      last = t
      return kind
    }
    last = t
    if (e.deltaMode !== 0) kind = 'mouse'
    else if (e.deltaX !== 0) kind = 'trackpad'
    else if (typeof e.wheelDeltaY === 'number' && e.wheelDeltaY !== 0) {
      kind = e.wheelDeltaY === -3 * e.deltaY || Math.abs(e.wheelDeltaY) % 120 !== 0 ? 'trackpad' : 'mouse'
    } else kind = Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 40 ? 'mouse' : 'trackpad'
    return kind
  }
}

/**
 * `viewport` receives input and shows the dot grid; `world` is the element pan and zoom transform.
 */
export function createView(
  viewport: HTMLElement,
  world: HTMLElement,
  { onChange }: { onChange?: (view: ViewState) => void } = {},
) {
  const r0 = viewport.getBoundingClientRect()
  const v: ViewState = { x: r0.width / 2, y: r0.height / 2, s: 1 }
  let grid = true
  let scrollMode = readScrollMode()
  const classify = createWheelClassifier()

  function apply() {
    world.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.s})`
    world.style.setProperty('--inv', String(1 / v.s))
    // fewer dots when zoomed out, so the grid never turns into noise
    let step = GRID * v.s
    while (step < 12) step *= 4
    viewport.style.setProperty('--grid-size', `${step}px`)
    viewport.style.setProperty('--grid-x', `${v.x}px`)
    viewport.style.setProperty('--grid-y', `${v.y}px`)
    viewport.classList.toggle('has-grid', grid)
    onChange?.({ ...v })
  }

  const rect = () => viewport.getBoundingClientRect()

  function toWorld(clientX: number, clientY: number): Point {
    const r = rect()
    return { x: (clientX - r.left - v.x) / v.s, y: (clientY - r.top - v.y) / v.s }
  }

  /** Board point → client (page) coordinates. */
  function toClient(p: Point): Point {
    const r = rect()
    return { x: r.left + v.x + p.x * v.s, y: r.top + v.y + p.y * v.s }
  }

  /** Zooms by `factor` keeping the viewport point (px, py) still; the centre by default. */
  function zoomAt(factor: number, px?: number, py?: number) {
    const r = rect()
    const cx = px ?? r.width / 2
    const cy = py ?? r.height / 2
    const s = clamp(v.s * factor, ZOOM_MIN, ZOOM_MAX)
    const wx = (cx - v.x) / v.s
    const wy = (cy - v.y) / v.s
    v.x = cx - wx * s
    v.y = cy - wy * s
    v.s = s
    apply()
  }

  const zoomTo = (s: number) => zoomAt(s / v.s)
  const stepZoom = (dir: 1 | -1) => {
    const next =
      dir > 0 ? ZOOM_STEPS.find((z) => z > v.s + 0.001) : [...ZOOM_STEPS].reverse().find((z) => z < v.s - 0.001)
    zoomTo(next ?? (dir > 0 ? ZOOM_MAX : ZOOM_MIN))
  }

  function panBy(dx: number, dy: number) {
    v.x += dx
    v.y += dy
    apply()
  }

  /** Shows the board rectangle `box` (or the origin at 100% when null), never above 100%. */
  function fit(box: Rect | null, { pad = 80 } = {}) {
    const r = rect()
    if (!box) {
      Object.assign(v, { x: r.width / 2, y: r.height / 2, s: 1 })
      return apply()
    }
    const s = clamp(Math.min((r.width - pad * 2) / box.w, (r.height - pad * 2) / box.h, 1), ZOOM_MIN, ZOOM_MAX)
    v.s = s
    v.x = r.width / 2 - (box.x + box.w / 2) * s
    v.y = r.height / 2 - (box.y + box.h / 2) * s
    apply()
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault()
    const r = rect()
    const px = e.clientX - r.left
    const py = e.clientY - r.top
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1
    // ctrlKey is also how browsers report a trackpad pinch
    if (e.ctrlKey || e.metaKey) return zoomAt(Math.exp(-e.deltaY * unit * 0.01), px, py)
    const kind = scrollMode === 'auto' ? classify(e) : scrollMode === 'zoom' ? 'mouse' : 'trackpad'
    if (kind === 'mouse' && !e.shiftKey) return zoomAt(Math.exp(-e.deltaY * unit * 0.002), px, py)
    // shift + wheel scrolls sideways, as everywhere else
    const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX
    const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY
    panBy(-dx * unit, -dy * unit)
  }
  viewport.addEventListener('wheel', onWheel, { passive: false })

  apply()

  return {
    get x() {
      return v.x
    },
    get y() {
      return v.y
    },
    get scale() {
      return v.s
    },
    toWorld,
    toClient,
    zoomAt,
    zoomTo,
    stepZoom,
    panBy,
    fit,
    /** The board rectangle currently on screen. */
    visibleRect(): Rect {
      const r = rect()
      return { x: -v.x / v.s, y: -v.y / v.s, w: r.width / v.s, h: r.height / v.s }
    },
    get grid() {
      return grid
    },
    setGrid(on: boolean) {
      grid = on
      apply()
    },
    get scrollMode() {
      return scrollMode
    },
    setScrollMode(mode: ScrollMode) {
      if (!isScrollMode(mode)) return
      scrollMode = mode
      try {
        localStorage.setItem(SCROLL_KEY, mode)
      } catch {
        /* not remembered, still applied */
      }
    },
    destroy: () => viewport.removeEventListener('wheel', onWheel),
  }
}
