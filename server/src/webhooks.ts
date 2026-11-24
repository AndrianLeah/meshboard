// Events for your systems, posted to WEBHOOK_URL when it's set: signed, retried a few times, and
// never holding up the request that caused them. Receivers should skip ids they've already seen.
import { randomToken, signatureHeaders } from './util.ts'
import type { Logger } from './util.ts'

export type EventType =
  | 'board.created'
  | 'board.updated'
  | 'board.trashed'
  | 'board.restored'
  | 'board.deleted'
  | 'member.added'
  | 'member.removed'

export interface EventData {
  board: { id: string; title: string; url: string }
  actor: { id: string; name: string } | null
  member?: { id: string; role?: string }
}

export interface Webhooks {
  emit(type: EventType, data: EventData): void
  /** Waits for deliveries in progress (shutdown, tests). */
  drain(): Promise<void>
}

const RETRIES_MS = [0, 2000, 10_000]
const TIMEOUT_MS = 5000
const UPDATE_EVERY_MS = 60_000

export function createWebhooks(
  target: { url: URL; secret: string } | null,
  log: Logger,
  { fetch: doFetch = fetch, retriesMs = RETRIES_MS } = {},
): Webhooks {
  const inFlight = new Set<Promise<void>>()
  const lastUpdate = new Map<string, number>()

  async function deliver(body: string, type: string) {
    if (!target) return
    for (const wait of retriesMs) {
      if (wait) await new Promise((r) => setTimeout(r, wait))
      try {
        const res = await doFetch(target.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...signatureHeaders(target.secret, body) },
          body,
          redirect: 'error',
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        if (res.ok) return
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          log('warn', 'Webhook refused', { type, status: res.status })
          return
        }
      } catch {
        /* try again */
      }
    }
    log('warn', 'Webhook not delivered', { type })
  }

  return {
    emit(type, data) {
      if (!target) return
      if (type === 'board.updated') {
        const now = Date.now()
        if (now - (lastUpdate.get(data.board.id) ?? 0) < UPDATE_EVERY_MS) return
        if (lastUpdate.size > 10_000) lastUpdate.clear()
        lastUpdate.set(data.board.id, now)
      }
      const body = JSON.stringify({ id: `evt_${randomToken(12)}`, type, occurredAt: new Date().toISOString(), ...data })
      const p = deliver(body, type).finally(() => inFlight.delete(p))
      inFlight.add(p)
    },
    async drain() {
      await Promise.all([...inFlight])
    },
  }
}
