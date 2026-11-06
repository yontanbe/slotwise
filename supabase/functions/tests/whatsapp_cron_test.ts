import { assert, assertEquals } from '@std/assert'
import { hmacSha256Hex } from '../_shared/util.ts'
import type { Booking, OutboxMessage } from '../_shared/types.ts'
import { createWhatsAppHandler } from '../whatsapp/handler.ts'
import { autoDecline, runWorkflows } from '../cron/run.ts'
import { MemoryRepo } from './fakes.ts'

const OWNER = '00000000-0000-0000-0000-000000000001'
const NOW = new Date('2030-01-01T00:00:00Z')
const TOKEN = 'abcdefghijklmnopqrstuvwx'

function booking(over: Partial<Booking> = {}): Booking {
  return {
    id: 'b1', token: TOKEN, ownerId: OWNER, eventTypeId: 'et1', title: 'Intro', start: '2030-01-02T09:00:00Z', end: '2030-01-02T09:30:00Z',
    status: 'accepted', attendee: { name: 'Dana Levi', email: 'dana@example.com', phone: '050-123-4567', timezone: 'Asia/Jerusalem', locale: 'he', whatsappOptIn: true },
    guests: [], notes: '', answers: {}, location: { type: 'meet' }, noShow: false, internalNotes: '', history: [], source: 'web', utm: {},
    createdAt: '2029-12-31T00:00:00Z', ...over,
  } as Booking
}

function wa(repo: MemoryRepo) {
  const replies: { to: string; text: string }[] = []
  const handler = createWhatsAppHandler({ repo: () => repo, now: () => NOW, reply: (to, text) => Promise.resolve(replies.push({ to, text })) })
  const inbound = async (text: string, from = '972501234567', secret = 'app-secret', button = true) => {
    const msg = button ? { from, type: 'button', button: { payload: text, text: 'x' } } : { from, type: 'text', text: { body: text } }
    const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [msg] } }] }] })
    const sig = 'sha256=' + (await hmacSha256Hex(secret, body))
    const res = await handler(new Request('http://x/functions/v1/whatsapp', { method: 'POST', body, headers: { 'x-hub-signature-256': sig } }))
    return { res, json: await res.json() }
  }
  return { handler, replies, inbound }
}

Deno.test('whatsapp: verification handshake', async () => {
  Deno.env.set('WHATSAPP_VERIFY_TOKEN', 'verify-me')
  const { handler } = wa(new MemoryRepo())
  const ok = await handler(new Request('http://x/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345'))
  assertEquals([ok.status, await ok.text()], [200, '12345'])
  const bad = await handler(new Request('http://x/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1'))
  assertEquals(bad.status, 403)
})

Deno.test('whatsapp: signature required; confirm, stale, other phone, reschedule, cancel', async () => {
  Deno.env.set('WHATSAPP_APP_SECRET', 'app-secret')
  Deno.env.set('APP_URL', 'https://app.example/')
  const repo = new MemoryRepo()
  repo.seed('booking', OWNER, 'b1', booking())
  const rpcCalls: string[] = []
  repo.rpcs.public_reconfirm = () => (rpcCalls.push('reconfirm'), { ...booking(), reconfirmedAt: NOW.toISOString() })
  repo.rpcs.public_cancel_booking = () => (rpcCalls.push('cancel'), { ...booking(), status: 'cancelled' })
  const { inbound, replies } = wa(repo)

  assertEquals((await inbound(`confirm:${TOKEN}`, '972501234567', 'wrong')).res.status, 401)
  assertEquals((await inbound(`confirm:${TOKEN}`)).json.results[0].result, 'confirmed')
  assertEquals((await inbound(`confirm:${TOKEN}`, '972529999999')).json.results[0].result, 'not_found') // someone else's phone
  assertEquals((await inbound(`reschedule:${TOKEN}`)).json.results[0].result, 'reschedule_link')
  assert(replies.at(-1)!.text.includes(`https://app.example/#/b/${TOKEN}?action=reschedule`))
  assertEquals((await inbound(`cancel:${TOKEN}`)).json.results[0].result, 'cancelled')
  assertEquals(rpcCalls, ['reconfirm', 'cancel'])

  // stale: already cancelled booking is not touched
  repo.seed('booking', OWNER, 'b1', booking({ status: 'cancelled' }))
  assertEquals((await inbound(`cancel:${TOKEN}`)).json.results[0].result, 'stale')
  assertEquals(rpcCalls.length, 2)
  // stale: in the past
  repo.seed('booking', OWNER, 'b1', booking({ start: '2029-12-01T09:00:00Z', end: '2029-12-01T09:30:00Z' }))
  assertEquals((await inbound(`confirm:${TOKEN}`)).json.results[0].result, 'stale')
  assert(replies.at(-1)!.text.includes('לא פעילה'))
})

Deno.test('whatsapp: STOP / עצור opts out of future bookings for that phone', async () => {
  Deno.env.set('WHATSAPP_APP_SECRET', 'app-secret')
  const repo = new MemoryRepo()
  repo.seed('booking', OWNER, 'b1', booking())
  repo.seed('booking', OWNER, 'b2', booking({ id: 'b2', token: 'zzzzzzzzzzzzzzzz', attendee: { ...booking().attendee, phone: '+972 50 123 4567' } }))
  repo.seed('booking', OWNER, 'b3', booking({ id: 'b3', token: 'yyyyyyyyyyyyyyyy', attendee: { ...booking().attendee, phone: '0529999999' } }))
  const { inbound } = wa(repo)
  const r = await inbound('עצור', '972501234567', 'app-secret', false)
  assertEquals(r.json.results[0].result, 'opted_out:2')
  const optIn = (id: string) => (repo.rows.get(id)!.data as Booking).attendee.whatsappOptIn
  assertEquals([optIn('b1'), optIn('b2'), optIn('b3')], [false, false, true])
  assertEquals((await inbound('STOP', '972501234567', 'app-secret', false)).json.results[0].result, 'opted_out:0')
})

Deno.test('cron: auto decline stale pending bookings', async () => {
  const repo = new MemoryRepo()
  repo.seed('event_type', OWNER, 'et1', { id: 'et1', autoDeclineHours: 24 })
  repo.seed('booking', OWNER, 'old', booking({ id: 'old', status: 'pending', createdAt: '2029-12-30T00:00:00Z' }))
  repo.seed('booking', OWNER, 'new', booking({ id: 'new', status: 'pending', createdAt: '2029-12-31T12:00:00Z' }))
  const out = await autoDecline({ repo, now: () => NOW })
  assertEquals(out.declined, 1)
  const old = repo.rows.get('old')!.data as Booking
  assertEquals(old.status, 'rejected')
  assertEquals([old.history.at(-1)?.action, old.history.at(-1)?.by], ['rejected', 'system'])
  assertEquals((repo.rows.get('new')!.data as Booking).status, 'pending')
})

Deno.test('cron: workflows run only with automationOnServer, once per step', async () => {
  const repo = new MemoryRepo()
  const prof = { id: OWNER, name: 'Host', email: 'host@example.com', phone: '', timezone: 'UTC', locale: 'en', automationOnServer: false }
  repo.seed('profile', OWNER, 'prof', prof)
  repo.seed('workflow', OWNER, 'w1', {
    id: 'w1', name: 'Reminder', active: true, trigger: 'before_start', offsetMins: 60, eventTypeIds: [], createdAt: '2029-01-01T00:00:00Z',
    steps: [{ id: 's1', action: 'email_attendee', subject: 'Soon: {event_name}', body: 'Hi {invitee_first_name}' }],
  })
  repo.seed('booking', OWNER, 'b1', booking({ start: '2030-01-01T00:30:00Z', end: '2030-01-01T01:00:00Z' }))
  assertEquals((await runWorkflows({ repo, now: () => NOW })).executed, 0) // browser owns automation
  repo.seed('profile', OWNER, 'prof', { ...prof, automationOnServer: true })
  assertEquals((await runWorkflows({ repo, now: () => NOW })).executed, 1)
  assertEquals((await runWorkflows({ repo, now: () => NOW })).executed, 0)
  assertEquals((repo.rows.get('b1')!.data as Booking).workflowDone, ['w1:s1'])
  const out = repo.all<OutboxMessage>('outbox').map((r) => r.data)
  assertEquals(out.length, 1) // no RESEND_API_KEY in tests: logged to the outbox
  assertEquals([out[0].status, out[0].subject, out[0].body], ['logged', 'Soon: Intro', 'Hi Dana'])
})
