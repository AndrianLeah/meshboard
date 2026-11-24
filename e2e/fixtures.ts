// Shared setup: no real network (peer discovery is closed off), helpers to start a board.
import { test as base, expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

export const test = base.extend({
  page: async ({ page }, use) => {
    // the board joins public Nostr relays to find peers: keep the tests off the network
    await page.routeWebSocket(/.*/, (ws) => ws.close())
    await use(page)
  },
})

export { expect }

interface Point {
  x: number
  y: number
}

/** Opens the home screen, enters a name and creates a board. */
export async function createBoard(page: Page, name = 'Anna'): Promise<void> {
  await page.goto('/')
  await page.getByPlaceholder('How others will see you').fill(name)
  await page.getByRole('button', { name: 'Create a new board' }).click()
  await expect(page.locator('.board')).toBeVisible()
  await expect(page).toHaveURL(/#[\w-]+\.[\w-]+$/)
}

/**
 * Waits until the board's edits are committed to IndexedDB. Transactions on the same store run
 * in order, so a read that completes means every earlier write has been committed.
 */
export async function waitForSave(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const roomId = location.hash.slice(1).split('.')[0]
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(`meshboard-${roomId}`)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    await new Promise((resolve) => {
      const tx = db.transaction(['updates'], 'readonly')
      tx.objectStore('updates').count()
      tx.oncomplete = resolve
    })
    db.close()
  })
}

/** Double-clicks the canvas at (x, y) and types a sticky note. */
export async function addNote(page: Page, x: number, y: number, text: string): Promise<Locator> {
  await page.mouse.dblclick(x, y)
  await page.keyboard.type(text)
  await page.keyboard.press('Escape')
  return page.locator('.item--note', { hasText: text })
}

/** Drags with the mouse from one point to another in small steps. */
export async function drag(page: Page, from: Point, to: Point): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await page.mouse.up()
}

/** Where an element is on the page; it must be visible. */
export async function rect(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await locator.boundingBox()
  expect(b, 'the element is on screen').not.toBeNull()
  return b!
}

/** The centre of an element, in page coordinates. */
export async function centre(locator: Locator): Promise<Point> {
  const b = await rect(locator)
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}
