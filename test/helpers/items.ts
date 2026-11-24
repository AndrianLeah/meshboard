// Typed reads for tests: fail with a clear message instead of reading a field of null.
import assert from 'node:assert/strict'
import type { Store } from '../../src/core/store.ts'
import type { Item } from '../../src/core/types.ts'

/** The item type for a `type`: shapes share one interface, so narrow it to the one asked for. */
type Of<T extends Item['type']> = Item extends infer I
  ? I extends Item
    ? T extends I['type']
      ? I & { type: T }
      : never
    : never
  : never

/** The item `id`, which must exist (and be a `type` when given). */
export function get(store: Store, id: string): Item
export function get<T extends Item['type']>(store: Store, id: string, type: T): Of<T>
export function get(store: Store, id: string, type?: Item['type']): Item {
  const it = store.get(id)
  assert.ok(it, `no item ${id}`)
  if (type) assert.equal(it.type, type, `item ${id} is a ${it.type}, not a ${type}`)
  return it
}

/** The first item of `type` in a list, which must be there. */
export function find<T extends Item['type']>(items: ReadonlyArray<Item | null>, type: T): Of<T> {
  const it = items.find((x): x is Of<T> => x?.type === type)
  assert.ok(it, `no ${type} in the list`)
  return it
}
