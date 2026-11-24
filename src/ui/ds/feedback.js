// Design system · feedback: toasts and modal dialogs.
import { h, cls } from './dom.js'
import { iconButton, button, field, input } from './controls.js'

let region = null

export function toast(message, { tone, timeout = 4000 } = {}) {
  if (!region?.isConnected) {
    region = h('div', { class: 'ds-toast-region', role: 'status', 'aria-live': 'polite' })
    document.body.append(region)
  }
  const el = h('div', { class: cls('ds-toast', tone && `ds-toast--${tone}`), text: message })
  region.append(el)
  setTimeout(() => {
    el.classList.add('is-leaving')
    setTimeout(() => el.remove(), 300)
  }, timeout)
}

/** Modal dialog with a title and a close button; resolves when it closes. */
export function openDialog({ title, content, footer, className, onClose }) {
  const dialog = h('dialog', { class: cls('ds-panel ds-panel--dialog ds-dialog', className), 'aria-label': title })
  const close = iconButton({ icon: 'close', label: 'Close', tooltip: false, onClick: () => dialog.close() })
  dialog.append(
    h('header', { class: 'ds-dialog__header' }, h('h2', { class: 'ds-title', text: title }), close),
    content,
    footer && h('p', { class: 'ds-dialog__footer ds-caption', text: footer }),
  )
  dialog.addEventListener('close', () => {
    dialog.remove()
    onClose?.()
  })
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close() // a click on the backdrop
  })
  document.body.append(dialog)
  dialog.showModal()
  return dialog
}

/** Asks for one line of text. Resolves with the trimmed text, or null when cancelled. */
export function promptText({ title, label, value = '', confirm = 'Save', maxlength = 80 }) {
  return new Promise((resolve) => {
    let result = null
    const box = input({ value, maxlength, autocomplete: 'off' })
    const form = h(
      'form',
      { class: 'ds-stack', method: 'dialog' },
      field({ label, control: box }),
      h(
        'div',
        { class: 'ds-dialog__actions' },
        button({ label: 'Cancel', variant: 'ghost', onClick: () => dialog.close() }),
        button({ label: confirm, variant: 'primary', type: 'submit' }),
      ),
    )
    form.addEventListener('submit', () => {
      result = box.value.trim() || null
    })
    const dialog = openDialog({ title, content: form, className: 'ds-dialog--small', onClose: () => resolve(result) })
    box.select()
  })
}
