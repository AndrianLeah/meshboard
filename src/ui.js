// Piccoli aiuti condivisi tra schermate.

let toastBox = null

export function toast(message, { timeout = 4000, tone = '' } = {}) {
  if (!toastBox || !toastBox.isConnected) {
    toastBox = document.createElement('div')
    toastBox.className = 'toasts'
    toastBox.setAttribute('role', 'status')
    toastBox.setAttribute('aria-live', 'polite')
    document.body.append(toastBox)
  }
  const t = document.createElement('div')
  t.className = `toast ${tone}`
  t.textContent = message
  toastBox.append(t)
  setTimeout(() => {
    t.classList.add('out')
    setTimeout(() => t.remove(), 300)
  }, timeout)
}

export function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('Nessun file selezionato.'))
    if (file.size > 20 * 1024 * 1024) return reject(new Error('Il file è troppo grande (max 20 MB).'))
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Impossibile leggere il file.'))
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result)))
      } catch {
        reject(new Error('Il file non contiene JSON valido.'))
      }
    }
    reader.readAsText(file)
  })
}

export function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function slug(text) {
  return (
    String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'lavagna'
  )
}

export function relativeTime(ms) {
  const diff = Date.now() - ms
  const min = Math.round(diff / 60000)
  if (min < 1) return 'adesso'
  if (min < 60) return `${min} min fa`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} h fa`
  const d = Math.round(h / 24)
  if (d < 30) return d === 1 ? 'ieri' : `${d} giorni fa`
  return new Date(ms).toLocaleDateString('it-IT')
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
