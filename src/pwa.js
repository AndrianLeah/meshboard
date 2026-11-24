// Install as an app (PWA) and the service worker for offline use.

let deferredPrompt = null
const listeners = new Set()
const notify = () => listeners.forEach((fn) => fn(canInstall()))

export function canInstall() {
  return Boolean(deferredPrompt)
}

/** fn(canInstall) is called whenever installability changes. */
export function onInstallChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export async function promptInstall() {
  if (!deferredPrompt) return false
  const prompt = deferredPrompt
  deferredPrompt = null
  notify()
  prompt.prompt()
  const { outcome } = await prompt.userChoice
  return outcome === 'accepted'
}

export function setupPwa() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // we show our own install button, when it makes sense
    deferredPrompt = e
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    notify()
  })
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker not registered', err))
    })
  }
}
