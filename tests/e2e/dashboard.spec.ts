import { expect, test } from '@playwright/test'
import { db, enterDemo, fillInvitee, go, pickFirstSlot, submitBooking, watchErrors } from './helpers'

test('every dashboard screen renders without errors', async ({ page }) => {
  const done = watchErrors(page)
  await enterDemo(page)
  const paths = ['/app', '/app/bookings', '/app/event-types', '/app/availability', '/app/workflows', '/app/routing', '/app/teams', '/app/polls', '/app/contacts', '/app/insights', '/app/integrations', '/app/developers', '/app/settings']
  for (const p of paths) {
    await go(page, p)
    await expect(page.locator('.page-title, .page-head h1').first()).toBeVisible()
  }
  done()
})

test('pending request: approve from the dashboard', async ({ page }) => {
  await enterDemo(page)
  await go(page, '/app/bookings')
  await page.locator('.tabs button').nth(1).click()
  await page.locator('.booking-row').first().click()
  await page.getByRole('button', { name: 'אישור' }).click()
  await expect(page.locator('.modal .stamp.ok')).toBeVisible()
})

test('search finds bookings by answer text', async ({ page }) => {
  await enterDemo(page)
  await go(page, '/app/bookings')
  await page.locator('.input-group input').fill('acme.io')
  await expect(page.locator('.booking-row')).toHaveCount(1)
  await expect(page.locator('.booking-row')).toContainText('Michael Green')
})

test('manual booking with override', async ({ page }) => {
  await enterDemo(page)
  await go(page, '/app/bookings')
  await page.getByRole('button', { name: 'קביעה ידנית' }).click()
  const inputs = page.locator('.modal input')
  await inputs.nth(2).fill('ידני')
  await inputs.nth(3).fill('manual@test.dev')
  await page.locator('.modal button.btn-accent').click()
  await expect(page.locator('.toast')).toContainText('הפגישה נקבעה')
  const data = await db(page)
  expect(data.bookings.some((b: { attendee: { email: string }; source: string }) => b.attendee.email === 'manual@test.dev' && b.source === 'manual')).toBe(true)
})

test('editing an event type shows on the public page', async ({ page }) => {
  await enterDemo(page)
  await go(page, '/app/event-types')
  await page.locator('.et-title').first().click()
  const title = page.locator('.editor input').first()
  await title.fill('שיחת היכרות קצרה')
  await page.getByRole('button', { name: 'שמירה' }).click()
  await expect(page.locator('.toast')).toContainText('נשמר')
  await go(page, '/yonatan')
  await expect(page.locator('.profile-grid')).toContainText('שיחת היכרות קצרה')
})

test('a day off override removes that day from the booking page', async ({ page }) => {
  await go(page, '/yonatan/intro')
  await expect(page.locator('.month-day.avail').first()).toBeVisible({ timeout: 15_000 })
  const firstDay = await page.locator('.month-day.avail').first().getAttribute('aria-label')
  await enterDemo(page)
  await go(page, '/app/availability')
  // navigate the override calendar to that month if needed, then mark the day off
  await page.evaluate((d) => {
    const raw = JSON.parse(localStorage.getItem('slotwise:db')!)
    const u = raw.users.find((x: { id: string }) => x.id === 'demo-host')
    const s = raw.schedules.find((x: { id: string }) => x.id === u.defaultScheduleId)
    s.overrides.push({ date: d, ranges: [] })
    localStorage.setItem('slotwise:db', JSON.stringify(raw))
  }, firstDay)
  await go(page, '/yonatan/intro')
  await expect(page.locator('.month-day.avail').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.locator(`.month-day.avail[aria-label="${firstDay}"]`)).toHaveCount(0)
})

test('workflow preset runs on a new booking (WhatsApp to host waits in outbox)', async ({ page }) => {
  await enterDemo(page)
  await go(page, '/app/workflows')
  await page.getByRole('button', { name: '+ התראה למארח ב-WhatsApp' }).click()
  await page.locator('.modal button.btn-accent').click()
  await expect(page.locator('.toast')).toContainText('נשמר')
  await go(page, '/yonatan/intro')
  await pickFirstSlot(page)
  await fillInvitee(page, 'Workflow', 'wf@test.dev')
  await submitBooking(page)
  await go(page, '/app/workflows')
  await expect(page.getByText('פגישה חדשה: Workflow')).toBeVisible({ timeout: 10_000 })
})

test('notifications are written once to the outbox', async ({ page }) => {
  await go(page, '/yonatan/intro')
  await pickFirstSlot(page)
  await fillInvitee(page, 'Once', 'once@test.dev')
  await submitBooking(page)
  await enterDemo(page)
  await go(page, '/app')
  await page.waitForTimeout(1500)
  const data = await db(page)
  const mails = data.outbox.filter((m: { to: string }) => m.to === 'once@test.dev')
  expect(mails).toHaveLength(1)
})

test('webhook and API key management', async ({ page }) => {
  await enterDemo(page)
  await go(page, '/app/developers')
  await page.getByRole('button', { name: 'יצירת מפתח' }).click()
  await expect(page.locator('.key-reveal')).toContainText('sw_')
  const data = await db(page)
  expect(data.kinds.api_key[0].hash).toMatch(/^[0-9a-f]{64}$/)
  await page.getByRole('button', { name: 'Webhook חדש' }).click()
  await page.locator('.modal input').first().fill('javascript:alert(1)')
  await page.locator('.modal button.btn-accent').click()
  await expect(page.locator('.toast.err')).toBeVisible()
})

test('teams page lists the seeded team and team event types', async ({ page }) => {
  await enterDemo(page)
  await go(page, '/app/teams')
  await expect(page.getByRole('heading', { name: 'סטודיו מוצר' })).toBeVisible()
  await expect(page.locator('.timetable .tt-row')).toHaveCount(2)
})

test('settings: out of office blocks the booking page', async ({ page }) => {
  await enterDemo(page)
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('slotwise:db')!)
    const u = raw.users.find((x: { id: string }) => x.id === 'demo-host')
    const d = new Date()
    const end = new Date(d.getTime() + 60 * 864e5)
    u.outOfOffice = [{ id: 'o1', start: d.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), note: 'חופשה', redirectUsername: 'noa' }]
    localStorage.setItem('slotwise:db', JSON.stringify(raw))
  })
  await go(page, '/yonatan/intro')
  await page.waitForTimeout(1500)
  await expect(page.locator('.month-day.avail')).toHaveCount(0)
})
