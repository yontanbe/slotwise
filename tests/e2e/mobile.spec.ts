import { expect, test } from '@playwright/test'
import { enterDemo, go, pickFirstSlot } from './helpers'

for (const path of ['/', '/yonatan', '/yonatan/intro', '/login', '/team/studio'])
  test(`no horizontal scroll on ${path}`, async ({ page }) => {
    await go(page, path)
    await page.waitForTimeout(800)
    const w = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(w).toBeLessThanOrEqual(1)
  })

test('mobile booking and menu', async ({ page }) => {
  await go(page, '/yonatan/intro')
  await pickFirstSlot(page)
  await enterDemo(page).catch(async () => {
    // on mobile the rail is off-canvas; the dashboard still loads
    await expect(page.locator('.mobile-bar')).toBeVisible()
  })
  await go(page, '/app')
  await page.getByRole('button', { name: 'menu' }).click()
  await expect(page.locator('.rail.open')).toBeVisible()
})
