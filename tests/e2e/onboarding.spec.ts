import { expect, test } from '@playwright/test'
import { enterDemo, go, watchErrors } from './helpers'

test('landing v2 sections and guide page', async ({ page }) => {
  const done = watchErrors(page)
  await go(page, '/')
  await expect(page.locator('.hero2-title')).toBeVisible()
  await expect(page.locator('.fan-ticket')).toHaveCount(8)
  await page.locator('#features').scrollIntoViewIfNeeded()
  await expect(page.locator('.bento .b-card')).toHaveCount(6)
  await go(page, '/guide')
  await expect(page.locator('.guide-sec')).toHaveCount(6)
  await expect(page.locator('#google')).toContainText('Authorized JavaScript origins')
  done()
})

test('product tour runs once and can be skipped', async ({ page }) => {
  await enterDemo(page, { tour: true })
  await expect(page.locator('.tour-pop')).toBeVisible()
  await page.getByRole('button', { name: 'הבא' }).click()
  await expect(page.locator('.tour-pop h3')).toContainText('מתי אתם פנויים')
  await expect(page.locator('.tour-hole')).toBeVisible()
  await page.getByRole('button', { name: 'דילוג' }).click()
  await expect(page.locator('.tour-pop')).toHaveCount(0)
  await page.reload()
  await expect(page.locator('.rail')).toBeVisible()
  await expect(page.locator('.tour-pop')).toHaveCount(0)
})

test('getting started checklist reacts to real actions', async ({ page }) => {
  await enterDemo(page)
  const card = page.locator('.setup-card')
  await expect(card).toBeVisible()
  const shareItem = card.locator('li', { hasText: 'לשתף את הקישור' })
  await expect(shareItem).not.toHaveClass(/done/)
  await page.locator('.page-head .btn-accent').click() // copy my link
  await page.reload()
  await expect(page.locator('.setup-card li', { hasText: 'לשתף את הקישור' })).toHaveClass(/done/)
  await page.locator('.setup-close').click()
  await expect(page.locator('.setup-card')).toHaveCount(0)
})

test('Google sign in explains setup when no client id is configured', async ({ page }) => {
  await go(page, '/login')
  await page.getByRole('button', { name: 'המשך עם Google' }).click()
  await expect(page.locator('.notice')).toContainText('Google Client ID')
  await expect(page.locator('.rail')).toHaveCount(0)
})

test('reserved usernames are rejected', async ({ page }) => {
  await enterDemo(page)
  await go(page, '/app/settings')
  const input = page.locator('.input-group input').first()
  await input.fill('guide')
  await page.locator('.page-head .btn-accent').click()
  await expect(page.locator('.toast.err')).toContainText('שמור')
})

test('dashboard refuses to render inside a frame', async ({ page }) => {
  await enterDemo(page)
  await page.setContent(`<iframe src="${page.url().split('#')[0]}#/app" style="width:800px;height:600px"></iframe>`)
  const frame = page.frameLocator('iframe')
  await expect(frame.getByText('Open Slotwise')).toBeVisible()
})
