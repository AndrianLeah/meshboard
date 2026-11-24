// The phone layout: tools at the bottom, a compact top bar, no zoom bar.
import { test, expect, createBoard, rect } from './fixtures.ts'

test('tools sit in a bar at the bottom and all fit', async ({ page }) => {
  await createBoard(page)
  const toolbar = page.getByRole('navigation', { name: 'Tools' })
  const box = await rect(toolbar)
  const viewport = page.viewportSize()!
  expect(box.y + box.height).toBeGreaterThan(viewport.height - 80)
  expect(await toolbar.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  await expect(page.getByRole('group', { name: 'Zoom' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Share' })).toBeVisible()
})
