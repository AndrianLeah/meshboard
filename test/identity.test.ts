// Local identity, invite links and recent boards (localStorage stands in with a Map).
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const memory = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, String(v)),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
  key: (i: number) => [...memory.keys()][i] ?? null,
  get length() {
    return memory.size
  },
}
const identity = await import('../src/core/identity.ts')

beforeEach(() => memory.clear())

test('tokens: new ones parse, links and hashes too, junk does not', () => {
  const token = identity.newToken()
  const parsed = identity.parseToken(token)
  assert.ok(parsed)
  assert.equal(parsed.token, token)
  assert.equal(`${parsed.roomId}.${parsed.secret}`, token)
  assert.equal(identity.parseToken(`https://example.org/meshboard/#${token}`)?.token, token)
  assert.equal(identity.parseToken(`#b=${token}`)?.token, token)
  assert.equal(identity.parseToken('not a link'), null)
  assert.equal(identity.parseToken('short.x'), null)
  assert.equal(identity.parseToken(''), null)
})

test('the local user keeps a stable id; names are trimmed', () => {
  const first = identity.getUser()
  assert.match(first.id, /^[\w-]{8,}$/)
  assert.equal(identity.getUser().id, first.id)
  identity.setUserName('  Anna Rossi  ')
  assert.equal(identity.getUser().name, 'Anna Rossi')
})

test('recent boards: newest first, no duplicates, forgettable', () => {
  const a = identity.newToken()
  const b = identity.newToken()
  identity.touchRecent(a, 'Retro')
  identity.touchRecent(b, 'Roadmap')
  identity.touchRecent(a, 'Retro 2')
  assert.deepEqual(
    identity.getRecent().map((r) => r.title),
    ['Retro 2', 'Roadmap'],
  )
  identity.forgetRecent(a)
  assert.deepEqual(
    identity.getRecent().map((r) => r.title),
    ['Roadmap'],
  )
})

test('initials and colours', () => {
  assert.equal(identity.initials('anna rossi'), 'AR')
  assert.equal(identity.initials('Marco'), 'MA')
  assert.equal(identity.initials(''), '?')
  assert.equal(identity.userColor('u1'), identity.userColor('u1'))
  assert.notEqual(identity.userColor('u1'), identity.userColor('u2'))
})
