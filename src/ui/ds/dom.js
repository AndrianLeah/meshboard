// Tiny DOM builder shared by every UI module. Strings become text nodes, never markup.

/**
 * h('button', { class: 'ds-button', onClick, 'aria-label': 'Close' }, icon('close'), 'Close')
 *
 * Props: `class`, `text` (textContent), `vars` (CSS custom properties), `dataset`,
 * `on<Event>` listeners, booleans as present/absent attributes, anything else as an attribute.
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue
    if (key === 'class') el.className = value
    else if (key === 'text') el.textContent = value
    else if (key === 'vars') for (const [name, v] of Object.entries(value)) el.style.setProperty(name, v)
    else if (key === 'dataset') Object.assign(el.dataset, value)
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value)
    else if (value === true) el.setAttribute(key, '')
    else el.setAttribute(key, String(value))
  }
  append(el, children)
  return el
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return parent
}

/** Joins class names, skipping falsy ones. */
export const cls = (...names) => names.filter(Boolean).join(' ')

const SVG_NS = 'http://www.w3.org/2000/svg'
export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v))
  for (const child of children.flat()) if (child) el.append(child)
  return el
}
