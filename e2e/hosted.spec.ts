// Self-hosted Meshboard in a real browser, against the real server: signing in, the dashboard,
// a board that's there for whoever opens it later, and sharing with viewers or nobody.
import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'

/** A new person: a fresh browser context, signed in with `name` on `path`. */
async function person(browser: Browser, name: string, path = '/'): Promise<Page> {
  const page = await (await browser.newContext()).newPage()
  // the app's own Content-Security-Policy must never get in its way
  page.on('console', (m) => {
    if (/Content.Security.Policy/i.test(m.text())) throw new Error(`CSP violation: ${m.text()}`)
  })
  await page.goto(path)
  await page.getByPlaceholder('How others will see you').fill(name)
  await page.getByRole('button', { name: 'Continue' }).click()
  return page
}

async function newBoard(page: Page, title: string): Promise<string> {
  await page.getByRole('button', { name: 'New board' }).click()
  await expect(page).toHaveURL(/\/b\/[\w-]{16,}$/)
  await expect(page.locator('.board')).toBeVisible()
  await page.getByLabel('Board title').fill(title)
  await page.getByLabel('Board title').press('Enter')
  return new URL(page.url()).pathname
}

async function addNote(page: Page, x: number, y: number, text: string) {
  await page.mouse.dblclick(x, y)
  await page.keyboard.type(text)
  await page.keyboard.press('Escape')
  await expect(page.locator('.item--note', { hasText: text })).toHaveCount(1)
}

/** Sets the board's general access from the share dialog. */
async function share(page: Page, who: string, level?: 'can view' | 'can edit') {
  await page.getByRole('button', { name: 'Share' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Who can open it').selectOption({ label: who })
  if (level) await dialog.getByLabel('What they can do').selectOption({ label: level })
  await expect(dialog.getByLabel('Who can open it')).toHaveValue(who === 'Only people added' ? 'none' : 'org')
  await page.keyboard.press('Escape')
}

test('a board is kept on the server: a teammate opens it later and finds the content', async ({ browser }) => {
  const anna = await person(browser, 'Anna')
  await expect(anna.getByRole('heading', { name: 'All boards' })).toBeVisible()
  const path = await newBoard(anna, 'Kept on the server')
  await addNote(anna, 500, 400, 'Still here tomorrow')
  // give the server its couple of seconds to save, then Anna leaves
  await anna.waitForTimeout(2500)
  await anna.context().close()

  const marco = await person(browser, 'Marco', path)
  await expect(marco.locator('.item--note', { hasText: 'Still here tomorrow' })).toHaveCount(1)
  await expect(marco).toHaveTitle('Kept on the server · Meshboard')
  await marco.context().close()
})

test('the dashboard: cards with a preview, search, stars and the trash', async ({ browser }) => {
  const anna = await person(browser, 'Anna Dash')
  await newBoard(anna, 'Quarterly planning')
  await addNote(anna, 400, 300, 'Hire two people')
  await anna.waitForTimeout(2500)
  await anna.getByRole('button', { name: 'All boards' }).click()

  const card = anna.locator('.dash__card', { hasText: 'Quarterly planning' })
  await expect(card).toBeVisible()
  await expect(card.locator('.dash__thumb img')).toBeVisible()
  await expect(card).toContainText('Edited')

  await anna.getByRole('searchbox', { name: 'Search boards' }).fill('quarterly')
  await expect(anna.locator('.dash__card')).toHaveCount(1)
  await anna.getByRole('searchbox', { name: 'Search boards' }).fill('nothing like this')
  await expect(anna.getByText('No boards match these filters.')).toBeVisible()
  await anna.getByRole('button', { name: 'Clear filters' }).click()

  await card.hover()
  await card.getByRole('button', { name: 'Quarterly planning: more' }).click()
  await anna.getByRole('menuitem', { name: 'Star' }).click()
  await anna.getByRole('button', { name: /^Starred/ }).click()
  await expect(anna.locator('.dash__card', { hasText: 'Quarterly planning' })).toBeVisible()

  await anna.getByRole('button', { name: /^All boards/ }).click()
  await card.hover()
  await card.getByRole('button', { name: 'Quarterly planning: more' }).click()
  await anna.getByRole('menuitem', { name: 'Move to trash' }).click()
  await expect(anna.locator('.dash__card', { hasText: 'Quarterly planning' })).toHaveCount(0)
  await anna.getByRole('button', { name: /^Trash/ }).click()
  await expect(anna.locator('.dash__card', { hasText: 'Quarterly planning' })).toBeVisible()
  await anna.context().close()
})

test('a viewer can look but not change the board', async ({ browser }) => {
  const anna = await person(browser, 'Anna Owner')
  const path = await newBoard(anna, 'Read me')
  await addNote(anna, 500, 400, 'Look, do not touch')
  await share(anna, 'Everyone at Acme', 'can view')

  const giulia = await person(browser, 'Giulia', path)
  await expect(giulia.locator('.item--note', { hasText: 'Look, do not touch' })).toHaveCount(1)
  await expect(giulia.getByText('View only')).toBeVisible()
  await expect(giulia.getByLabel('Board title')).toBeDisabled()
  await expect(giulia.getByRole('navigation', { name: 'Tools' })).toHaveCount(0)
  await expect(anna.getByRole('navigation', { name: 'Tools' })).toBeVisible()
  await giulia.mouse.dblclick(300, 300)
  await giulia.keyboard.type('sneaky')
  await expect(giulia.locator('.item--note')).toHaveCount(1)
  await anna.context().close()
  await giulia.context().close()
})

test('a board shared with nobody else says so to others', async ({ browser }) => {
  const anna = await person(browser, 'Anna Private')
  const path = await newBoard(anna, 'Just mine')
  await share(anna, 'Only people added')
  const luca = await person(browser, 'Luca', path)
  await expect(luca.getByRole('heading', { name: "This board can't be opened" })).toBeVisible()
  await luca.getByRole('button', { name: 'Go to your boards' }).click()
  await expect(luca.getByRole('heading', { name: 'All boards' })).toBeVisible()
  await expect(luca.locator('.dash__card', { hasText: 'Just mine' })).toHaveCount(0)
  await anna.context().close()
  await luca.context().close()
})
