import { assert, assertEquals, assertFalse } from '@std/assert'
import type { Booking, ServerWebhookDelivery, Webhook } from '../_shared/types.ts'
import {
  backoffMs,
  type DbWebhookPayload,
  deriveEvents,
  dispatchEvent,
  MAX_ATTEMPTS,
  retryDueDeliveries,
  signatureHeader,
  verifySignatureHeader,
} from '../_shared/webhooks.ts'
import { hmacSha256Hex } from '../_shared/util.ts'
import { MemoryRepo } from './fakes.ts'

const OWNER = '00000000-0000-0000-0000-000000000001'

Deno.test('hmac signature round trip verifies', async () => {
  const body = JSON.stringify({ hello: 'world', n: 1 })
  const t = 1_800_000_000
  const header = await signatureHeader('whsec_test', body, t)
  assert(/^t=1800000000,v1=[0-9a-f]{64}$/.test(header))
  // the documented formula
  assertEquals(header.split('v1=')[1], await hmacSha256Hex('whsec_test', `${t}.${body}`))
  assert(await verifySignatureHeader('whsec_test', body, header, 300, t + 10))
})

Deno.test('hmac signature rejects tampering, wrong secret and stale timestamps', async () => {
  const body = '{"a":1}'
  const t = 1_800_000_000
  const header = await signatureHeader('s1', body, t)
  assertFalse(await verifySignatureHeader('s1', '{"a":2}', header, 300, t))
  assertFalse(await verifySignatureHeader('s2', body, header, 300, t))
  assertFalse(await verifySignatureHeader('s1', body, header, 300, t + 301))
  assertFalse(await verifySignatureHeader('s1', body, null, 300, t))
  assertFalse(await verifySignatureHeader('s1', body, 'garbage', 300, t))
})

const booking = (over: Partial<Booking> = {}): Booking =>
  ({
    id: 'b1',
    token: 'secret-token-xxxxxxxxxxxx',
    ownerId: OWNER,
    eventTypeId: 'et1',
    title: 'Intro',
    start: '2030-01-01T09:00:00.000Z',
    end: '2030-01-01T09:30:00.000Z',
    status: 'accepted',
    attendee: { name: 'A', email: 'a@example.com', phone: '', timezone: 'UTC', locale: 'en', whatsappOptIn: false },
    guests: [],
    notes: '',
    answers: {},
    location: { type: 'meet' },
    noShow: false,
    internalNotes: 'private',
    history: [],
    source: 'web',
    utm: {},
    createdAt: '2029-12-01T00:00:00.000Z',
    ...over,
  }) as Booking

const rec = (data: unknown, kind = 'booking') => ({ id: 'b1', owner_id: OWNER, kind, data })

Deno.test('deriveEvents maps status transitions to webhook events', () => {
  const ins = (b: Booking): DbWebhookPayload => ({ type: 'INSERT', table: 'records', record: rec(b), old_record: null })
  const upd = (o: Booking, n: Booking): DbWebhookPayload => ({ type: 'UPDATE', table: 'records', record: rec(n), old_record: rec(o) })
  const ev = (p: DbWebhookPayload) => deriveEvents(p).map((e) => e.event)

  assertEquals(ev(ins(booking())), ['booking.created'])
  assertEquals(ev(ins(booking({ rescheduledFromId: 'b0' }))), ['booking.rescheduled'])
  assertEquals(ev(upd(booking({ status: 'pending' }), booking())), ['booking.confirmed'])
  assertEquals(ev(upd(booking({ status: 'pending' }), booking({ status: 'rejected' }))), ['booking.rejected'])
  assertEquals(ev(upd(booking(), booking({ status: 'cancelled' }))), ['booking.cancelled'])
  // the old half of a reschedule does not fire booking.cancelled
  assertEquals(ev(upd(booking(), booking({ status: 'cancelled', rescheduledToId: 'b2' }))), [])
  assertEquals(ev(upd(booking(), booking({ payment: { status: 'paid', amount: 1, currency: 'USD' } }))), ['booking.paid'])
  assertEquals(ev(upd(booking(), booking({ notes: 'changed' }))), [])
  assertEquals(deriveEvents({ type: 'INSERT', table: 'records', record: rec({}, 'webhook_delivery'), old_record: null }), [])
  // payload never leaks internal notes or the manage token
  const data = deriveEvents(ins(booking()))[0].data.booking as Record<string, unknown>
  assertEquals(data.internalNotes, undefined)
  assertEquals(data.token, undefined)
})

Deno.test('poll votes and routing submissions are derived', () => {
  const poll = (n: number) => ({ id: 'p1', voters: Array.from({ length: n }, (_, i) => ({ id: 'v' + i })) })
  assertEquals(
    deriveEvents({ type: 'UPDATE', table: 'records', record: rec(poll(2), 'poll'), old_record: rec(poll(1), 'poll') }).map((e) => e.event),
    ['poll.voted'],
  )
  const form = (n: number) => ({ id: 'f1', responses: Array.from({ length: n }, (_, i) => ({ id: 'r' + i })) })
  assertEquals(
    deriveEvents({ type: 'UPDATE', table: 'records', record: rec(form(3), 'routing_form'), old_record: rec(form(1), 'routing_form') }).length,
    2,
  )
})

Deno.test('dispatch signs requests, records deliveries, retries with backoff and dead-letters', async () => {
  const repo = new MemoryRepo()
  const hook: Webhook = { id: 'wh1', ownerId: OWNER, url: 'https://hooks.example.com/x', secret: 'sek', events: ['booking.created'], active: true, createdAt: '2029-01-01T00:00:00.000Z' }
  repo.seed('webhook', OWNER, hook.id, hook)
  repo.seed('webhook', OWNER, 'wh2', { ...hook, id: 'wh2', events: ['booking.cancelled'] })
  let now = new Date('2030-01-01T00:00:00Z')
  const seen: { headers: Headers; body: string }[] = []
  let status = 500
  const fakeFetch = ((_url: string, init: RequestInit) => {
    seen.push({ headers: new Headers(init.headers), body: String(init.body) })
    return Promise.resolve(new Response('x', { status }))
  }) as typeof fetch
  const deps = { repo, fetch: fakeFetch, now: () => now }

  const out = await dispatchEvent(deps, { ownerId: OWNER, event: 'booking.created', data: { booking: { id: 'b1' } } })
  assertEquals(out.length, 1) // only the subscribed hook
  const h = seen[0].headers
  assertEquals(h.get('x-slotwise-event'), 'booking.created')
  assertEquals(h.get('x-slotwise-delivery'), out[0].id)
  assert(await verifySignatureHeader('sek', seen[0].body, h.get('x-slotwise-signature'), 300, Math.floor(now.getTime() / 1000)))

  let d = repo.all<ServerWebhookDelivery>('webhook_delivery')[0].data
  assertEquals([d.status, d.attempts, d.code], ['retrying', 1, 500])
  assertEquals(Date.parse(d.nextAttemptAt!) - now.getTime(), backoffMs(1))

  // not due yet: nothing happens
  assertEquals((await retryDueDeliveries(deps)).retried, 0)
  for (let i = 2; i <= MAX_ATTEMPTS; i++) {
    now = new Date(now.getTime() + backoffMs(i - 1))
    await retryDueDeliveries(deps)
  }
  d = repo.all<ServerWebhookDelivery>('webhook_delivery')[0].data
  assertEquals([d.status, d.attempts], ['failed', MAX_ATTEMPTS])
  assert(d.deadAt)
  // same delivery id on every attempt so receivers can de-duplicate
  assertEquals(new Set(seen.map((s) => s.headers.get('x-slotwise-delivery'))).size, 1)

  // a success clears retry state
  status = 200
  const ok = await dispatchEvent(deps, { ownerId: OWNER, event: 'booking.created', data: {} })
  assertEquals(ok[0].status, 'ok')
})
