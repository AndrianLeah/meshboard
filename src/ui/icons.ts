// The icon set of the mockup (mockup/meshboard-board-ui.figcraft, page Foundations › Icons):
// 24 grid, 1.75 stroke, round caps. Each icon is a list of paths; a path can carry its own fill
// or stroke width.
import { svg } from './ds/dom.ts'
import logoSource from '../../public/favicon.svg?raw'

/** A path: its data, or the data with its own fill or stroke width. */
type PathSpec = string | { d: string; fill?: string; width?: number }

const filled = (d: string): PathSpec => ({ d, fill: 'currentColor' })
const dots = (d: string): PathSpec => ({ d, width: 2.8 })

export const ICONS = {
  select: ['M5 3l14 8-6.2 1.6L9.6 19z'],
  hand: [
    'M8 13V5.5a1.5 1.5 0 0 1 3 0V12 M11 11.5V4.5a1.5 1.5 0 0 1 3 0V12 M14 11.5V5.5a1.5 1.5 0 0 1 3 0v7 M17 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1a6 6 0 0 1-4.7-2.3l-3-3.8a1.6 1.6 0 0 1 2.4-2.1L8 14.5',
  ],
  note: ['M4 4h16v10.5L14.5 20H4z M14 20v-6h6'],
  text: ['M5 7V5h14v2 M12 5v14 M9 19h6'],
  shapes: ['M3 11h9v9H3z M21 8a5 5 0 1 1-10 0a5 5 0 0 1 10 0z'],
  connector: ['M4 19C4 12 9 7.5 17 7.5 M13.5 4l4 3.5-4 3.5'],
  pen: ['M15.5 4.5l4 4L9 19l-5 1 1-5z M13 7l4 4'],
  eraser: [
    'M8 20h12 M5.6 14.6l8.5-8.5a2 2 0 0 1 2.8 0l2.9 2.9a2 2 0 0 1 0 2.8l-6.4 6.4a4 4 0 0 1-2.8 1.2H9.4a2 2 0 0 1-1.4-.6l-2.4-2.4a1.2 1.2 0 0 1 0-1.8z M10 10.2l4.8 4.8',
  ],
  frame: ['M7 3v18 M17 3v18 M3 7h18 M3 17h18'],
  rect: ['M3.5 6h17v12h-17z'],
  ellipse: ['M21 12a9 6.5 0 1 1-18 0a9 6.5 0 0 1 18 0z'],
  triangle: ['M12 4l9 16H3z'],
  diamond: ['M12 3l9 9-9 9-9-9z'],
  undo: ['M9 14L4 9l5-5 M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
  redo: ['M15 14l5-5-5-5 M20 9H9.5a5.5 5.5 0 0 0 0 11H13'],
  minus: ['M5 12h14'],
  plus: ['M12 5v14 M5 12h14'],
  fit: ['M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5'],
  help: ['M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18z M9.5 9.3a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.3-2.5 3.8 M12 17.3v.2'],
  more: [dots('M5 12h.01 M12 12h.01 M19 12h.01')],
  lock: ['M6 11h12v9H6z M8.5 11V8a3.5 3.5 0 0 1 7 0v3'],
  unlock: ['M6 11h12v9H6z M8.5 11V8a3.5 3.5 0 0 1 6.8-1.2'],
  duplicate: ['M8 8h13v13H8z M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3'],
  front: ['M3.5 3.5h11v11h-11z', filled('M9.5 9.5h11v11h-11z')],
  back: [filled('M3.5 3.5h11v11h-11z'), { d: 'M9.5 9.5h11v11h-11z', fill: 'var(--surface)' }],
  trash: ['M4 7h16 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3'],
  link: [
    'M10 14a4 4 0 0 0 5.7 0l3.6-3.6a4 4 0 0 0-5.7-5.7L12 6.3 M14 10a4 4 0 0 0-5.7 0l-3.6 3.6a4 4 0 0 0 5.7 5.7l1.6-1.6',
  ],
  chevron: ['M6 9l6 6 6-6'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  grid: [dots('M5 5h.01 M12 5h.01 M19 5h.01 M5 12h.01 M12 12h.01 M19 12h.01 M5 19h.01 M12 19h.01 M19 19h.01')],
  'arrow-end': ['M4 12h16 M15 7l5 5-5 5'],
  'arrow-both': ['M4 12h16 M15 7l5 5-5 5 M9 7l-5 5 5 5'],
  'line-plain': ['M4 12h16'],
  'line-dashed': ['M4 12h3 M10.5 12h3 M17 12h3'],
  group: ['M3 7V3h4 M17 3h4v4 M21 17v4h-4 M7 21H3v-4 M8 8h5v5H8z M11 11h5v5h-5z'],
  keyboard: ['M2.5 6h19v12h-19z M6 10h.01 M10 10h.01 M14 10h.01 M18 10h.01 M7 14h10'],
  download: ['M12 4v11 M7 10l5 5 5-5 M5 20h14'],
  upload: ['M12 20V9 M7 14l5-5 5 5 M5 4h14'],
  user: ['M16 8a4 4 0 1 1-8 0a4 4 0 0 1 8 0z M4 21a8 8 0 0 1 16 0'],
  install: ['M3 4h18v12H3z M12 7v5.5 M9.5 10L12 12.5 14.5 10 M8 20h8'],
  home: ['M4 11l8-7 8 7v9h-5v-6H9v6H4z'],
  image: ['M4 5h16v14H4z M4 16l4.5-4.5 3.5 3.5 2.5-2.5L20 17 M15.5 9.5h.01'],
  star: ['M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z'],
  list: ['M9 6h11 M9 12h11 M9 18h11', dots('M4.5 6h.01 M4.5 12h.01 M4.5 18h.01')],
  clock: ['M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18z M12 7.5V12l3 2'],
  external: ['M14 4h6v6 M20 4l-9 9 M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
  'sign-out': ['M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3 M10 16l-4-4 4-4 M6 12h10'],
  close: ['M6 6l12 12 M18 6L6 18'],
  search: ['M11 18a7 7 0 1 0 0-14a7 7 0 0 0 0 14z M20 20l-4-4'],
  'reaction-add': [
    'M20.5 12.5A8.5 8.5 0 1 1 11.5 3.5 M8.5 14a4 4 0 0 0 7 0 M9 9.5h.01 M15 9.5h.01 M19 2.5v6 M16 5.5h6',
  ],
  'emoji-recent': ['M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18z M12 7v5l3 2'],
  'emoji-smileys': ['M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18z M8.5 14a4 4 0 0 0 7 0 M9 9.5h.01 M15 9.5h.01'],
  'emoji-people': [
    'M8 13V5.5a1.5 1.5 0 0 1 3 0V12 M11 11.5V4.5a1.5 1.5 0 0 1 3 0V12 M14 11.5V5.5a1.5 1.5 0 0 1 3 0v7 M17 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1a6 6 0 0 1-4.7-2.3l-3-3.8a1.6 1.6 0 0 1 2.4-2.1L8 14.5',
  ],
  'emoji-nature': ['M5 19c0-8 5-14 15-14c0 10-6 15-14 15 M5 19l7-7'],
  'emoji-food': ['M4 11a8 5.5 0 0 1 16 0z M3.5 14.5h17 M5 18h14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z'],
  'emoji-travel': ['M4 17v-4.5L6.5 6h11l2.5 6.5V17z M4 17v2.5 M20 17v2.5 M7.5 13.5h.01 M16.5 13.5h.01'],
  'emoji-activities': [
    'M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18z M5.6 5.6c3.5 3.5 3.5 9.3 0 12.8 M18.4 5.6c-3.5 3.5-3.5 9.3 0 12.8',
  ],
  'emoji-objects': [
    'M9 18h6 M10 21h4 M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2v.2h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z',
  ],
  'emoji-symbols': ['M12 20s-7.5-4.4-7.5-10.2A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.5C19.5 15.6 12 20 12 20z'],
  'emoji-flags': ['M5.5 21V4 M5.5 4.5h12l-2.5 4 2.5 4h-12'],
} satisfies Record<string, PathSpec[]>

export type IconName = keyof typeof ICONS

/** An <svg> for one icon of the set; it takes the text colour (currentColor). */
export function icon(name: IconName): SVGSVGElement {
  const paths: readonly PathSpec[] = ICONS[name]
  if (!paths) throw new Error(`Unknown icon: ${name}`)
  return svg(
    'svg',
    { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' },
    paths.map((p) => {
      const spec = typeof p === 'string' ? { d: p } : p
      return svg('path', {
        d: spec.d,
        fill: spec.fill ?? 'none',
        stroke: 'currentColor',
        'stroke-width': spec.width ?? 1.75,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      })
    }),
  )
}

/** The brand mark (branding/meshboard-icon.vectorcraft), drawn from public/favicon.svg. */
export function logo(size = 28): Element {
  const doc = new DOMParser().parseFromString(logoSource, 'image/svg+xml')
  const el = doc.documentElement
  el.querySelector('title')?.remove()
  for (const node of el.querySelectorAll('[id]')) node.removeAttribute('id')
  el.setAttribute('width', String(size))
  el.setAttribute('height', String(size))
  el.setAttribute('aria-hidden', 'true')
  return document.importNode(el, true)
}
