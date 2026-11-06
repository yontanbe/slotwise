import { expect, test } from '@playwright/test'
import { db, fillInvitee, go, pickFirstSlot, submitBooking, watchErrors } from './helpers'

test('landing and sample profile render', async ({ page }) => {
  const done = watchErrors(page)
  await go(page, '/')
  await expect(page.locator('.hero-title')).toContainText('קישור אחד')
  await go(page, '/yonatan')
  await expect(page.locator('h1')).toContainText('יונתן')
  // team event types and hidden ones are not on the personal profile
  await expect(page.locator('.profile-grid .index-card')).toHaveCount(3)
  done()
})

test('book, reschedule and cancel without an account', async ({ page }) => {
  const done = watchErrors(page)
  await go(page, '/yonatan/intro')
  await pickFirstSlot(page)
  await fillInvitee(page)
  await submitBooking(page)
  await expect(page.locator('.confirm-hero h1')).toBeVisible()
  await expect(page.locator('.stamp.ok')).toBeVisible()
  const manageUrl = page.url().split('?')[0]

  // reschedule to another slot
  await page.getByRole('button', { name: 'שינוי מועד' }).click()
  await expect(page.locator('.notice.accent')).toContainText('שינוי מועד')
  await page.locator('.ticket-list .ticket').nth(1).click()
  await page.locator('.ticket-row.open .btn').click()
  await page.locator('form.booker-form textarea').first().fill('התנגשות')
  await page.locator('form.booker-form button.btn-accent.btn-lg').click()
  await expect(page).toHaveURL(/#\/b\/[a-z0-9]+\?new=1/)
  expect(page.url().split('?')[0]).not.toBe(manageUrl)

  // the old link shows it moved
  await page.goto(manageUrl)
  await expect(page.locator('.stamp.mute')).toBeVisible()

  // cancel the new one
  await page.goBack()
  await page.getByRole('button', { name: 'ביטול פגישה' }).click()
  await page.locator('.card textarea').fill('לא מתאים')
  await page.getByRole('button', { name: 'כן, לבטל' }).click()
  await expect(page.locator('.stamp.mute')).toBeVisible()
  const data = await db(page)
  const mine = data.bookings.filter((b: { attendee: { email: string } }) => b.attendee.email === 'qa.tester@test.dev')
  expect(mine.map((b: { status: string }) => b.status).sort()).toEqual(['cancelled', 'cancelled'])
  done()
})

test('a taken slot disappears and double booking is rejected', async ({ page }) => {
  await go(page, '/yonatan/intro')
  await expect(page.locator('.ticket-list .ticket').first()).toBeVisible()
  const firstTime = await page.locator('.ticket-list .ticket').first().innerText()
  await pickFirstSlot(page)
  await fillInvitee(page)
  await submitBooking(page)
  await go(page, '/yonatan/intro')
  await expect(page.locator('.ticket-list .ticket').first()).toBeVisible()
  await expect(page.locator('.ticket-list .ticket').first()).not.toHaveText(firstTime)
})

test('custom questions: required, conditional, validation', async ({ page }) => {
  await go(page, '/yonatan/consult')
  await pickFirstSlot(page)
  await fillInvitee(page)
  await page.locator('form.booker-form button.btn-accent.btn-lg').click()
  await expect(page.getByText('שדה חובה')).toBeVisible()
  await expect(page.getByText('ספרו בקצרה על האתגר')).toHaveCount(0)
  await page.locator('form.booker-form select').first().selectOption('אחר')
  await expect(page.getByText('ספרו בקצרה על האתגר')).toBeVisible()
  await page.fill('input[autocomplete=email]', 'a@b.io,c@d.io')
  await page.locator('form.booker-form button.btn-accent.btn-lg').click()
  await expect(page.getByText('כתובת מייל לא תקינה')).toBeVisible()
  await page.fill('input[autocomplete=email]', 'qa.consult@test.dev')
  await page.locator('form.booker-form button.btn-accent.btn-lg').click()
  await expect(page).toHaveURL(/new=1/)
  // requires confirmation and has a deposit
  await expect(page.locator('.stamp.wait')).toBeVisible()
  await expect(page.locator('.pay-box')).toBeVisible()
})

test('personal link greets and prefills', async ({ page }) => {
  await go(page, '/yonatan/dana')
  await expect(page.locator('.greeting')).toContainText('היי דנה')
  await pickFirstSlot(page)
  await expect(page.locator('input[autocomplete=name]')).toHaveValue('דנה לוי')
})

test('URL prefill and UTM capture', async ({ page }) => {
  await go(page, '/yonatan/intro?name=Avi&email=avi%40test.dev&utm_source=newsletter')
  await pickFirstSlot(page)
  await expect(page.locator('input[autocomplete=email]')).toHaveValue('avi@test.dev')
  await submitBooking(page)
  const data = await db(page)
  const b = data.bookings.find((x: { attendee: { email: string } }) => x.attendee.email === 'avi@test.dev')
  expect(b.utm).toEqual({ utm_source: 'newsletter' })
})

test('recurring group workshop books a series', async ({ page }) => {
  await go(page, '/yonatan/workshop')
  await expect(page.locator('.ticket-list .ticket').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.ticket .seats').first()).toContainText('8')
  await page.getByLabel('חזרות').selectOption('3')
  await page.locator('.ticket-list .ticket').first().click()
  await expect(page.locator('.series-list li')).toHaveCount(3)
  await page.locator('.ticket-row.open .btn').click()
  await fillInvitee(page, 'Series', 'series@test.dev')
  await submitBooking(page)
  const data = await db(page)
  const series = data.bookings.filter((x: { attendee: { email: string } }) => x.attendee.email === 'series@test.dev')
  expect(series).toHaveLength(3)
  expect(new Set(series.map((x: { recurringId: string }) => x.recurringId)).size).toBe(1)
})

test('team round robin and collective', async ({ page }) => {
  await go(page, '/team/studio')
  await expect(page.locator('.profile-grid .index-card')).toHaveCount(2)
  await go(page, '/team/studio/discovery')
  await pickFirstSlot(page)
  await fillInvitee(page, 'RR', 'rr@test.dev')
  await submitBooking(page)
  let data = await db(page)
  const rr = data.bookings.find((x: { attendee: { email: string } }) => x.attendee.email === 'rr@test.dev')
  expect(['demo-host', 'demo-noa']).toContain(rr.ownerId)

  await go(page, '/team/studio/together')
  await pickFirstSlot(page)
  await fillInvitee(page, 'Col', 'col@test.dev')
  await submitBooking(page)
  data = await db(page)
  const col = data.bookings.find((x: { attendee: { email: string } }) => x.attendee.email === 'col@test.dev')
  expect([col.ownerId, ...col.coHostIds].sort()).toEqual(['demo-host', 'demo-noa'])
})

test('dynamic group link shows shared availability', async ({ page }) => {
  await go(page, '/yonatan+noa/intro')
  await expect(page.locator('.avatar-stack .avatar')).toHaveCount(2)
  await expect(page.locator('.ticket-list .ticket').first()).toBeVisible({ timeout: 15_000 })
})

test('routing form routes by answer', async ({ page }) => {
  await go(page, '/yonatan/forms/start')
  await page.locator('input').nth(0).fill('Router')
  await page.locator('input[type=email]').fill('router@test.dev')
  await page.locator('select').selectOption('סתם שאלה')
  await page.getByRole('button', { name: 'המשך' }).click()
  await expect(page.locator('.route-msg')).toContainText('hello@example.com')

  await page.reload()
  await page.locator('input').nth(0).fill('Router')
  await page.locator('input[type=email]').fill('router@test.dev')
  await page.locator('select').selectOption('ייעוץ אסטרטגי')
  await page.getByRole('button', { name: 'המשך' }).click()
  await expect(page).toHaveURL(/#\/yonatan\/consult\?/)
  await pickFirstSlot(page)
  await expect(page.locator('input[autocomplete=email]')).toHaveValue('router@test.dev')
})

test('poll vote is private and editable only by the voter', async ({ page }) => {
  await go(page, '/yonatan')
  const pollId = (await db(page)).polls[0].id
  await go(page, '/p/' + pollId)
  await page.locator('.vote-btn').first().click()
  await page.locator('form input').first().fill('בודק')
  await page.locator('form input[type=email]').fill('michal@example.com') // same email as an existing voter
  await page.getByRole('button', { name: 'שליחת ההצבעה' }).click()
  await expect(page.locator('.notice')).toContainText('תודה')
  const data = await db(page)
  expect(data.polls[0].voters).toHaveLength(3) // did not overwrite Michal
  expect(data.polls[0].voters.find((v: { name: string }) => v.name === 'מיכל').votes).toEqual(['yes', 'no', 'yes', 'maybe'])
})

test('embed mode hides chrome and posts events', async ({ page }) => {
  await go(page, '/yonatan/intro?embed=1')
  await expect(page.locator('.ticket-list .ticket').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.public-top')).toHaveCount(0)
})

test('english and dark mode', async ({ page }) => {
  const done = watchErrors(page)
  await go(page, '/yonatan/intro')
  await page.getByRole('button', { name: 'language' }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  await expect(page.getByText('Meeting with')).toBeVisible()
  await page.getByRole('button', { name: 'theme' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', /dark|light/)
  done()
})
