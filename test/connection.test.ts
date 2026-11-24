// Getting connected: TURN relays from the build settings, and what an empty board is waiting for.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { fetchTurnServers, fixedTurnServers, loadTurnServers, parseIceServers } from '../src/sync/ice.ts'
import type { TurnDeps } from '../src/sync/ice.ts'
import { joinState } from '../src/sync/status.ts'

const METERED = [
  { urls: 'stun:stun.relay.metered.ca:80' },
  { urls: 'turn:global.relay.metered.ca:80', username: 'u', credential: 'c' },
  { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username: 'u', credential: 'c' },
]

/** A fetch that answers `body` (or fails), counting the calls; and a storage in memory. */
function fakes(body: unknown, { ok = true, fail = false } = {}) {
  const calls: string[] = []
  const store = new Map<string, string>()
  const deps: TurnDeps = {
    fetch: async (url) => {
      calls.push(url)
      if (fail) throw new Error('offline')
      return { ok, status: ok ? 200 : 401, json: async () => body }
    },
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
    now: () => 1_000_000,
  }
  return { deps, calls, store }
}

test('ICE servers: arrays or { iceServers }, malformed entries dropped', () => {
  assert.deepEqual(
    parseIceServers(METERED),
    METERED.map((s) => ({ ...s, urls: [s.urls] })),
  )
  assert.deepEqual(parseIceServers({ iceServers: [{ urls: ['turn:a:3478', 'http://x'], username: 'u' }] }), [
    { urls: ['turn:a:3478'], username: 'u' },
  ])
  assert.deepEqual(parseIceServers([null, 'turn:a', { urls: 'https://evil' }, { urls: [] }]), [])
  assert.deepEqual(parseIceServers('nope'), [])
})

test('fixed TURN servers come from the build settings', () => {
  assert.deepEqual(fixedTurnServers({}), [])
  assert.deepEqual(
    fixedTurnServers({
      VITE_TURN_URLS: ' turn:relay.example:3478, turns:relay.example:443?transport=tcp ',
      VITE_TURN_USERNAME: 'team',
      VITE_TURN_CREDENTIAL: 'pw',
    }),
    [
      {
        urls: ['turn:relay.example:3478', 'turns:relay.example:443?transport=tcp'],
        username: 'team',
        credential: 'pw',
      },
    ],
  )
})

test('TURN credentials from a URL are fetched once and kept for a while', async () => {
  const { deps, calls } = fakes(METERED)
  const url = 'https://team.metered.live/api/v1/turn/credentials?apiKey=k'
  const first = await fetchTurnServers(url, deps)
  assert.equal(first.length, 3)
  assert.deepEqual(await fetchTurnServers(url, deps), first, 'the second board opens from the kept copy')
  assert.equal(calls.length, 1)

  await fetchTurnServers(url, { ...deps, now: () => 1_000_000 + 7 * 60 * 60 * 1000 })
  assert.equal(calls.length, 2, 'an old copy is fetched again')
  await fetchTurnServers(`${url}2`, deps)
  assert.equal(calls.length, 3, 'a copy is only good for its own URL')
})

test('a failing credentials URL leaves the fixed servers and direct connections', async () => {
  const env = { VITE_TURN_URLS: 'turn:fixed:3478', VITE_TURN_CREDENTIALS_URL: 'https://x/creds' }
  const fixed = [{ urls: ['turn:fixed:3478'] }]
  assert.deepEqual(await loadTurnServers(env, fakes(null, { fail: true }).deps), fixed)
  assert.deepEqual(await loadTurnServers(env, fakes(METERED, { ok: false }).deps), fixed)
  const { deps, store } = fakes({ error: 'bad key' })
  assert.deepEqual(await loadTurnServers(env, deps), fixed)
  assert.equal(store.size, 0, 'nothing kept from an answer without servers')
  assert.equal((await loadTurnServers(env, fakes(METERED).deps)).length, 4)
})

test('an empty board knows what it is waiting for', () => {
  const facts = { peers: 0, connectFailed: false, relaysFailed: false, waited: false }
  assert.equal(joinState(facts), 'searching')
  assert.equal(joinState({ ...facts, waited: true }), 'alone')
  assert.equal(joinState({ ...facts, relaysFailed: true }), 'offline')
  assert.equal(
    joinState({ ...facts, relaysFailed: true, connectFailed: true }),
    'blocked',
    'a peer was found after all',
  )
  assert.equal(joinState({ ...facts, connectFailed: true, peers: 1 }), 'connected', 'another peer got through')
})
