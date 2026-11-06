import { expect, type Page } from '@playwright/test'

/** Fails the test on any uncaught page error or console error. */
export function watchErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text())
  })
  return () => expect(errors, errors.join('\n')).toEqual([])
}

export async function go(page: Page, hash: string) {
  await page.goto('./#' + hash)
}

export async function enterDemo(page: Page) {
  await go(page, '/login')
  await page.locator('.demo-pass button').click()
  await expect(page.locator('.rail')).toBeVisible()
}

/** Picks the first offered slot on the booking page and moves to the form. */
export async function pickFirstSlot(page: Page) {
  await expect(page.locator('.ticket-list .ticket').first()).toBeVisible({ timeout: 15_000 })
  await page.locator('.ticket-list .ticket').first().click()
  await page.locator('.ticket-row.open .btn').click()
  await expect(page.locator('form.booker-form')).toBeVisible()
}

export async function fillInvitee(page: Page, name = 'בודק אוטומטי', email = 'qa.tester@test.dev', phone = '0541234567') {
  await page.fill('input[autocomplete=name]', name)
  await page.fill('input[autocomplete=email]', email)
  await page.fill('input[autocomplete=tel]', phone)
}

export async function submitBooking(page: Page) {
  await page.locator('form.booker-form button.btn-accent.btn-lg').click()
  await expect(page).toHaveURL(/#\/b\/[a-z0-9]+\?new=1/, { timeout: 15_000 })
}

export const db = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('slotwise:db') || '{}'))
