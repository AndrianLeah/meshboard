// Files and text helpers shared between screens.

export function readJsonFile(file: File | null | undefined): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('No file selected.'))
    if (file.size > 20 * 1024 * 1024) return reject(new Error('The file is too large (20 MB max).'))
    const reader = new FileReader()
    reader.onerror = () => reject(new Error("Couldn't read the file."))
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result)))
      } catch {
        reject(new Error("The file doesn't contain valid JSON."))
      }
    }
    reader.readAsText(file)
  })
}

export function downloadJson(data: unknown, filename: string): void {
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

export function slug(text: string): string {
  return (
    String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'board'
  )
}

export function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  const min = Math.round(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  if (d < 30) return d === 1 ? 'yesterday' : `${d} days ago`
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** The message of something thrown, for showing to people. */
export const errorMessage = (err: unknown, fallback = 'Something went wrong.'): string =>
  err instanceof Error && err.message ? err.message : typeof err === 'string' && err ? err : fallback

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
