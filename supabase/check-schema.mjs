// Runs supabase/schema.sql against an in-process Postgres (PGlite) and checks the public RPCs.
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'

const db = new PGlite()
await db.exec(`create schema auth; create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create role anon; create role authenticated;`)
await db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'))
// what Supabase grants by default, so the RLS / trigger checks below run as the real client roles
await db.exec(`grant usage on schema public, auth to anon, authenticated; grant select, insert, update, delete on public.records to authenticated;
grant execute on function auth.uid() to anon, authenticated;`)

const owner = '11111111-1111-1111-1111-111111111111'
const noa = '22222222-2222-2222-2222-222222222222'
const atk = '33333333-3333-3333-3333-333333333333'
for (const u of [owner, noa, atk]) await db.query(`insert into auth.users values ($1)`, [u])
const put = (id, kind, data, o = owner) => db.query(`insert into records(id, owner_id, kind, data) values ($1,$2,$3,$4)`, [id, o, kind, data])
const allDay = Array.from({ length: 7 }, () => [{ start: '00:00', end: '24:00' }])
const et = (id, extra = {}) => ({ id, ownerId: owner, title: id, slug: id, durations: [30], requiresConfirmation: false, seats: null, position: 0, scheduleId: 's1', minNoticeMins: 0, window: { type: 'unlimited' }, limits: {}, bufferBefore: 0, bufferAfter: 0, locations: [{ type: 'meet' }, { type: 'zoom', value: 'https://zoom.us/j/1' }], ...extra })

await put(owner, 'profile', { id: owner, name: 'Host', username: 'host', previousUsernames: ['oldhost'], email: 'h@x.io', phone: '+972500000001', blockedEmails: ['spam.com'], timezone: 'UTC', weekStart: 0, defaultScheduleId: 's1' })
await put(noa, 'profile', { id: noa, name: 'Noa', username: 'noa', previousUsernames: [], email: 'n@x.io', phone: '+972500000002', showContact: true, blockedEmails: [], timezone: 'UTC', weekStart: 0, defaultScheduleId: 's2' }, noa)
await put(atk, 'profile', { id: atk, name: 'Atk', username: 'atk', previousUsernames: [], email: 'a@x.io', blockedEmails: [], timezone: 'UTC', weekStart: 0, defaultScheduleId: 'sa' }, atk)
await put('sa', 'schedule', { id: 'sa', ownerId: atk, name: 'Work', timezone: 'UTC', weekly: Array.from({ length: 7 }, () => [{ start: '00:00', end: '24:00' }]), overrides: [] }, atk)
await put('s1', 'schedule', { id: 's1', ownerId: owner, name: 'Work', timezone: 'UTC', weekly: allDay, overrides: [] })
await put('s2', 'schedule', { id: 's2', ownerId: noa, name: 'Work', timezone: 'UTC', weekly: allDay, overrides: [{ date: '2030-01-05', ranges: [], note: 'private: surgery' }] }, noa)
await put('s9', 'schedule', { id: 's9', ownerId: owner, name: 'Narrow', timezone: 'Asia/Jerusalem', weekly: [[], [{ start: '09:00', end: '12:00' }], [], [], [], [], []], overrides: [] })
await put('et1', 'event_type', et('et1'))
await put('et2', 'event_type', et('et2', { durations: [60], requiresConfirmation: true, seats: 2 }))
await put('et3', 'event_type', et('et3', { scheduleId: 's9', limits: { perDay: 1 } }))
await put('et4', 'event_type', et('et4', { recurring: { freq: 'weekly', maxCount: 3 }, price: { amount: 100, currency: 'ILS', mode: 'deposit', depositAmount: 30 } }))
await put('et5', 'event_type', et('et5', { perInviteeLimit: { count: 1, days: 30 } }))
await put('rr', 'event_type', et('rr', { teamId: 't1', schedulingType: 'round_robin', hosts: [{ userId: owner, priority: 2, weight: 50 }, { userId: noa, priority: 2, weight: 50 }] }))
await put('col', 'event_type', et('col', { teamId: 't1', schedulingType: 'collective', hosts: [{ userId: owner, priority: 2, weight: 50 }, { userId: noa, priority: 2, weight: 50 }] }))
await put('eth', 'event_type', et('eth', { slug: 'secret', hidden: true, position: 9, price: { amount: 100, currency: 'USD', mode: 'full', paymentLink: 'https://buy.stripe.com/secret' } }))
await put('pl2', 'personal_link', { id: 'pl2', ownerId: owner, slug: 'vip', eventTypeId: 'eth', name: 'VIP' })
await put('lk2', 'link', { id: 'lk2', token: 'HIDDENLINK', eventTypeId: 'eth', ownerId: owner })
// attacker event types: victim (noa) listed as a host without a team, and with a team id the attacker is not part of
await put('aet', 'event_type', { ...et('aet'), ownerId: atk, scheduleId: 'sa' }, atk)
await put('aet-hosts', 'event_type', { ...et('aet-hosts'), ownerId: atk, scheduleId: 'sa', hosts: [{ userId: noa, priority: 2, weight: 50 }] }, atk)
await put('aet-team', 'event_type', { ...et('aet-team'), ownerId: atk, scheduleId: 'sa', teamId: 't1', schedulingType: 'collective', hosts: [{ userId: atk }, { userId: noa }] }, atk)
await put('et-notice', 'event_type', et('et-notice', { minNoticeMins: 60 * 24 * 365 * 10 }))
await put('busy-' + owner, 'busy', { blocks: [{ start: '2030-01-01T12:00:00.000Z', end: '2030-01-01T13:00:00.000Z', source: 'google' }] })
await put('lk1', 'link', { id: 'lk1', token: 'LINKTOKEN', eventTypeId: 'et1', ownerId: owner })
await put('p1', 'poll', { id: 'p1', status: 'open', options: [{}, {}], voters: [{ id: 'secret-alice-0001', name: 'Alice', email: 'alice@corp.io', votes: ['yes', 'no'] }] })
await put('t1', 'team', { id: 't1', ownerId: owner, name: 'Studio', slug: 'studio', members: [{ userId: owner, role: 'owner', accepted: true }, { userId: noa, role: 'member', accepted: true }] })
await put('f1', 'routing_form', { id: 'f1', ownerId: owner, slug: 'start', title: 'f', fields: [{ id: 'q1' }], rules: [{ target: { type: 'event', eventTypeId: 'eth' } }], responses: [{ id: 'r0', answers: { email: 'secret@x.io' } }] })
await put('pl1', 'personal_link', { id: 'pl1', ownerId: owner, slug: 'dana', eventTypeId: 'et1', name: 'Dana' })

const q = async (sql, args) => Object.values((await db.query(sql, args)).rows[0] ?? { v: null })[0]
// runs fn as a PostgREST client role (anon, or authenticated as uid); returns its value or the error message
const as = async (role, uid, fn) => {
  await db.exec(`set role ${role}; select set_config('test.uid', '${uid ?? ''}', false)`)
  try {
    return await fn()
  } catch (e) {
    return 'ERR ' + e.message
  } finally {
    await db.exec(`reset role; select set_config('test.uid', '', false)`)
  }
}
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
// teams: consent (finding 1)
check('round robin: member without team_member record rejected', await create(bk('rr', '2030-01-08T08:00:00.000Z', '2030-01-08T08:30:00.000Z', { ownerId: noa })), { ok: false, error: 'not_found' })
check('hosts list without a team cannot book the victim', await create(bk('aet-hosts', '2030-01-08T08:00:00.000Z', '2030-01-08T08:30:00.000Z', { ownerId: noa })), { ok: false, error: 'not_found' })
check('collective co-host without consent dropped', (await create(bk('col', '2030-01-09T08:00:00.000Z', '2030-01-09T08:30:00.000Z', { coHostIds: [noa] }))).booking.coHostIds, [])
check('team_member wrong id rejected (client)', await as('authenticated', noa, () => put('t1-x', 'team_member', { teamId: 't1', userId: noa, accepted: true }, noa)), (v) => String(v).startsWith('ERR'))
check('team_member for someone else rejected (client)', await as('authenticated', atk, () => put('t1:' + noa, 'team_member', { teamId: 't1', userId: noa, accepted: true }, atk)), (v) => String(v).startsWith('ERR'))
check('member writes own consent (client)', (await as('authenticated', noa, () => put('t1:' + noa, 'team_member', { teamId: 't1', userId: noa, accepted: true }, noa))).affectedRows, 1)
await as('authenticated', atk, () => put('t1:' + atk, 'team_member', { teamId: 't1', userId: atk, accepted: true }, atk))
check('team id of a team the attacker is not in: victim still not bookable', await create(bk('aet-team', '2030-01-08T08:00:00.000Z', '2030-01-08T08:30:00.000Z', { ownerId: noa })), { ok: false, error: 'not_found' })
check('attacker team event type: victim co-host dropped', (await create(bk('aet-team', '2030-01-08T09:00:00.000Z', '2030-01-08T09:30:00.000Z', { ownerId: atk, coHostIds: [noa] }))).booking.coHostIds, [])
// co-hosts only on collective team types (finding 2)
const forged = await create(bk('et1', '2030-01-11T08:00:00.000Z', '2030-01-11T08:30:00.000Z', { coHostIds: [noa] }))
check('co-hosts on a non-team event type dropped (dynamic links get none)', forged.booking.coHostIds, [])
check('round robin type does not take co-hosts', (await create(bk('rr', '2030-01-11T09:00:00.000Z', '2030-01-11T09:30:00.000Z', { coHostIds: [noa] }))).booking.coHostIds, [])
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
// RLS + records_guard trigger (findings 2, 3, 6)
const tryPut = (uid, id, kind, data) => as('authenticated', uid, () => put(id, kind, data, uid))
const denied = (v) => String(v).startsWith('ERR')
check('client cannot insert webhook_delivery', await tryPut(atk, 'wd1', 'webhook_delivery', { id: 'wd1', ownerId: atk, status: 'retrying' }), denied)
check('client cannot insert audit', await tryPut(atk, 'au1', 'audit', { id: 'au1', ownerId: atk }), denied)
check('client cannot insert idempotency', await tryPut(atk, 'id1', 'idempotency', { id: 'id1', ownerId: atk }), denied)
check('client can insert small outbox', (await tryPut(atk, 'ob1', 'outbox', { id: 'ob1', ownerId: atk, body: 'hi' })).affectedRows, 1)
check('client outbox capped at 16KB', await tryPut(atk, 'ob2', 'outbox', { id: 'ob2', ownerId: atk, body: 'x'.repeat(20000) }), denied)
check('client booking with forged co-host rejected', await tryPut(atk, 'fb1', 'booking', { id: 'fb1', ownerId: atk, eventTypeId: 'aet', start: '2030-01-03T08:00:00Z', end: '2030-01-03T18:00:00Z', status: 'accepted', coHostIds: [noa] }), denied)
check('client booking data.id spoof rejected', await tryPut(atk, 'fb2', 'booking', { id: 'VICTIM_BOOKING_ID', ownerId: atk, eventTypeId: 'aet' }), denied)
check('client data.ownerId spoof rejected', await tryPut(atk, 'fe1', 'event_type', { id: 'fe1', ownerId: noa }), denied)
check('client booking ok, whatsappOptIn forced false', await tryPut(atk, 'fb3', 'booking', { id: 'fb3', ownerId: atk, eventTypeId: 'aet', start: '2030-01-03T08:00:00Z', end: '2030-01-03T08:30:00Z', status: 'accepted', attendee: { name: 'x', email: 'x@x.io', phone: '+15550001', whatsappOptIn: true } }).then(() => q(`select data->'attendee'->'whatsappOptIn' from records where id = 'fb3'`)), false)
check('client cannot flip whatsappOptIn on update', await as('authenticated', atk, () => db.query(`update records set data = jsonb_set(data, '{attendee,whatsappOptIn}', 'true') where id = 'fb3'`)).then(() => q(`select data->'attendee'->'whatsappOptIn' from records where id = 'fb3'`)), false)
await put('au-own', 'audit', { id: 'au-own', ownerId: atk, action: 'x' }, atk)
check('host reads own audit rows', await as('authenticated', atk, () => q(`select count(*)::int from records where kind = 'audit'`)), 1)
check('host cannot delete audit rows', await as('authenticated', atk, () => db.query(`delete from records where id = 'au-own'`)).then(() => q(`select count(*)::int from records where id = 'au-own'`)), 1)
check('victim cannot see attacker rows', await as('authenticated', noa, () => q(`select count(*)::int from records where owner_id = $1`, [atk])), 0)
const viaRpc = await as('authenticated', atk, () => create(bk('et1', '2030-01-12T08:00:00.000Z', '2030-01-12T08:30:00.000Z', { attendee: { ...att(), whatsappOptIn: true } })))
check('invitee opt-in through the RPC kept (signed-in invitee)', [viaRpc.ok, viaRpc.booking?.attendee.whatsappOptIn], [true, true])
const upsert = (id) => db.query(`insert into records(id, owner_id, kind, data) select id, owner_id, kind, data || '{"notes":"edited"}' from records where id = $1
  on conflict (id) do update set data = excluded.data`, [id])
check('host re-saving a booking (upsert) keeps the invitee opt-in', await as('authenticated', owner, () => upsert(viaRpc.booking.id)).then(() => q(`select (data->'attendee'->>'whatsappOptIn') || (data->>'notes') from records where id = $1`, [viaRpc.booking.id])), 'trueedited')
check('anon co-host injection on attacker type dropped', (await as('anon', null, () => create({ ...bk('aet', '2030-01-12T09:00:00.000Z', '2030-01-12T09:30:00.000Z'), ownerId: atk, coHostIds: [noa] }))).booking.coHostIds, [])
// public data (finding 9)
const pub = await q(`select public_profile('host')`)
check('profile hides hidden event types', pub.eventTypes.some((e) => e.id === 'eth'), false)
check('profile hides email/phone by default', [pub.user.email, pub.user.phone], ['', ''])
check('profile shows contact when showContact', await q(`select public_profile('noa')->'user'->>'email'`), 'n@x.io')
check('profile keeps booking page user fields', Object.keys(pub.user).sort(), ['avatarUrl', 'bio', 'brandColor', 'defaultScheduleId', 'email', 'id', 'locale', 'name', 'outOfOffice', 'phone', 'shabbat', 'timeFormat', 'timezone', 'travel', 'username', 'weekStart'])
check('schedule override notes stripped', await q(`select public_profile('noa')->'schedules'->0`), (s) => Object.keys(s).sort().join() === 'id,name,overrides,timezone,weekly' && JSON.stringify(s.overrides) === '[{"date":"2030-01-05","ranges":[]}]')
const hid = await q(`select public_event_type('host', 'Secret')`)
check('public_event_type returns the hidden type by slug, without payment link', hid.eventTypes.filter((e) => e.id === 'eth').map((e) => [e.price.amount, e.price.paymentLink]), [[100, null]])
check('public_event_type via personal link slug', (await q(`select public_event_type('host', 'vip')`)).eventTypes.some((e) => e.id === 'eth'), true)
check('public_event_type unknown slug: visible only', (await q(`select public_event_type('host', 'nope')`)).eventTypes.length, 6)
check('public_link includes its hidden type', (await q(`select public_link('HIDDENLINK')`)).profile.eventTypes.some((e) => e.id === 'eth'), true)
check('public_routing_form includes routed hidden type', (await q(`select public_routing_form('host', 'start')`)).profile.eventTypes.some((e) => e.id === 'eth'), true)
// routing responses (finding 10)
await q(`select public_submit_routing('f1', $1)`, [{ id: 'r2', answers: { q1: 'yes', injected: 'x'.repeat(100) }, routedTo: 'e:eth', extra: { a: 1 } }])
check('routing keeps only form field answers', await q(`select (data->'responses'->-1) - 'at' from records where id='f1'`), { id: 'r2', answers: { q1: 'yes' }, routedTo: 'e:eth' })
await q(`select public_submit_routing('f1', $1)`, [{ id: 'r3', answers: { q1: 'A'.repeat(9000) } }])
check('routing response over 8KB rejected', await q(`select jsonb_array_length(data->'responses') from records where id='f1'`), 3)
// privileges
for (const fn of ['_check_slot(uuid,jsonb,text)', '_check_rules(uuid,jsonb,timestamptz,timestamptz,text)', '_clean_booking(jsonb,jsonb,uuid,text)', '_profile_bundle(uuid,text,text,jsonb)', '_host_ok(text,text)', '_cohosts_ok(text,text,jsonb)'])
  check('anon cannot call ' + fn.split('(')[0], await q(`select has_function_privilege('anon', 'public.${fn}', 'execute')`), false)
check('anon can call public_event_type', await q(`select has_function_privilege('anon', 'public.public_event_type(text,text)', 'execute')`), true)
check('anon can call public_create_booking', await q(`select has_function_privilege('anon', 'public.public_create_booking(jsonb,text,jsonb)', 'execute')`), true)

if (failed) {
  console.error(failed + ' failed')
  process.exit(1)
} else console.log('all passed')
