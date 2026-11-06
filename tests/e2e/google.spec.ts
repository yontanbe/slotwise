/**
 * Google Calendar / Meet / Gmail integration, end to end against an in-test fake Google
 * (see google-mock.ts). No real client id exists, so the GIS script and every googleapis.com
 * call are served by Playwright routes.
 */
import { expect, test, type Page } from '@playwright/test'
import { DateTime } from 'luxon'
import { db, enterDemo, fillInvitee, go, submitBooking, watchErrors } from './helpers'
import { CLIENT_ID, HOLIDAYS_CAL_ID, HOST_GOOGLE_EMAIL, HOST_SCOPES, installGoogle, PRIMARY_ID, SCOPE, TEAM_CAL_ID, type GoogleMock } from './google-mock'

test.use({ serviceWorkers: 'block' })

const TZ = 'Asia/Jerusalem'
const HOST_ID = 'demo-host'
const INVITEE = 'invitee.one@test.dev'
const GUESTS = ['guest.a@test.dev', 'guest.b@test.dev']

type Booking = {
  id: string
  token: string
  start: string
  end: string
  status: string
  attendee: { email: string; name: string }
  guests: string[]
  emailsSent?: string[]
  rescheduledFromId?: string
  rescheduledToId?: string
  google?: { eventId?: string; meetUrl?: string; syncedAt?: string; error?: string }
}

const googleEventId = (bookingId: string) => 'slot' + Array.from(bookingId, (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')

async function bookings(page: Page): Promise<Booking[]> {
  return (await db(page)).bookings
}
async function bookingOf(page: Page, email: string, status = 'accepted') {
  return (await bookings(page)).find((b) => b.attendee.email === email && b.status === status)
}
const gtoken = (page: Page) => page.evaluate(() => sessionStorage.getItem('slotwise:gtoken'))

/** Patches the demo host in the local db (after the seed exists). */
async function patchHost(page: Page, patch: Record<string, unknown>) {
  await page.evaluate(
    ({ id, patch }) => {
      const d = JSON.parse(localStorage.getItem('slotwise:db') || '{}')
      d.users = d.users.map((u: { id: string }) => (u.id === id ? { ...u, ...patch } : u))
      localStorage.setItem('slotwise:db', JSON.stringify(d))
    },
    { id: HOST_ID, patch },
  )
}

/** Seeds the demo db by opening the app once, then sets host Google settings. */
async function hostWithGoogle(page: Page, google: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  await go(page, '/yonatan')
  await expect(page.locator('h1')).toContainText('יונתן')
  await patchHost(page, { google: { conflictCalendars: ['primary'], destinationCalendar: 'primary', sendWithGmail: false, email: HOST_GOOGLE_EMAIL, ...google }, ...extra })
}

/** The first offered slot on the open booking page, as a Luxon DateTime in Asia/Jerusalem. */
async function offered(page: Page) {
  await expect(page.locator('.ticket-list .ticket').first()).toBeVisible({ timeout: 15_000 })
  const date = (await page.locator('.month-day.selected').getAttribute('aria-label'))!
  const times = (await page.locator('.ticket-list .ticket > span.ltr').allInnerTexts()).map((t) => t.trim())
  return { date, times, at: (hhmm: string) => DateTime.fromISO(`${date}T${hhmm}`, { zone: TZ }) }
}

async function pickTicket(page: Page, n = 0) {
  await expect(page.locator('.ticket-list .ticket').first()).toBeVisible({ timeout: 15_000 })
  await page.locator('.ticket-list .ticket').nth(n).click()
  await page.locator('.ticket-row.open .btn').click()
  await expect(page.locator('form.booker-form')).toBeVisible()
}

async function addGuests(page: Page, guests: string[]) {
  const input = page.locator('form.booker-form input[placeholder="guest@email.com"]')
  for (const g of guests) {
    await input.fill(g)
    await input.press('Enter')
  }
}

/** Book intro on the public page as an invitee (same browser as the host). */
async function bookIntro(page: Page, email = INVITEE, guests: string[] = GUESTS, slotIndex = 0) {
  await go(page, '/yonatan/intro')
  await pickTicket(page, slotIndex)
  await fillInvitee(page, 'דנה בודקת', email)
  if (guests.length) await addGuests(page, guests)
  await submitBooking(page)
  await expect(page.locator('.confirm-hero h1')).toBeVisible()
}

/** Clicks "Sync now" until a real (non skipped) run reports back. */
async function syncNow(page: Page, opts: { allowError?: boolean } = {}) {
  const btn = page.locator('.integ button', { hasText: /סנכרון עכשיו|מסנכרן/ })
  if (opts.allowError) {
    // the run that hits the expired token: the page reports the error and switches to "not connected"
    await expect(btn).toBeEnabled()
    await btn.click()
    const report = page.locator('.integ .notice', { hasText: /expired|google_/ })
    await expect(report).toBeVisible({ timeout: 10_000 })
    return report.innerText()
  }
  for (let i = 0; i < 20; i++) {
    await expect(btn).toBeEnabled()
    await btn.click()
    await expect(btn).toHaveText(/סנכרון עכשיו/)
    const report = page.locator('.integ .notice')
    await expect(report).toBeVisible()
    const txt = await report.innerText()
    // a run skipped because another run held the lock reports busy blocks as "—" and no errors
    if (!/—/.test(txt) || (opts.allowError && /expired|google_/.test(txt))) return txt
    await page.waitForTimeout(250)
  }
  throw new Error('sync never ran')
}

async function openIntegrations(page: Page) {
  await go(page, '/app/integrations')
  await expect(page.locator('.integ h3').first()).toContainText('Google Calendar')
}

const stamp = (page: Page) => page.locator('.integ').first().locator('.stamp')

let mock: GoogleMock
let done: () => void
test.beforeEach(async ({ page }) => {
  done = watchErrors(page)
  mock = await installGoogle(page)
  // skip the first-run product tour (its scrim would cover the integrations page)
  await page.context().addInitScript(() => {
    try {
      localStorage.setItem('slotwise:tour:demo-host', '1')
    } catch {
      /* about:blank */
    }
  })
})
test.afterEach(async () => {
  // fake Google never saw a request it could not answer
  expect(mock.requests.filter((r) => r.status === 404 && !/events\//.test(r.path)).map((r) => `${r.method} ${r.path}`)).toEqual([])
  done()
})

test('1. connect Google from integrations, load calendars, persist conflict and destination calendars', async ({ page }) => {
  await enterDemo(page)
  await openIntegrations(page)
  await expect(stamp(page)).toHaveText('לא מחובר')
  await expect(page.locator('.integ input.input.ltr')).toHaveValue(CLIENT_ID)

  await page.getByRole('button', { name: 'חיבור Google' }).click()
  await expect(stamp(page)).toHaveText('מחובר')
  await expect(page.locator('.integ .chip.ltr', { hasText: HOST_GOOGLE_EMAIL })).toBeVisible()

  // one consent request with the host scopes, for the configured client
  expect(mock.gisCalls).toHaveLength(1)
  expect(mock.gisCalls[0].client_id).toBe(CLIENT_ID)
  expect(mock.gisCalls[0].scope.split(' ').sort()).toEqual(HOST_SCOPES.split(' ').sort())
  const tok = JSON.parse((await gtoken(page))!)
  expect(tok.access_token).toBe('tok')
  expect(tok.scope.split(' ')).toContain(SCOPE.gmailSend)
  // every API call carried the bearer token
  expect(mock.requests.length).toBeGreaterThan(0)
  expect(mock.requests.every((r) => r.auth === 'Bearer tok')).toBe(true)

  // calendars loaded: primary checked by default, team calendar unchecked
  const box = (name: string) => page.locator('.integ label.check', { hasText: name }).locator('input')
  await expect(box('Yonatan')).toBeChecked()
  await expect(box('Team')).not.toBeChecked()
  await expect(box('Holidays')).not.toBeChecked()
  // destination calendar only offers writable calendars
  const dest = page.locator('.integ select')
  await expect(dest.locator('option')).toHaveText(['יומן ראשי', 'Team'])

  await box('Team').check()
  await expect(box('Team')).toBeChecked()
  await dest.selectOption(TEAM_CAL_ID)
  await expect.poll(async () => (await db(page)).users.find((u: { id: string }) => u.id === HOST_ID).google).toMatchObject({
    email: HOST_GOOGLE_EMAIL,
    conflictCalendars: ['primary', TEAM_CAL_ID],
    destinationCalendar: TEAM_CAL_ID,
  })

  // survives a reload (token in sessionStorage, settings in the store)
  await page.reload()
  await expect(stamp(page)).toHaveText('מחובר')
  await page.locator('.integ button.link', { hasText: 'טעינה' }).click()
  await expect(box('Team')).toBeChecked()
  await expect(dest).toHaveValue(TEAM_CAL_ID)

  // the busy pull checks exactly the chosen calendars
  mock.requests.length = 0
  await syncNow(page)
  const fb = mock.api({ method: 'POST', path: '/calendar/v3/freeBusy' })
  expect(fb.length).toBeGreaterThan(0)
  expect((fb.at(-1)!.body as { items: { id: string }[] }).items.map((i) => i.id).sort()).toEqual(['primary', TEAM_CAL_ID].sort())
  expect(mock.requests.some((r) => (r.body as { items?: { id: string }[] })?.items?.some((i) => i.id === HOLIDAYS_CAL_ID))).toBe(false)

  // a settings change made while a sync is in flight is not overwritten by that sync
  mock.freeBusyDelayMs = 1500
  const btn = page.locator('.integ button', { hasText: /סנכרון עכשיו/ })
  await btn.click()
  await expect(page.locator('.integ button', { hasText: 'מסנכרן…' })).toBeVisible()
  await dest.selectOption('primary')
  await expect(page.locator('.integ button', { hasText: 'סנכרון עכשיו' })).toBeEnabled({ timeout: 10_000 })
  await page.waitForTimeout(300)
  const g = (await db(page)).users.find((u: { id: string }) => u.id === HOST_ID).google
  expect(g.destinationCalendar).toBe('primary')
  expect(g.lastSyncAt).toBeTruthy()
})

test('2. busy pull hides Google busy slots and never blocks the host on its own bookings', async ({ page }) => {
  await mock.seedHostToken()
  await hostWithGoogle(page)

  // what is offered with no Google busy at all
  await go(page, '/yonatan/intro')
  const before = await offered(page)
  expect(before.times.length).toBeGreaterThan(2)
  const blocked = before.at(before.times[0])
  // busy on the primary calendar covers the first slot; busy on an unchecked calendar is ignored
  mock.busy[PRIMARY_ID] = [{ start: blocked.minus({ minutes: 5 }).toUTC().toISO()!, end: blocked.plus({ minutes: 10 }).toUTC().toISO()! }]
  const ignored = before.at(before.times[1])
  mock.busy[TEAM_CAL_ID] = [{ start: ignored.toUTC().toISO()!, end: ignored.plus({ minutes: 20 }).toUTC().toISO()! }]

  // a seated workshop booked by an invitee becomes a Google event (and so a Google busy block)
  // (via the profile: hash-navigating intro -> workshop keeps Booker's 20 min duration, see report)
  await go(page, '/yonatan')
  await go(page, '/yonatan/workshop')
  const ws = await offered(page)
  await expect(page.locator('.ticket-list .ticket').first()).toContainText('8')
  await pickTicket(page, 0)
  await fillInvitee(page, 'משתתף סדנה', 'seat.one@test.dev')
  await submitBooking(page)
  await expect.poll(() => mock.liveEvents().length).toBe(1)
  const wsBooking = (await bookingOf(page, 'seat.one@test.dev'))!

  await enterDemo(page)
  await openIntegrations(page)
  await syncNow(page)

  const fb = mock.api({ method: 'POST', path: '/calendar/v3/freeBusy' }).at(-1)!
  expect((fb.body as { items: { id: string }[] }).items).toEqual([{ id: 'primary' }])
  const busy = (await db(page)).busy[HOST_ID] as { start: string; end: string; source: string }[]
  const gBusy = busy.filter((b) => b.source === 'google')
  // the external block is there, the host's own workshop event was subtracted
  const ext = mock.busy[PRIMARY_ID][0]
  expect(gBusy).toEqual([{ start: new Date(ext.start).toISOString(), end: new Date(ext.end).toISOString(), source: 'google' }])
  expect(gBusy.some((b) => b.start < wsBooking.end && b.end > wsBooking.start)).toBe(false)

  // invitee view: the busy slot is gone, the others stay
  await go(page, '/yonatan/intro')
  await expect(page.locator('.ticket-list .ticket').first()).toBeVisible({ timeout: 15_000 })
  await page.locator(`.month-day[aria-label="${before.date}"]`).click()
  const after = (await page.locator('.ticket-list .ticket > span.ltr').allInnerTexts()).map((t) => t.trim())
  expect(after).not.toContain(before.times[0])
  expect(after).toContain(before.times[1])
  expect(after).toContain(before.times[2])

  // seats: the workshop slot is still bookable, with one seat taken
  await go(page, '/yonatan/workshop')
  await expect(page.locator('.ticket-list .ticket').first()).toBeVisible({ timeout: 15_000 })
  await page.locator(`.month-day[aria-label="${ws.date}"]`).click()
  const wsTicket = page.locator('.ticket-list .ticket', { hasText: ws.times[0] })
  await expect(wsTicket).toBeVisible()
  await expect(wsTicket).toContainText('7')
})

test('3. a public booking creates exactly one Google event with Meet, attendees and a deterministic id', async ({ page }) => {
  await mock.seedHostToken()
  await hostWithGoogle(page)
  await bookIntro(page)

  // confirmation shows the Meet link once the host's browser created the event
  await expect(page.getByText(/https:\/\/meet\.google\.com\/[a-z0-9-]+/).first()).toBeVisible({ timeout: 10_000 })
  const b = (await bookingOf(page, INVITEE))!
  const ins = mock.inserts()
  expect(ins).toHaveLength(1)
  const body = ins[0].body as Record<string, any>
  expect(ins[0].path).toBe('/calendar/v3/calendars/primary/events')
  expect(ins[0].query.get('conferenceDataVersion')).toBe('1')
  expect(ins[0].query.get('sendUpdates')).toBe('all')
  expect(body.id).toBe(googleEventId(b.id))
  expect(body.id).toMatch(/^[a-v0-9]{5,1024}$/)
  expect(body.conferenceData).toEqual({ createRequest: { requestId: b.id, conferenceSolutionKey: { type: 'hangoutsMeet' } } })
  expect(body.attendees).toEqual([{ email: INVITEE, displayName: 'דנה בודקת' }, ...GUESTS.map((email) => ({ email }))])
  expect(body.start).toEqual({ dateTime: b.start })
  expect(body.end).toEqual({ dateTime: b.end })
  const ev = mock.events.get(body.id)!
  expect(b.google).toMatchObject({ eventId: ev.id, meetUrl: ev.hangoutLink })
  await expect(page.getByText(ev.hangoutLink!).first()).toBeVisible()

  // host opens the dashboard and syncs twice: nothing new
  await enterDemo(page)
  await openIntegrations(page)
  await syncNow(page)
  await syncNow(page)
  expect(mock.inserts()).toHaveLength(1)

  // the event id was lost (crash between insert and save): the retry hits 409 and adopts the existing event
  await page.evaluate((id) => {
    const d = JSON.parse(localStorage.getItem('slotwise:db')!)
    const x = d.bookings.find((y: { id: string }) => y.id === id)
    delete x.google
    localStorage.setItem('slotwise:db', JSON.stringify(d))
  }, b.id)
  await syncNow(page)
  expect(mock.inserts()).toHaveLength(2)
  expect(mock.inserts()[1].status).toBe(409)
  expect(mock.api({ method: 'GET', path: `/calendar/v3/calendars/primary/events/${ev.id}` })).toHaveLength(1)
  expect(mock.liveEvents()).toHaveLength(1)
  expect((await bookingOf(page, INVITEE))!.google).toMatchObject({ eventId: ev.id, meetUrl: ev.hangoutLink })

  // two tabs syncing a brand new booking at the same time create one event
  const twinId = 'twin' + Date.now().toString(36)
  await page.evaluate(
    ({ src, twinId }) => {
      const d = JSON.parse(localStorage.getItem('slotwise:db')!)
      const o = d.bookings.find((y: { id: string }) => y.id === src)
      const s = new Date(Date.parse(o.start) + 2 * 864e5).toISOString()
      const e = new Date(Date.parse(o.end) + 2 * 864e5).toISOString()
      d.bookings.push({ ...o, id: twinId, token: twinId + 'tk', start: s, end: e, google: undefined, attendee: { ...o.attendee, email: 'twin@test.dev' }, guests: [] })
      localStorage.setItem('slotwise:db', JSON.stringify(d))
    },
    { src: b.id, twinId },
  )
  const page2 = await page.context().newPage()
  await go(page2, '/app/integrations')
  await expect(page2.locator('.integ h3').first()).toBeVisible()
  await Promise.all([syncNow(page), syncNow(page2)])
  await syncNow(page)
  expect(mock.liveEvents().filter((e) => e.id === googleEventId(twinId))).toHaveLength(1)
  expect(mock.liveEvents()).toHaveLength(2)
  expect((await bookingOf(page, 'twin@test.dev'))!.google?.eventId).toBe(googleEventId(twinId))
  await page2.close()
})

test('4. reschedule patches the same event, cancel deletes it, example.com seeds are never pushed', async ({ page }) => {
  await mock.seedHostToken()
  await hostWithGoogle(page)
  await bookIntro(page, INVITEE, [])
  await expect(page.getByText(/https:\/\/meet\.google\.com\//).first()).toBeVisible({ timeout: 10_000 })
  const first = (await bookingOf(page, INVITEE))!
  const evId = first.google!.eventId!

  // reschedule through the manage link
  await page.getByRole('button', { name: 'שינוי מועד' }).click()
  await expect(page.locator('.notice.accent')).toContainText('שינוי מועד')
  await pickTicket(page, 1)
  await page.locator('form.booker-form textarea').first().fill('התנגשות')
  await page.locator('form.booker-form button.btn-accent.btn-lg').click()
  await expect(page).toHaveURL(/#\/b\/[a-z0-9]+\?new=1/)
  await expect.poll(() => mock.api({ method: 'PATCH' }).length).toBe(1)
  const moved = (await bookingOf(page, INVITEE))!
  expect(moved.id).not.toBe(first.id)
  expect(moved.start).not.toBe(first.start)
  const p = mock.api({ method: 'PATCH' })[0]
  expect(p.path).toBe(`/calendar/v3/calendars/primary/events/${evId}`)
  expect(p.query.get('sendUpdates')).toBe('all')
  expect(p.body).toEqual({ start: { dateTime: moved.start }, end: { dateTime: moved.end } })
  expect(mock.events.get(evId)!.start.dateTime).toBe(moved.start)
  await expect.poll(async () => (await bookingOf(page, INVITEE))!.google?.syncedAt).toBeTruthy()
  expect((await bookingOf(page, INVITEE))!.google?.eventId).toBe(evId)
  expect(mock.inserts()).toHaveLength(1)
  expect(mock.api({ method: 'DELETE' })).toHaveLength(0)
  // the Meet link carries over to the new confirmation
  await expect(page.getByText(mock.events.get(evId)!.hangoutLink!).first()).toBeVisible()

  // cancel the moved booking
  await page.getByRole('button', { name: 'ביטול פגישה' }).click()
  await page.locator('.card textarea').fill('לא מתאים')
  await page.getByRole('button', { name: 'כן, לבטל' }).click()
  await expect(page.locator('.stamp.mute')).toBeVisible()
  await expect.poll(() => mock.api({ method: 'DELETE' }).length).toBe(1)
  expect(mock.api({ method: 'DELETE' })[0].path).toBe(`/calendar/v3/calendars/primary/events/${evId}`)
  expect(mock.events.get(evId)!.status).toBe('cancelled')
  await expect.poll(async () => (await bookingOf(page, INVITEE, 'cancelled')) && (await bookings(page)).filter((x) => x.attendee.email === INVITEE).every((x) => !x.google?.eventId)).toBe(true)

  // host dashboard sync: seed bookings (example.com) never reach Google, nothing is re-created
  await enterDemo(page)
  await openIntegrations(page)
  await syncNow(page)
  await syncNow(page)
  expect(mock.inserts()).toHaveLength(1)
  expect(mock.api({ method: 'DELETE' })).toHaveLength(1)
  const writes = mock.requests.filter((r) => r.method !== 'GET' && !r.path.endsWith('/freeBusy'))
  expect(JSON.stringify(writes.map((r) => r.body))).not.toContain('@example.com')
  expect(mock.sent).toHaveLength(0) // sendWithGmail is off
})

test('5. Gmail sends one confirmation per recipient with safe headers, manage link and a UTC ICS', async ({ page }) => {
  await mock.seedHostToken()
  await hostWithGoogle(page, { sendWithGmail: true }, { email: HOST_GOOGLE_EMAIL })
  await bookIntro(page)
  await expect.poll(() => mock.sent.length).toBe(2)
  const b = (await bookingOf(page, INVITEE))!

  // a later sync sends nothing again
  await enterDemo(page)
  await openIntegrations(page)
  await syncNow(page)
  await syncNow(page)
  expect(mock.sent.map((m) => m.to).sort()).toEqual([INVITEE, HOST_GOOGLE_EMAIL].sort())

  for (const m of mock.sent) {
    // exactly one To, no Cc / Bcc, no bare CR or LF inside the header block
    expect(m.headerLines.filter((l) => /^to:/i.test(l))).toHaveLength(1)
    expect(m.headerLines.some((l) => /^(bcc|cc):/i.test(l))).toBe(false)
    const headerBlock = m.mime.slice(0, m.mime.indexOf('\r\n\r\n'))
    expect(headerBlock).not.toMatch(/\r(?!\n)|(?<!\r)\n/)
    // RFC 2047 subject: only encoded words, each at most 75 characters
    const subj = m.headers['subject']
    expect(subj).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=(\s+=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=)*$/)
    for (const w of subj.split(/\s+/)) expect(w.length).toBeLessThanOrEqual(75)
    for (const l of m.headerLines) expect(l.length).toBeLessThanOrEqual(998)
    expect(m.raw).toMatch(/^[A-Za-z0-9_-]+$/) // base64url, no padding
  }

  const inv = mock.sent.find((m) => m.to === INVITEE)!
  expect(inv.subject).toBe('הפגישה נקבעה: שיחת היכרות עם יונתן בן דוד')
  expect(inv.text).toContain('היי דנה בודקת')
  expect(inv.text).toContain(`#/b/${b.token}`)
  expect(inv.text).toContain(b.google!.meetUrl!)
  expect(inv.ics).toBeTruthy()
  const ics = inv.ics!
  const utc = (iso: string) => DateTime.fromISO(iso).toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'")
  expect(ics).toContain('BEGIN:VCALENDAR')
  expect(ics).toMatch(new RegExp(`\\r\\nDTSTART:${utc(b.start)}\\r\\n`))
  expect(ics).toMatch(new RegExp(`\\r\\nDTEND:${utc(b.end)}\\r\\n`))
  expect(ics).toContain(`UID:${b.id}@slotwise`)
  const icsPart = inv.parts.find((p) => /text\/calendar/.test(p.headers['content-type']))!
  expect(icsPart.headers['content-disposition']).toMatch(/attachment; filename="invite\.ics"/)

  const host = mock.sent.find((m) => m.to === HOST_GOOGLE_EMAIL)!
  expect(host.subject).toBe('פגישה חדשה: דנה בודקת · שיחת היכרות')
  expect(host.ics).toBeUndefined()
  // guests are on the Google invite, not mailed by Slotwise
  expect(mock.sent.some((m) => GUESTS.includes(m.to))).toBe(false)
  const out = (await db(page)).outbox.filter((o: { bookingId: string }) => o.bookingId === b.id)
  expect(out.map((o: { status: string; via: string }) => `${o.status}/${o.via}`).sort()).toEqual(['sent/gmail', 'sent/gmail'])

  // crafted addresses never reach Gmail: the form rejects them ...
  const crafted = 'a@b.io\r\nBcc: x@y.io'
  await go(page, '/yonatan/intro')
  await pickTicket(page, 2)
  await page.fill('input[autocomplete=name]', 'מזיק')
  await page.locator('input[autocomplete=email]').evaluate((el: HTMLInputElement, v) => {
    // bypass input sanitising: set React state through the native setter with CR/LF intact
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    el.type = 'text'
    set.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, crafted)
  await page.locator('form.booker-form button.btn-accent.btn-lg').click()
  await expect(page.locator('input[autocomplete=email].err')).toBeVisible()
  await expect(page).not.toHaveURL(/#\/b\//)
  // ... so does URL prefill ...
  await go(page, '/yonatan')
  await go(page, '/yonatan/intro?email=' + encodeURIComponent(crafted) + '&name=x')
  await pickTicket(page, 2)
  await page.locator('form.booker-form button.btn-accent.btn-lg').click()
  await expect(page.locator('input[autocomplete=email].err')).toBeVisible()
  // ... and a booking that got into the store some other way is refused by sendGmail itself
  await page.evaluate(
    ({ src, crafted }) => {
      const d = JSON.parse(localStorage.getItem('slotwise:db')!)
      const o = d.bookings.find((y: { id: string }) => y.id === src)
      d.bookings.push({ ...o, id: 'evil' + Date.now().toString(36), token: 'eviltoken' + Date.now(), start: new Date(Date.parse(o.start) + 3 * 864e5).toISOString(), end: new Date(Date.parse(o.end) + 3 * 864e5).toISOString(), google: undefined, emailsSent: [], webhooksSent: [], attendee: { ...o.attendee, email: crafted }, guests: [] })
      localStorage.setItem('slotwise:db', JSON.stringify(d))
    },
    { src: b.id, crafted },
  )
  await openIntegrations(page)
  await syncNow(page)
  await expect.poll(async () => (await db(page)).outbox.some((o: { to: string; status: string }) => o.to === crafted && o.status === 'failed')).toBe(true)
  for (const m of mock.sent) {
    expect(m.mime).not.toMatch(/bcc/i)
    expect(m.mime).not.toContain('x@y.io')
    expect(m.mime).not.toContain('a@b.io')
  }
  expect(mock.sent.filter((m) => m.to === HOST_GOOGLE_EMAIL).length).toBeGreaterThanOrEqual(1)
})

test('5b. without the gmail.send scope nothing is sent through Gmail', async ({ page }) => {
  await mock.seedHostToken('tok', [SCOPE.calendarRead, SCOPE.events, SCOPE.email].join(' '))
  await hostWithGoogle(page, { sendWithGmail: true }, { email: HOST_GOOGLE_EMAIL })
  await bookIntro(page, INVITEE, [])
  await expect.poll(() => mock.liveEvents().length).toBe(1)
  await expect.poll(async () => (await db(page)).outbox.filter((o: { to: string }) => o.to === INVITEE).length).toBe(1)
  expect(mock.api({ path: /gmail/ })).toHaveLength(0)
  expect((await db(page)).outbox.find((o: { to: string }) => o.to === INVITEE).status).toBe('logged')
})

test('6. a 401 clears the token, keeps the last Google busy blocks, and reconnect works', async ({ page }) => {
  await enterDemo(page)
  await openIntegrations(page)
  await page.getByRole('button', { name: 'חיבור Google' }).click()
  await expect(stamp(page)).toHaveText('מחובר')
  const soon = DateTime.now().setZone(TZ).plus({ days: 10 }).set({ hour: 7, minute: 0, second: 0, millisecond: 0 })
  mock.busy[PRIMARY_ID] = [{ start: soon.toUTC().toISO()!, end: soon.plus({ hours: 1 }).toUTC().toISO()! }]
  await syncNow(page)
  const googleBlocks = async () => ((await db(page)).busy[HOST_ID] as { source: string }[]).filter((x) => x.source === 'google').length
  expect(await googleBlocks()).toBe(1)

  // Google revokes / expires the token
  mock.validTokens.clear()
  const txt = await syncNow(page, { allowError: true })
  expect(txt).toContain('expired')
  expect(await gtoken(page)).toBeNull()
  // leaving and coming back shows "not connected"
  await go(page, '/app')
  await openIntegrations(page)
  await expect(stamp(page)).toHaveText('לא מחובר')
  // a sync without Google (the dashboard syncs on load) must not wipe the last known Google busy times.
  // A stale marker block lets us see that the run happened: replaceBusy drops it.
  await page.evaluate((id) => {
    const d = JSON.parse(localStorage.getItem('slotwise:db')!)
    d.busy[id].push({ start: '2099-01-01T00:00:00.000Z', end: '2099-01-02T00:00:00.000Z', source: 'ooo' })
    localStorage.setItem('slotwise:db', JSON.stringify(d))
  }, HOST_ID)
  await page.reload()
  await expect(stamp(page)).toHaveText('לא מחובר')
  await expect.poll(async () => JSON.stringify((await db(page)).busy[HOST_ID])).not.toContain('2099-01-01')
  expect(await googleBlocks()).toBe(1)

  // reconnect with a fresh token
  mock.nextToken = 'tok-2'
  await page.getByRole('button', { name: 'חיבור Google' }).click()
  await expect(stamp(page)).toHaveText('מחובר')
  expect(JSON.parse((await gtoken(page))!).access_token).toBe('tok-2')
  mock.requests.length = 0
  await syncNow(page)
  expect(mock.requests.length).toBeGreaterThan(0)
  expect(mock.requests.every((r) => r.auth === 'Bearer tok-2' && r.status === 200)).toBe(true)
})

test('6b. the integrations page notices the expiry in place', async ({ page }) => {
  await mock.seedHostToken()
  await enterDemo(page)
  await openIntegrations(page)
  await expect(stamp(page)).toHaveText('מחובר')
  mock.validTokens.clear()
  await syncNow(page, { allowError: true })
  await expect(stamp(page)).toHaveText('לא מחובר', { timeout: 8000 })
})

test('7. invitee calendar overlay: read-only scope, clash marks, nothing stored', async ({ page }) => {
  await go(page, '/yonatan/intro')
  const o = await offered(page)
  const s = o.at(o.times[0])
  mock.inviteeBusy = [{ start: s.toUTC().toISO()!, end: s.plus({ minutes: 20 }).toUTC().toISO()! }]
  const storage = () => page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]))
  const before = await storage()

  await page.getByRole('button', { name: 'הצגת היומן שלי' }).click()
  await expect(page.locator('.ticket-list .ticket.clash')).toHaveCount(1)
  await expect(page.locator('.ticket-list .ticket').first()).toHaveClass(/clash/)
  await expect(page.locator('.ticket-list .ticket').nth(1)).not.toHaveClass(/clash/)
  await expect(page.locator('.ticket-list .ticket.clash')).toContainText('תפוס אצלך')

  expect(mock.gisCalls).toHaveLength(1)
  expect(mock.gisCalls[0].scope).toBe(SCOPE.calendarRead)
  const fb = mock.api({ method: 'POST', path: '/calendar/v3/freeBusy' })
  expect(fb).toHaveLength(1)
  expect(fb[0].auth).toBe('Bearer tok-invitee')
  expect((fb[0].body as { items: unknown }).items).toEqual([{ id: 'primary' }])
  // only freeBusy was called: no calendar list, no events, no userinfo
  expect(mock.requests.map((r) => r.path)).toEqual(['/calendar/v3/freeBusy'])

  const after = await storage()
  expect(after).toBe(before)
  expect(after).not.toContain('tok-invitee')

  await page.getByRole('button', { name: 'הסתרת היומן שלי' }).click()
  await expect(page.locator('.ticket-list .ticket.clash')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'הצגת היומן שלי' })).toBeVisible()
  expect(await storage()).toBe(before)
})

test('8. sign out disconnects Google', async ({ page }) => {
  await enterDemo(page)
  await openIntegrations(page)
  await page.getByRole('button', { name: 'חיבור Google' }).click()
  await expect(stamp(page)).toHaveText('מחובר')
  expect(await gtoken(page)).not.toBeNull()

  await page.getByRole('button', { name: 'יציאה' }).click()
  await expect(page.locator('.rail')).toHaveCount(0)
  expect(await gtoken(page)).toBeNull()
  await expect.poll(() => mock.revoked).toEqual(['tok'])

  await enterDemo(page)
  await openIntegrations(page)
  await expect(stamp(page)).toHaveText('לא מחובר')
})

test('8b. sign out after a reload (GIS not loaded yet) still removes and revokes the token', async ({ page }) => {
  await mock.seedHostToken()
  await enterDemo(page)
  await openIntegrations(page)
  await expect(stamp(page)).toHaveText('מחובר')
  await page.getByRole('button', { name: 'יציאה' }).click()
  await expect(page.locator('.rail')).toHaveCount(0)
  expect(await gtoken(page)).toBeNull()
  await expect.poll(() => mock.revoked).toEqual(['tok'])
})
