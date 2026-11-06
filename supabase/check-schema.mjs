// Runs supabase/schema.sql against an in-process Postgres (PGlite) and checks the public RPCs.
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'

const db = new PGlite()
await db.exec(`create schema auth; create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create role anon; create role authenticated;`)
await db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'))

const owner = '11111111-1111-1111-1111-111111111111'
const noa = '22222222-2222-2222-2222-222222222222'
for (const u of [owner, noa]) await db.query(`insert into auth.users values ($1)`, [u])
const put = (id, kind, data, o = owner) => db.query(`insert into records(id, owner_id, kind, data) values ($1,$2,$3,$4)`, [id, o, kind, data])
const allDay = Array.from({ length: 7 }, () => [{ start: '00:00', end: '24:00' }])
const et = (id, extra = {}) => ({ id, ownerId: owner, title: id, slug: id, durations: [30], requiresConfirmation: false, seats: null, position: 0, scheduleId: 's1', minNoticeMins: 0, window: { type: 'unlimited' }, limits: {}, bufferBefore: 0, bufferAfter: 0, locations: [{ type: 'meet' }, { type: 'zoom', value: 'https://zoom.us/j/1' }], ...extra })

await put(owner, 'profile', { id: owner, name: 'Host', username: 'host', previousUsernames: ['oldhost'], email: 'h@x.io', blockedEmails: ['spam.com'], timezone: 'UTC', weekStart: 0, defaultScheduleId: 's1' })
await put(noa, 'profile', { id: noa, name: 'Noa', username: 'noa', previousUsernames: [], email: 'n@x.io', blockedEmails: [], timezone: 'UTC', weekStart: 0, defaultScheduleId: 's2' }, noa)
await put('s1', 'schedule', { id: 's1', ownerId: owner, name: 'Work', timezone: 'UTC', weekly: allDay, overrides: [] })
await put('s2', 'schedule', { id: 's2', ownerId: noa, name: 'Work', timezone: 'UTC', weekly: allDay, overrides: [{ date: '2030-01-05', ranges: [] }] }, noa)
await put('s9', 'schedule', { id: 's9', ownerId: owner, name: 'Narrow', timezone: 'Asia/Jerusalem', weekly: [[], [{ start: '09:00', end: '12:00' }], [], [], [], [], []], overrides: [] })
await put('et1', 'event_type', et('et1'))
await put('et2', 'event_type', et('et2', { durations: [60], requiresConfirmation: true, seats: 2 }))
await put('et3', 'event_type', et('et3', { scheduleId: 's9', limits: { perDay: 1 } }))
await put('et4', 'event_type', et('et4', { recurring: { freq: 'weekly', maxCount: 3 }, price: { amount: 100, currency: 'ILS', mode: 'deposit', depositAmount: 30 } }))
await put('et5', 'event_type', et('et5', { perInviteeLimit: { count: 1, days: 30 } }))
await put('rr', 'event_type', et('rr', { teamId: 't1', schedulingType: 'round_robin', hosts: [{ userId: owner, priority: 2, weight: 50 }, { userId: noa, priority: 2, weight: 50 }] }))
await put('col', 'event_type', et('col', { teamId: 't1', schedulingType: 'collective', hosts: [{ userId: owner, priority: 2, weight: 50 }, { userId: noa, priority: 2, weight: 50 }] }))
await put('et-notice', 'event_type', et('et-notice', { minNoticeMins: 60 * 24 * 365 * 10 }))
await put('busy-' + owner, 'busy', { blocks: [{ start: '2030-01-01T12:00:00.000Z', end: '2030-01-01T13:00:00.000Z', source: 'google' }] })
await put('lk1', 'link', { id: 'lk1', token: 'LINKTOKEN', eventTypeId: 'et1', ownerId: owner })
await put('p1', 'poll', { id: 'p1', status: 'open', options: [{}, {}], voters: [{ id: 'secret-alice-0001', name: 'Alice', email: 'alice@corp.io', votes: ['yes', 'no'] }] })
await put('t1', 'team', { id: 't1', ownerId: owner, name: 'Studio', slug: 'studio', members: [{ userId: owner, role: 'owner', accepted: true }, { userId: noa, role: 'member', accepted: true }] })
await put('f1', 'routing_form', { id: 'f1', ownerId: owner, slug: 'start', title: 'f', fields: [], rules: [], responses: [{ id: 'r0', answers: { email: 'secret@x.io' } }] })
await put('pl1', 'personal_link', { id: 'pl1', ownerId: owner, slug: 'dana', eventTypeId: 'et1', name: 'Dana' })

const q = async (sql, args) => Object.values((await db.query(sql, args)).rows[0] ?? { v: null })[0]
let failed = 0
const check = (label, actual, expected) => {
  const v = JSON.stringify(actual)
  const ok = typeof expected === 'function' ? expected(actual) : v === JSON.stringify(expected)
  if (!ok) failed++
  console.log(ok ? 'ok  ' : 'FAIL', label, v?.slice(0, 160))
}
const att = (email = 'i@x.io') => ({ name: 'Ivy', email, phone: '050', timezone: 'UTC', locale: 'en' })
const bk = (et, s, e, extra = {}) => ({ ownerId: owner, eventTypeId: et, start: s, end: e, attendee: att(), location: { type: 'meet' }, ...extra })
const create = (b, link = null, series = null) => q(`select public_create_booking($1, $2, $3)`, [b, link, series])

check('profile', await q(`select public_profile('host')->'user'->>'name'`), 'Host')
check('profile hides team event types', await q(`select jsonb_array_length(public_profile('host')->'eventTypes')`), 6)
check('profile redirect', await q(`select public_profile('OldHost')->>'redirectedFrom'`), 'oldhost')
check('profile missing', await q(`select public_profile('nobody')`), null)
check('profile has no blockedEmails', await q(`select public_profile('host')->'user' ? 'blockedEmails'`), false)

const r1 = await create(bk('et1', '2030-01-01T08:00:00.000Z', '2030-01-01T08:30:00.000Z', { google: { eventId: 'victim', syncedAt: 'x' }, source: 'manual', history: [{ action: 'created_by_host' }], location: { type: 'link', value: 'https://evil' }, id: 'chosen', token: 'chosen' }))
check('create ok', r1.ok, true)
check('server ignores google/source/history/id from client', [r1.booking.google, r1.booking.source, r1.booking.history[0].action, r1.booking.id === 'chosen', r1.booking.token.length], [undefined, 'web', 'created', false, 32])
check('location not in event type falls back to first', r1.booking.location, { type: 'meet' })
const tok1 = r1.booking.token
check('conflict', await create(bk('et1', '2030-01-01T08:15:00.000Z', '2030-01-01T08:45:00.000Z')), { ok: false, error: 'conflict' })
check('busy block', await create(bk('et1', '2030-01-01T12:00:00.000Z', '2030-01-01T12:30:00.000Z')), { ok: false, error: 'conflict' })
check('bad duration', await create(bk('et1', '2030-01-01T09:00:00.000Z', '2030-01-01T09:45:00.000Z')), { ok: false, error: 'conflict' })
check('blocked domain', await create(bk('et1', '2030-01-01T10:00:00.000Z', '2030-01-01T10:30:00.000Z', { attendee: att('x@spam.com') })), { ok: false, error: 'blocked' })
check('invalid email list rejected', await create(bk('et1', '2030-01-01T10:00:00.000Z', '2030-01-01T10:30:00.000Z', { attendee: att('a@b.io,c@d.io') })), { ok: false, error: 'blocked' })
check('header injection rejected', await create(bk('et1', '2030-01-01T10:00:00.000Z', '2030-01-01T10:30:00.000Z', { attendee: att('a@b.io\r\nBcc: z@z.io') })), { ok: false, error: 'blocked' })
check('honeypot', await create({ ...bk('et1', '2030-01-01T10:00:00.000Z', '2030-01-01T10:30:00.000Z'), hp: 'bot' }), { ok: false, error: 'spam' })
check('guests capped and validated', (await create(bk('et1', '2030-01-01T14:00:00.000Z', '2030-01-01T14:30:00.000Z', { guests: [...Array.from({ length: 15 }, (_, i) => `g${i}@x.io`), 'bad'] }))).booking.guests.length, 10)
// schedule rules
check('outside working hours (Sat 03:00 Jerusalem)', await create(bk('et3', '2030-01-05T01:00:00.000Z', '2030-01-05T01:30:00.000Z')), { ok: false, error: 'conflict' })
check('inside working hours (Mon 09:00 Jerusalem)', (await create(bk('et3', '2030-01-07T07:00:00.000Z', '2030-01-07T07:30:00.000Z'))).ok, true)
check('per day limit', await create(bk('et3', '2030-01-07T08:00:00.000Z', '2030-01-07T08:30:00.000Z')), { ok: false, error: 'full' })
check('minimum notice', await create(bk('et-notice', '2030-01-02T08:00:00.000Z', '2030-01-02T08:30:00.000Z')), { ok: false, error: 'conflict' })
check('per invitee limit 1', (await create(bk('et5', '2030-01-03T08:00:00.000Z', '2030-01-03T08:30:00.000Z'))).ok, true)
check('per invitee limit 2', await create(bk('et5', '2030-01-10T08:00:00.000Z', '2030-01-10T08:30:00.000Z')), { ok: false, error: 'limit' })
// seats
check('seat1 pending', (await create(bk('et2', '2030-01-02T08:00:00.000Z', '2030-01-02T09:00:00.000Z'))).booking.status, 'pending')
check('seat2', (await create(bk('et2', '2030-01-02T08:00:00.000Z', '2030-01-02T09:00:00.000Z', { attendee: att('two@x.io') }))).ok, true)
check('seat3 full', await create(bk('et2', '2030-01-02T08:00:00.000Z', '2030-01-02T09:00:00.000Z', { attendee: att('three@x.io') })), { ok: false, error: 'full' })
// links
check('link ok', (await create(bk('et1', '2030-01-03T10:00:00.000Z', '2030-01-03T10:30:00.000Z'), 'LINKTOKEN')).booking.source, 'link')
check('link used', await create(bk('et1', '2030-01-03T11:00:00.000Z', '2030-01-03T11:30:00.000Z'), 'LINKTOKEN'), { ok: false, error: 'used' })
// series + payment
const series = [0, 1, 2, 3].map((w) => ({ start: new Date(Date.parse('2030-02-04T08:00:00Z') + w * 7 * 864e5).toISOString(), end: new Date(Date.parse('2030-02-04T08:30:00Z') + w * 7 * 864e5).toISOString() }))
const rs = await create(bk('et4', series[0].start, series[0].end), null, series)
check('series ok with deposit payment', [rs.ok, rs.booking.payment.status, rs.booking.payment.amount], [true, 'unpaid', 30])
check('series capped at maxCount', await q(`select count(*)::int from records where kind='booking' and data->>'recurringId' = $1`, [rs.booking.recurringId]), 3)
check('series all or nothing', await create(bk('et4', '2030-03-04T08:00:00.000Z', '2030-03-04T08:30:00.000Z'), null, [{ start: '2030-03-04T08:00:00.000Z', end: '2030-03-04T08:30:00.000Z' }, { start: '2030-01-01T12:00:00.000Z', end: '2030-01-01T12:30:00.000Z' }]), { ok: false, error: 'conflict' })
check('series rollback left nothing', await q(`select count(*)::int from records where kind='booking' and data->>'start' = '2030-03-04T08:00:00.000Z'`), 0)
// teams
check('round robin on member host', (await create(bk('rr', '2030-01-08T08:00:00.000Z', '2030-01-08T08:30:00.000Z', { ownerId: noa }))).ok, true)
check('round robin respects member schedule override', await create(bk('rr', '2030-01-05T08:00:00.000Z', '2030-01-05T08:30:00.000Z', { ownerId: noa })), { ok: false, error: 'conflict' })
check('collective blocked by co-host booking', await create(bk('col', '2030-01-08T08:00:00.000Z', '2030-01-08T08:30:00.000Z', { coHostIds: [noa] })), { ok: false, error: 'conflict' })
const col = await create(bk('col', '2030-01-08T10:00:00.000Z', '2030-01-08T10:30:00.000Z', { coHostIds: [noa, '99999999-9999-9999-9999-999999999999'] }))
check('collective ok, unknown co-host dropped', col.booking.coHostIds, [noa])
check('co-host busy includes collective', await q(`select jsonb_array_length(public_busy($1, '2030-01-08T00:00:00Z', '2030-01-09T00:00:00Z')->'bookings')`, [noa]), 2)
check('team bundle', await q(`select jsonb_array_length(public_team('studio')->'members')`), 2)
// reschedule / cancel
await db.query(`update records set data = data || '{"google":{"eventId":"g1","syncedAt":"2029-01-01"}}' where data->>'token' = $1`, [tok1])
check('reschedule conflict', await q(`select public_reschedule_booking($1, $2, 'r')`, [tok1, { start: '2030-01-01T12:00:00.000Z', end: '2030-01-01T12:30:00.000Z' }]), { ok: false, error: 'conflict' })
const rr = await q(`select public_reschedule_booking($1, $2, 'later')`, [tok1, { start: '2030-01-01T08:15:00.000Z', end: '2030-01-01T08:45:00.000Z' }])
check('reschedule self overlap ok', rr.ok, true)
check('reschedule keeps google event, clears syncedAt', rr.booking.google, { eventId: 'g1' })
check('old booking cancelled', await q(`select data->>'status' from records where data->>'token' = $1`, [tok1]), 'cancelled')
check('cancel', (await q(`select public_cancel_booking($1, 'sick')`, [rr.booking.token])).status, 'cancelled')
check('cancel again', await q(`select public_cancel_booking($1, 'sick')`, [rr.booking.token]), null)
check('reconfirm', await q(`select public_reconfirm($1) ? 'reconfirmedAt'`, [col.booking.token]), true)
// polls
check('poll hides voter emails', await q(`select public_poll('p1')->'poll'->'voters'->0->>'email'`), '')
check('poll hides voter ids', await q(`select public_poll('p1')->'poll'->'voters'->0->>'id'`), '')
check('vote with same email does not overwrite', await q(`select jsonb_array_length(public_vote_poll('p1', $1)->'voters')`, [{ id: 'attacker-0000000', name: 'X', email: 'ALICE@corp.io', votes: ['no', 'no'] }]), 2)
check('alice votes intact', await q(`select data->'voters'->0->'votes' from records where id='p1'`), ['yes', 'no'])
check('vote update by secret id', await q(`select jsonb_array_length(public_vote_poll('p1', $1)->'voters')`, [{ id: 'attacker-0000000', name: 'X', votes: ['yes', 'yes'] }]), 2)
check('short voter id rejected', await q(`select public_vote_poll('p1', $1)`, [{ id: 'abc', name: 'X', votes: [] }]), null)
// routing, personal links
check('routing form hides responses', await q(`select public_routing_form('host','start')->'form' ? 'responses'`), false)
await q(`select public_submit_routing('f1', $1)`, [{ id: 'r1', answers: {} }])
check('routing response stored', await q(`select jsonb_array_length(data->'responses') from records where id='f1'`), 2)
check('personal link', await q(`select public_personal_link('host','DANA')->>'name'`), 'Dana')
// privileges
for (const fn of ['_check_slot(uuid,jsonb,text)', '_check_rules(uuid,jsonb,timestamptz,timestamptz,text)', '_clean_booking(jsonb,jsonb,uuid,text)', '_profile_bundle(uuid,text)'])
  check('anon cannot call ' + fn.split('(')[0], await q(`select has_function_privilege('anon', 'public.${fn}', 'execute')`), false)
check('anon can call public_create_booking', await q(`select has_function_privilege('anon', 'public.public_create_booking(jsonb,text,jsonb)', 'execute')`), true)

if (failed) {
  console.error(failed + ' failed')
  process.exit(1)
} else console.log('all passed')
