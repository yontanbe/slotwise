import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
const db = new PGlite()
await db.exec(`create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
create role anon; create role authenticated;`)
await db.exec(fs.readFileSync(new URL("./schema.sql", import.meta.url), 'utf8'))
const owner = '11111111-1111-1111-1111-111111111111'
await db.query(`insert into auth.users values ($1)`, [owner])
const put = (id, kind, data) => db.query(`insert into records(id, owner_id, kind, data) values ($1,$2,$3,$4)`, [id, owner, kind, data])
await put(owner, 'profile', { id: owner, name: 'Host', username: 'host', previousUsernames: ['oldhost'], email: 'h@x.io', blockedEmails: ['spam.com'], timezone: 'Asia/Jerusalem', weekStart: 0 })
await put('et1', 'event_type', { id: 'et1', ownerId: owner, title: 'Intro', slug: 'intro', durations: [30], requiresConfirmation: false, seats: null, position: 0 })
await put('et2', 'event_type', { id: 'et2', ownerId: owner, title: 'Group', slug: 'group', durations: [60], requiresConfirmation: true, seats: 2, position: 1 })
await put('s1', 'schedule', { id: 's1', ownerId: owner, name: 'Work' })
await put('busy-' + owner, 'busy', { blocks: [{ start: '2030-01-01T12:00:00.000Z', end: '2030-01-01T13:00:00.000Z', source: 'google' }] })
await put('lk1', 'link', { id: 'lk1', token: 'LINKTOKEN', eventTypeId: 'et1', ownerId: owner })
await put('p1', 'poll', { id: 'p1', status: 'open', voters: [{ id: 'v1', name: 'A', email: 'a@x.io', votes: ['yes'] }] })
const q = async (sql, args) => (await db.query(sql, args)).rows[0]
let failed = 0
const expect = {
  'create conflict': '{"ok":false,"error":"conflict"}', 'create busy': '{"ok":false,"error":"conflict"}', 'bad duration': '{"ok":false,"error":"conflict"}',
  blocked: '{"ok":false,"error":"blocked"}', honeypot: '{"ok":false,"error":"spam"}', seat1: '"pending"', seat2: '"true"', 'seat3 full': '{"ok":false,"error":"full"}',
  'link ok': '"true"', 'link used': '{"ok":false,"error":"used"}', 'get booking': '"accepted"', 'reschedule conflict': '{"ok":false,"error":"conflict"}',
  'reschedule self-overlap ok': '"true"', 'old status': '"cancelled"', 'new booking': '"b1"', cancel: '"cancelled"', 'cancel again': 'null',
  'vote update': '1', 'vote new': '2', poll: '"Host"', 'profile-redirect': '"oldhost"', 'profile-missing': 'null',
}
const show = (label, r) => {
  const v = JSON.stringify(Object.values(r)[0])
  const ok = !(label in expect) || expect[label] === v
  if (!ok) failed++
  console.log(ok ? 'ok  ' : 'FAIL', label, v.slice(0, 160))
}
show('profile', await q(`select public_profile('host')`))
show('profile-redirect', await q(`select public_profile('OldHost')->>'redirectedFrom'`))
show('profile-missing', await q(`select public_profile('nobody')`))
const bk = (id, et, s, e, email = 'i@x.io') => ({ id, token: 'tok-' + id, ownerId: owner, eventTypeId: et, start: s, end: e, attendee: { name: 'I', email }, history: [] })
show('create ok', await q(`select public_create_booking($1, null)`, [bk('b1', 'et1', '2030-01-01T08:00:00.000Z', '2030-01-01T08:30:00.000Z')]))
show('create conflict', await q(`select public_create_booking($1, null)`, [bk('b2', 'et1', '2030-01-01T08:15:00.000Z', '2030-01-01T08:45:00.000Z')]))
show('create busy', await q(`select public_create_booking($1, null)`, [bk('b3', 'et1', '2030-01-01T12:00:00.000Z', '2030-01-01T12:30:00.000Z')]))
show('bad duration', await q(`select public_create_booking($1, null)`, [bk('b4', 'et1', '2030-01-01T09:00:00.000Z', '2030-01-01T09:45:00.000Z')]))
show('blocked', await q(`select public_create_booking($1, null)`, [bk('b5', 'et1', '2030-01-01T10:00:00.000Z', '2030-01-01T10:30:00.000Z', 'x@spam.com')]))
show('honeypot', await q(`select public_create_booking($1, null)`, [{ ...bk('b6', 'et1', '2030-01-01T10:00:00.000Z', '2030-01-01T10:30:00.000Z'), hp: 'bot' }]))
show('seat1', await q(`select public_create_booking($1, null)->'booking'->>'status'`, [bk('g1', 'et2', '2030-01-02T08:00:00.000Z', '2030-01-02T09:00:00.000Z')]))
show('seat2', await q(`select public_create_booking($1, null)->>'ok'`, [bk('g2', 'et2', '2030-01-02T08:00:00.000Z', '2030-01-02T09:00:00.000Z')]))
show('seat3 full', await q(`select public_create_booking($1, null)`, [bk('g3', 'et2', '2030-01-02T08:00:00.000Z', '2030-01-02T09:00:00.000Z')]))
show('link ok', await q(`select public_create_booking($1, 'LINKTOKEN')->>'ok'`, [bk('l1', 'et1', '2030-01-03T08:00:00.000Z', '2030-01-03T08:30:00.000Z')]))
show('link used', await q(`select public_create_booking($1, 'LINKTOKEN')`, [bk('l2', 'et1', '2030-01-03T10:00:00.000Z', '2030-01-03T10:30:00.000Z')]))
show('link fetch', await q(`select public_link('LINKTOKEN')->'link'`))
show('busy', await q(`select public_busy($1, '2030-01-01T00:00:00Z', '2030-01-03T00:00:00Z')`, [owner]))
show('get booking', await q(`select public_booking('tok-b1')->'booking'->>'status'`))
show('reschedule conflict', await q(`select public_reschedule_booking('tok-b1', $1, 'r')`, [{ id: 'b1n', token: 'tok-b1n', start: '2030-01-01T12:00:00.000Z', end: '2030-01-01T12:30:00.000Z' }]))
show('reschedule self-overlap ok', await q(`select public_reschedule_booking('tok-b1', $1, 'later')->>'ok'`, [{ id: 'b1n', token: 'tok-b1n', start: '2030-01-01T08:15:00.000Z', end: '2030-01-01T08:45:00.000Z' }]))
show('old status', await q(`select data->>'status' from records where id='b1'`))
show('new booking', await q(`select data->>'rescheduledFromId' from records where id='b1n'`))
show('cancel', await q(`select public_cancel_booking('tok-b1n', 'sick')->>'status'`))
show('cancel again', await q(`select public_cancel_booking('tok-b1n', 'sick')`))
show('vote update', await q(`select jsonb_array_length(public_vote_poll('p1', $1)->'voters')`, [{ id: 'zz', name: 'A2', email: 'A@x.io', votes: ['no'] }]))
show('vote new', await q(`select jsonb_array_length(public_vote_poll('p1', $1)->'voters')`, [{ id: 'v2', name: 'B', email: 'b@x.io', votes: ['yes'] }]))
show('poll', await q(`select public_poll('p1')->'user'->>'name'`))

if (failed) { console.error(failed + ' failed'); process.exit(1) } else console.log('all passed')
