// Install as an app (PWA) and the service worker for offline use.

/** Chromium's install prompt event; not in the DOM typings because it isn't a standard. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferredPrompt: BeforeInstallPromptEvent | null = null
const listeners = new Set<(can: boolean) => void>()
const notify = () => listeners.forEach((fn) => fn(canInstall()))

export function canInstall(): boolean {
  return Boolean(deferredPrompt)
}

/** fn(canInstall) is called whenever installability changes. */
export function onInstallChange(fn: (can: boolean) => void): () => void {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false
  const prompt = deferredPrompt
  deferredPrompt = null
  notify()
  prompt.prompt()
  const { outcome } = await prompt.userChoice
  return outcome === 'accepted'
}

export function setupPwa(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // we show our own install button, when it makes sense
    deferredPrompt = e as BeforeInstallPromptEvent
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
