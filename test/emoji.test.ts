// The emoji picker's search, on synthetic entries and on the real emojibase data.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { searchEmojis, searchText } from '../src/ui/emoji-picker/emoji-data.ts'

test('search text: lowercase, no accents', () => {
  assert.equal(searchText('Café', 'Crème'), 'cafe creme')
})

test('names that start with the query first, then words that do, then the rest', () => {
  const list = [{ text: 'pocket rocket' }, { text: 'rocketry' }, { text: 'sprocket' }, { text: 'tree' }]
  assert.deepEqual(
    searchEmojis(list, 'Rocket').map((e) => e.text),
    ['rocketry', 'pocket rocket', 'sprocket'],
  )
  assert.deepEqual(searchEmojis(list, '  '), [])
})

test('real data: the obvious emoji comes first', () => {
  const file = new URL('../node_modules/emojibase-data/en/compact.json', import.meta.url)
  const compact: Array<{ unicode: string; label: string; tags?: string[]; emoticon?: string | string[] }> = JSON.parse(
    readFileSync(file, 'utf8'),
  )
  const emojis = compact.map((e) => ({
    unicode: e.unicode,
    text: searchText(e.label, ...(e.tags || []), ...[e.emoticon || []].flat()),
  }))
  assert.equal(searchEmojis(emojis, 'rocket')[0].unicode, '🚀')
  assert.equal(searchEmojis(emojis, 'thumbs up')[0].unicode, '👍')
  assert.ok(searchEmojis(emojis, 'party').some((e) => e.unicode === '🎉'))
})
