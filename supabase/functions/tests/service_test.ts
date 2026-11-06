import { assert, assertEquals, assertRejects } from '@std/assert'
import { createService, type Caller } from '../_shared/service.ts'
import type { AuditEntry, Booking, Schedule } from '../_shared/types.ts'
import { sha256Hex } from '../_shared/util.ts'
import { MemoryRepo } from './fakes.ts'

const OWNER = '00000000-0000-0000-0000-000000000001'
const NOW = new Date('2030-01-01T00:00:00Z') // a Tuesday
const caller: Caller = { ownerId: OWNER, apiKeyId: 'k1', keyName: 'test', scopes: ['read', 'write'], actor: 'mcp', client: 'claude-ai' }

function world() {
  const repo = new MemoryRepo()
  repo.seed('profile', OWNER, 'prof', {
    id: OWNER, name: 'Host', email: 'host@example.com', username: 'host', timezone: 'UTC', locale: 'en', weekStart: 0,
    defaultScheduleId: 's1', blockedEmails: [], phone: '', shabbat: { enabled: false, city: 'Jerusalem', blockHolidays: false, showHebrewDate: false },
  })
  const day = [{ start: '09:00', end: '17:00' }]
  repo.seed('schedule', OWNER, 's1', { id: 's1', ownerId: OWNER, name: 'Work', timezone: 'UTC', weekly: [day, day, day, day, day, day, day], overrides: [] })
  repo.seed('event_type', OWNER, 'et1', {
    id: 'et1', ownerId: OWNER, title: 'Intro', durations: [30], defaultDuration: 30, scheduleId: 's1', bufferBefore: 0, bufferAfter: 0,
    minNoticeMins: 0, window: { type: 'rolling', days: 30 }, slotInterval: null, limits: {}, firstSlotOnly: false, seats: null,
    preferred: [], locations: [{ type: 'meet' }], requiresConfirmation: false, hidden: false, position: 0,
  })
  let n = 0
  repo.rpcs.public_busy = () => ({ bookings: [], busy: [] })
  repo.rpcs.public_create_booking = (a) => {
    const p = a.p_booking as Record<string, unknown>
    // like _clean_booking: client ids are not accepted
    assertEquals(p.id, undefined)
    assertEquals(p.token, undefined)
    const b = { ...p, id: 'srv' + ++n, token: 'tok' + n + 'xxxxxxxxxx', status: 'accepted', title: 'Intro', history: [{ at: NOW.toISOString(), action: 'created', by: 'invitee' }], createdAt: NOW.toISOString() }
    repo.seed('booking', OWNER, b.id, b)
    return { ok: true, booking: b }
  }
  const svc = createService({ repo, now: () => NOW })
  return { repo, svc }
}

const input = { eventTypeId: 'et1', start: '2030-01-02T09:00:00Z', attendee: { name: 'Dana', email: 'dana@example.com' } }

Deno.test('authenticate resolves the owner from the sha-256 of the key', async () => {
  const { repo, svc } = world()
  const key = 'sw_live_abcdefghijklmnop'
  repo.seed('api_key', OWNER, 'k1', { id: 'k1', ownerId: OWNER, name: 'CLI', prefix: key.slice(0, 8), hash: await sha256Hex(key), scopes: ['read'], createdAt: '' })
  const auth = await svc.authenticate(key)
  assertEquals(auth, { ownerId: OWNER, apiKeyId: 'k1', keyName: 'CLI', scopes: ['read'] })
  assertEquals(await svc.authenticate('sw_live_wrongwrongwrong'), null)
  assertEquals(await svc.authenticate('not-a-key'), null)
  await new Promise((r) => setTimeout(r, 0))
  assertEquals((repo.rows.get('k1')!.data as { lastUsedAt?: string }).lastUsedAt, NOW.toISOString())
  // read-only keys cannot write
  await assertRejects(() => svc.createBooking({ ...auth!, actor: 'api', client: 'x' }, input), Error, "'write' scope")
})

Deno.test('availability is grouped in the invitee timezone', async () => {
  const { svc } = world()
  const a = await svc.getAvailability(caller, { eventTypeId: 'et1', from: '2030-01-02', to: '2030-01-02', timezone: 'Asia/Jerusalem' })
  assertEquals(a.slots.length, 16) // 09:00-17:00 UTC in 30 minute steps
  assertEquals(a.days[0], { date: '2030-01-02', times: a.slots.map((s) => s.local) })
  assertEquals(a.slots[0].local, '11:00') // UTC+2 in January
})

Deno.test('createBooking validates the slot, annotates the actor, audits, and replays by idempotency key', async () => {
  const { repo, svc } = world()
  await assertRejects(() => svc.createBooking(caller, { ...input, start: '2030-01-02T20:00:00Z' }, 'k1'), Error, 'slot_not_available')
  assertEquals(repo.all('idempotency').length, 0) // failed attempts are forgotten
  const first = await svc.createBooking(caller, input, 'key-123')
  assertEquals(first.replayed, false)
  const h = first.booking.history[0]
  assertEquals([h.action, h.by], ['created_by_host', 'host'])
  assert(h.note?.includes('claude-ai'))
  const again = await svc.createBooking(caller, input, 'key-123')
  assertEquals(again.replayed, true)
  assertEquals(again.booking.id, first.booking.id)
  assertEquals(repo.all('booking').length, 1)
  await assertRejects(() => svc.createBooking(caller, { ...input, start: '2030-01-02T10:00:00Z' }, 'key-123'), Error, 'different request')
  const audit = repo.all<AuditEntry>('audit').map((r) => r.data)
  assertEquals(audit.length, 1)
  assertEquals([audit[0].actor, audit[0].client, audit[0].action], ['mcp', 'claude-ai', 'booking.create'])
})

Deno.test('cancel requires confirm and records the host as actor', async () => {
  const { repo, svc } = world()
  const { booking } = await svc.createBooking(caller, input)
  await assertRejects(() => svc.cancelBooking(caller, booking.id, {}), Error, 'confirm')
  const out = await svc.cancelBooking(caller, booking.id, { confirm: true, reason: 'ill' })
  assertEquals(out.status, 'cancelled')
  assertEquals(out.history.at(-1)?.by, 'host')
  await assertRejects(() => svc.cancelBooking(caller, booking.id, { confirm: true }), Error, 'already cancelled')
  // other owners cannot see it
  await assertRejects(() => svc.getBooking({ ...caller, ownerId: '00000000-0000-0000-0000-000000000002' }, booking.id), Error, 'not found')
  assertEquals(repo.all<AuditEntry>('audit').map((r) => r.data.action), ['booking.create', 'booking.cancel'])
})

Deno.test('out of office appends empty overrides for each day', async () => {
  const { repo, svc } = world()
  const r = await svc.updateAvailability(caller, { type: 'out_of_office', start: '2030-01-05', end: '2030-01-07' })
  assertEquals(r.changedDates, ['2030-01-05', '2030-01-06', '2030-01-07'])
  await svc.updateAvailability(caller, { type: 'override', date: '2030-01-06', ranges: [{ start: '10:00', end: '12:00' }] })
  const s = repo.rows.get('s1')!.data as Schedule
  assertEquals(s.overrides.map((o) => [o.date, o.ranges.length]), [['2030-01-05', 0], ['2030-01-06', 1], ['2030-01-07', 0]])
  await assertRejects(() => svc.updateAvailability(caller, { type: 'override', date: '2030-01-06', ranges: [{ start: '12:00', end: '10:00' }] }), Error, 'invalid range')
})

Deno.test('insights count statuses, no shows and busiest weekday', async () => {
  const { repo, svc } = world()
  const mk = (id: string, start: string, over: Partial<Booking> = {}) =>
    repo.seed('booking', OWNER, id, { id, eventTypeId: 'et1', start, end: start.replace(':00:00', ':30:00'), status: 'accepted', noShow: false, history: [], ...over })
  mk('a', '2029-12-03T09:00:00Z') // Monday
  mk('b', '2029-12-10T09:00:00Z', { noShow: true }) // Monday
  mk('c', '2029-12-12T09:00:00Z', { status: 'cancelled' })
  mk('d', '2029-12-13T09:00:00Z', { status: 'cancelled', rescheduledToId: 'e' })
  mk('e', '2029-12-14T09:00:00Z', { rescheduledFromId: 'd' }) // Friday
  const i = await svc.getInsights(caller, {})
  assertEquals(i.byStatus, { accepted: 3, pending: 0, cancelled: 1, rejected: 0 })
  assertEquals(i.noShows, 1)
  assertEquals(i.noShowRate, 0.333)
  assertEquals(i.rescheduled, 1)
  assertEquals(i.busiestWeekday, 'monday')
})
