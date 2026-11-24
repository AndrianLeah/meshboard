// Tiny DOM builder shared by every UI module. Strings become text nodes, never markup.

export type Child = Node | string | number | false | null | undefined | readonly Child[]

/**
 * `class`, `text` (textContent), `vars` (CSS custom properties), `dataset`, `on<Event>`
 * listeners; `true` sets an empty attribute, `false`, null and undefined set nothing, anything
 * else becomes an attribute.
 */
export type Props = {
  class?: string | false | null
  text?: string | null
  vars?: Record<string, string | null | undefined>
  dataset?: Record<string, string>
  [attribute: string]: unknown
}

/** h('button', { class: 'ds-button', onClick, 'aria-label': 'Close' }, icon('close'), 'Close') */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue
    if (key === 'class') el.className = String(value)
    else if (key === 'text') el.textContent = String(value)
    else if (key === 'vars') {
      for (const [name, v] of Object.entries(value as Props['vars'] & object))
        if (v != null) el.style.setProperty(name, v)
    } else if (key === 'dataset') Object.assign(el.dataset, value)
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener)
    } else if (value === true) el.setAttribute(key, '')
    else el.setAttribute(key, String(value))
  }
  append(el, children)
  return el
}

export function append<T extends Element>(parent: T, children: readonly Child[]): T {
  for (const child of children) {
    if (child == null || child === false) continue
    if (Array.isArray(child)) append(parent, child)
    else parent.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return parent
}

/** Joins class names, skipping falsy ones. */
export const cls = (...names: Array<string | false | null | undefined>): string => names.filter(Boolean).join(' ')

type SvgChild = Node | false | null | undefined | readonly SvgChild[]

const SVG_NS = 'http://www.w3.org/2000/svg'
export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | null | undefined | false> = {},
  ...children: SvgChild[]
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, String(v))
  const add = (list: readonly SvgChild[]) => {
    for (const child of list) {
      if (Array.isArray(child)) add(child)
      else if (child) el.append(child as Node)
    }
  }
  add(children)
  return el
}
