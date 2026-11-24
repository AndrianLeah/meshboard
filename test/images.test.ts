// Images: which addresses a board accepts and shows, pasted addresses, the settings, the
// converter that reads an upload endpoint's answer, and the upload itself.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { imageSrc, sanitizeItem } from '../src/core/schema.ts'
import {
  NO_UPLOADS,
  convertUpload,
  fitImage,
  imageSettingsFromEnv,
  imageUrls,
  isAllowedImage,
  parseImageSettings,
  readPath,
} from '../src/core/images.ts'
import type { UploadSettings } from '../src/core/images.ts'
import { uploadImage, UploadError } from '../src/app/images.ts'

test('an image is an https address, nothing else', () => {
  assert.equal(imageSrc('https://images.example/a.png'), 'https://images.example/a.png')
  assert.equal(imageSrc(' https://images.example/a b.png '), 'https://images.example/a%20b.png')
  for (const bad of [
    'http://images.example/a.png',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    'blob:https://x/1',
    'https://user:pass@images.example/a.png',
    '//images.example/a.png',
    'https://x/' + 'a'.repeat(2100),
    42,
    '',
  ])
    assert.equal(imageSrc(bad), null, String(bad).slice(0, 40))
  const item = sanitizeItem({
    type: 'image',
    x: 1,
    y: 2,
    w: 0,
    h: -5,
    src: 'https://images.example/a.png',
    alt: 'A cat',
    color: 'pink',
  })
  assert.deepEqual(
    { ...item, created: 0 },
    {
      type: 'image',
      x: 1,
      y: 2,
      w: 320,
      h: 20,
      src: 'https://images.example/a.png',
      alt: 'A cat',
      color: 'pink',
      z: 0,
      author: '',
      created: 0,
      locked: false,
      group: '',
    },
  )
  assert.equal(sanitizeItem({ type: 'image', src: 'javascript:alert(1)' }), null, 'unusable: skipped')
})

test('pasted text becomes images only when every line is a picture address', () => {
  assert.deepEqual(imageUrls('https://images.example/a.png\n  https://images.example/b.JPG  '), [
    'https://images.example/a.png',
    'https://images.example/b.JPG',
  ])
  assert.equal(imageUrls('https://images.example/page.html'), null)
  assert.equal(imageUrls('https://images.example/a.png\nnot a link'), null)
  assert.equal(imageUrls('http://images.example/a.png'), null)
  assert.equal(imageUrls(''), null)
})

test('settings: from config.json or the build, anything unusable left out', () => {
  assert.deepEqual(parseImageSettings(null), NO_UPLOADS)
  const s = parseImageSettings({
    origins: ['https://images.example/path', 'http://plain.example', 'nope'],
    upload: {
      url: 'https://uploads.example/files',
      method: 'PUT',
      field: 'image',
      headers: { 'X-Key': 'k', 'bad header': 'x', 'X-Num': 3 },
      credentials: 'include',
      urlPath: 'data.url',
      widthPath: 'data.width; drop table',
      maxBytes: 5_000_000,
    },
  })
  assert.deepEqual(s.origins, ['https://images.example'])
  assert.deepEqual(s.upload, {
    url: 'https://uploads.example/files',
    method: 'PUT',
    field: 'image',
    headers: { 'X-Key': 'k' },
    credentials: 'include',
    urlPath: 'data.url',
    widthPath: '',
    heightPath: '',
    maxBytes: 5_000_000,
  })
  assert.equal(parseImageSettings({ upload: { url: 'http://uploads.example/files' } }).upload, null)
  const env = imageSettingsFromEnv({
    VITE_UPLOAD_URL: 'https://uploads.example/files',
    VITE_UPLOAD_URL_PATH: 'url',
    VITE_UPLOAD_HEADERS: '{"Authorization":"Bearer public"}',
    VITE_IMAGE_ORIGINS: 'https://cdn.example, https://images.example',
  })
  assert.equal(env.upload?.urlPath, 'url')
  assert.equal(env.upload?.method, 'POST')
  assert.equal(env.upload?.credentials, 'omit')
  assert.deepEqual(env.upload?.headers, { Authorization: 'Bearer public' })
  assert.deepEqual(env.origins, ['https://cdn.example', 'https://images.example'])
  assert.equal(imageSettingsFromEnv({ VITE_UPLOAD_HEADERS: '{bad' }).upload, null)
})

test('which pictures a board shows', () => {
  assert.ok(isAllowedImage('https://anywhere.example/a.png', NO_UPLOADS), 'no list: any https address')
  const only = { upload: null, origins: ['https://images.example'] }
  assert.ok(isAllowedImage('https://images.example/a.png', only))
  assert.ok(!isAllowedImage('https://elsewhere.example/a.png', only))
  assert.ok(!isAllowedImage('http://images.example/a.png', only))
})

const settings: UploadSettings = {
  url: 'https://uploads.example/api/files',
  method: 'POST',
  field: 'file',
  headers: {},
  credentials: 'omit',
  urlPath: 'data.url',
  widthPath: 'data.size.0',
  heightPath: 'data.size.1',
  maxBytes: 1000,
}

test('the converter: the address (and size) from the endpoint’s answer', () => {
  assert.equal(readPath({ a: [{ b: 'x' }] }, 'a.0.b'), 'x')
  assert.equal(readPath({ a: 1 }, 'a.b'), undefined)
  assert.equal(readPath({}, 'constructor'), undefined, 'only its own keys')
  assert.deepEqual(convertUpload({ data: { url: 'https://images.example/a.png', size: [800, 600] } }, settings), {
    src: 'https://images.example/a.png',
    w: 800,
    h: 600,
  })
  assert.deepEqual(convertUpload({ data: { url: '/files/a.png' } }, settings), {
    src: 'https://uploads.example/files/a.png',
  })
  assert.deepEqual(convertUpload('https://images.example/b.png', { ...settings, urlPath: '' }), {
    src: 'https://images.example/b.png',
  })
  assert.throws(() => convertUpload({ data: {} }, settings), /no address at "data.url"/)
  assert.throws(() => convertUpload({ data: { url: 'javascript:alert(1)' } }, settings), /https/)
  assert.throws(() => convertUpload({ data: { url: 'http://images.example/a.png' } }, settings), /https/)
  assert.deepEqual(fitImage(1600, 800), { w: 480, h: 240 })
  assert.deepEqual(fitImage(100, 50), { w: 100, h: 50 })
  assert.deepEqual(fitImage(undefined, 10), { w: 320, h: 240 })
})

test('uploading: the file goes to the endpoint as set, never anywhere else', async () => {
  const sent: Array<{ url: string; init: RequestInit }> = []
  const answer = (body: unknown, init: ResponseInit = {}) =>
    (async (url: string, req: RequestInit) => {
      sent.push({ url, init: req })
      return typeof body === 'string' ? new Response(body, init) : Response.json(body, init)
    }) as unknown as typeof fetch
  const png = new File([new Uint8Array(10)], 'cat.png', { type: 'image/png' })
  const result = await uploadImage(
    png,
    { ...settings, headers: { 'X-Key': 'k' } },
    {
      fetch: answer({ data: { url: 'https://images.example/cat.png' } }),
    },
  )
  assert.deepEqual(result, { src: 'https://images.example/cat.png' })
  const { url, init } = sent[0]
  assert.equal(url, settings.url)
  assert.equal(init.method, 'POST')
  assert.equal(init.redirect, 'error')
  assert.equal(init.credentials, 'omit')
  assert.deepEqual(init.headers, { 'X-Key': 'k' })
  assert.ok((init.body as FormData).get('file') instanceof File)

  await assert.rejects(uploadImage(new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }), settings), UploadError)
  await assert.rejects(
    uploadImage(new File([new Uint8Array(2000)], 'big.png', { type: 'image/png' }), settings),
    /larger than/,
  )
  await assert.rejects(uploadImage(png, settings, { fetch: answer({}, { status: 500 }) }), /failed \(500\)/)
  await assert.rejects(uploadImage(png, settings, { fetch: answer({ nope: 1 }) }), /no address/)
  const offline = (async () => {
    throw new Error('ECONNREFUSED')
  }) as unknown as typeof fetch
  await assert.rejects(uploadImage(png, settings, { fetch: offline }), /Couldn't reach/)
  const text = await uploadImage(
    png,
    { ...settings, urlPath: '' },
    {
      fetch: answer('https://images.example/t.png\n', { headers: { 'content-type': 'text/plain' } }),
    },
  )
  assert.equal(text.src, 'https://images.example/t.png')
})
