// The app's self-hosted pieces that run without a browser: reading config.json, presence over
// awareness, and a viewer's commands.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { loadRuntime, parseRuntime } from '../src/app/runtime.ts'
import { createAwarenessPresence } from '../src/sync/awareness.ts'

test('config.json decides the mode; anything odd means peer to peer', () => {
  assert.deepEqual(parseRuntime(null), { mode: 'p2p' })
  assert.deepEqual(parseRuntime({ mode: 'p2p' }), { mode: 'p2p' })
  assert.deepEqual(parseRuntime({ mode: 'server', auth: { kind: 'magic' } }), { mode: 'p2p' })
  assert.deepEqual(
    parseRuntime({
      mode: 'server',
      orgName: 'Acme',
      basePath: '/meshboard',
      auth: { kind: 'oidc', loginUrl: '/meshboard/auth/login', canSignOut: true },
    }),
    {
      mode: 'server',
      orgName: 'Acme',
      basePath: '/meshboard/',
      auth: { kind: 'oidc', loginUrl: '/meshboard/auth/login', canSignOut: true },
    },
  )
  // a config can't send people to another site to sign in
  for (const loginUrl of ['https://evil.example/login', '//evil.example/login', 'javascript:alert(1)', 42]) {
    const rt = parseRuntime({ mode: 'server', auth: { kind: 'oidc', loginUrl } })
    assert.equal(rt.mode === 'server' && rt.auth.loginUrl, null, String(loginUrl))
  }
  const plain = parseRuntime({ mode: 'server', basePath: 'nope', auth: { kind: 'none' } })
  assert.equal(plain.mode === 'server' && plain.basePath, '/')
  assert.equal(plain.mode === 'server' && plain.orgName, 'your organisation')
})

test('loading config.json: a 404, HTML or a failure means peer to peer', async () => {
  const reply = (body: string, init: ResponseInit) => (async () => new Response(body, init)) as unknown as typeof fetch
  assert.deepEqual(await loadRuntime(reply('Not found', { status: 404 })), { mode: 'p2p' })
  assert.deepEqual(
    await loadRuntime(reply('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } })),
    { mode: 'p2p' },
  )
  const failing = (async () => {
    throw new Error('offline')
  }) as unknown as typeof fetch
  assert.deepEqual(await loadRuntime(failing), { mode: 'p2p' })
  const rt = await loadRuntime(
    reply(JSON.stringify({ mode: 'server', auth: { kind: 'none', loginUrl: null, canSignOut: true } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )
  assert.equal(rt.mode, 'server')
})

test('presence over awareness: peers, cursors, untrusted states cleaned', async () => {
  const docA = new Y.Doc()
  const docB = new Y.Doc()
  const a = new Awareness(docA)
  const b = new Awareness(docB)
  // relay awareness updates both ways, as the server does
  const { encodeAwarenessUpdate, applyAwarenessUpdate } = await import('y-protocols/awareness')
  a.on('update', ({ added, updated, removed }: Record<string, number[]>) =>
    applyAwarenessUpdate(b, encodeAwarenessUpdate(a, [...added, ...updated, ...removed]), 'net'),
  )
  b.on('update', ({ added, updated, removed }: Record<string, number[]>) =>
    applyAwarenessUpdate(a, encodeAwarenessUpdate(b, [...added, ...updated, ...removed]), 'net'),
  )
  const anna = createAwarenessPresence(a, { id: 'anna', name: 'Anna' })
  const marco = createAwarenessPresence(b, { id: 'marco', name: 'Marco' })
  // Marco joined after Anna: he sees her once her state reaches him
  a.setLocalStateField('peer', { uid: 'anna', name: 'Anna', x: null, y: null })
  let joins = 0
  let moves = 0
  anna.onPeers(() => joins++)
  const off = anna.onMove(() => moves++)
  marco.set({ x: 12, y: 34 })
  await new Promise((r) => setTimeout(r, 80))
  const seen = [...anna.peers.values()]
  assert.deepEqual(seen, [{ uid: 'marco', name: 'Marco', x: 12, y: 34 }])
  assert.ok(moves > 0)
  off()
  // a hostile state is cleaned like any message from the network
  b.setLocalStateField('peer', { uid: 'x'.repeat(500), name: 7, x: 'NaN', y: Infinity })
  await new Promise((r) => setTimeout(r, 10))
  const hostile = [...anna.peers.values()][0]
  assert.equal(hostile.uid.length, 64)
  assert.equal(hostile.name, '7')
  assert.equal(hostile.x, null)
  assert.equal(hostile.y, null)
  // leaving
  b.setLocalState(null)
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(anna.peers.size, 0)
  assert.ok(joins >= 1)
  anna.destroy()
  marco.destroy()
  // awareness keeps a timer for peers that went quiet
  a.destroy()
  b.destroy()
})
