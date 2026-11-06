/** Regression tests for the security review findings (Deno side). Offline: fakes only. */
import { assert, assertEquals, assertFalse, assertRejects } from '@std/assert'
import { createStripeHandler } from '../stripe/handler.ts'
import { createMcpHandler, MAX_BATCH } from '../mcp/server.ts'
import { SlidingWindowLimiter } from '../_shared/ratelimit.ts'
import { createService, REMINDER_DAILY_LIMIT, type Caller } from '../_shared/service.ts'
import { dispatchEvent, retryDueDeliveries, verifySignatureHeader } from '../_shared/webhooks.ts'
import { BLOCKED_DESTINATION, checkOutboundUrl, NETWORK_ERROR, urlPolicyError } from '../_shared/ssrf.ts'
import { runWorkflows } from '../cron/run.ts'
import type { Booking, ServerWebhookDelivery } from '../_shared/types.ts'
import { hmacSha256Hex } from '../_shared/util.ts'
import { fakeService, GOOD_KEY, MemoryRepo } from './fakes.ts'

const OWNER = '00000000-0000-0000-0000-000000000001'
const NOW = new Date('2030-01-01T00:00:00Z')
const T = Math.floor(Date.now() / 1000)

/* ---------------- finding 4: stripe ---------------- */

function stripeWorld() {
  Deno.env.set('STRIPE_SECRET_KEY', 'sk_test')
  Deno.env.set('STRIPE_WEBHOOK_SECRET', 'whsec')
  const repo = new MemoryRepo()
  repo.seed('booking', 'victimHost', 'vb1', { id: 'vb1', token: 'victimtok'.repeat(3), status: 'accepted', eventTypeId: 'vet', history: [], payment: { status: 'unpaid', amount: 100, currency: 'USD' } })
  repo.seed('event_type', 'victimHost', 'vet', { id: 'vet', title: 'VIP', price: { amount: 100, currency: 'USD', mode: 'full' } })
  repo.seed('event_type', 'atk', 'aet', { id: 'aet', title: 'x', price: { amount: 0.5, currency: 'USD', mode: 'full' } })
  // a row the attacker wrote through RLS with data.id spoofed to the victim booking (now also blocked by records_guard)
  repo.seed('booking', 'atk', 'atk-row', { id: 'vb1', token: 'attackertoken123', status: 'accepted', eventTypeId: 'aet', attendee: {}, history: [] })
  let n = 0
  const forms: URLSearchParams[] = []
  const h = createStripeHandler({
    repo: () => repo,
    fetch: (async (_u: string, init: RequestInit) => {
      forms.push(new URLSearchParams(String(init.body)))
      return new Response(JSON.stringify({ id: 'cs_' + ++n, url: 'https://checkout.stripe.com/x' }))
    }) as typeof fetch,
  })
  const checkout = (token: string) => h(new Request('http://x/stripe/checkout', { method: 'POST', body: JSON.stringify({ token }) }))
  const webhook = async (obj: Record<string, unknown>) => {
    const body = JSON.stringify({ id: 'evt', type: 'checkout.session.completed', data: { object: { payment_status: 'paid', ...obj } } })
    const res = await h(new Request('http://x/stripe/webhook', { method: 'POST', body, headers: { 'stripe-signature': `t=${T},v1=${await hmacSha256Hex('whsec', `${T}.${body}`)}` } }))
    return await res.json()
  }
  const paid = (id: string) => (repo.rows.get(id)!.data as Booking).payment?.status
  return { repo, checkout, webhook, forms, paid }
}

Deno.test('stripe: checkout uses the row id + token and stores the session on the booking', async () => {
  const { repo, checkout, forms } = stripeWorld()
  assertEquals((await checkout('attackertoken123')).status, 200)
  const f = forms[0]
  assertEquals([f.get('client_reference_id'), f.get('metadata[booking_id]'), f.get('metadata[booking_token]')], ['atk-row', 'atk-row', 'attackertoken123'])
  assertEquals((repo.rows.get('atk-row')!.data as Booking).payment?.checkout?.sessionId, 'cs_1')
  assertEquals((repo.rows.get('atk-row')!.data as Booking).payment?.checkout?.amountMinor, 50)
})

Deno.test('stripe: cheap session cannot mark the victim booking paid (PoC)', async () => {
  const { checkout, webhook, paid } = stripeWorld()
  await checkout('attackertoken123')
  // the attacker replays its own paid session against the victim booking id
  const out = await webhook({ id: 'cs_1', client_reference_id: 'vb1', amount_total: 50, currency: 'usd', metadata: { booking_id: 'vb1', booking_token: 'attackertoken123' } })
  assertEquals(out.ignored, 'booking token mismatch')
  assertEquals(paid('vb1'), 'unpaid')
})

Deno.test('stripe: webhook requires matching session, currency and full amount', async () => {
  const { checkout, webhook, paid } = stripeWorld()
  await checkout('victimtok'.repeat(3)) // cs_1 for vb1, 10000 minor USD
  const meta = { booking_id: 'vb1', booking_token: 'victimtok'.repeat(3) }
  assertEquals((await webhook({ id: 'cs_other', client_reference_id: 'vb1', amount_total: 10000, currency: 'usd', metadata: meta })).ignored, 'checkout session mismatch')
  assertEquals((await webhook({ id: 'cs_1', client_reference_id: 'vb1', amount_total: 10000, currency: 'eur', metadata: meta })).ignored, 'currency mismatch')
  assertEquals((await webhook({ id: 'cs_1', client_reference_id: 'vb1', amount_total: 9999, currency: 'usd', metadata: meta })).ignored, 'amount below expected')
  assertEquals(paid('vb1'), 'unpaid')
  assertEquals((await webhook({ id: 'cs_1', client_reference_id: 'vb1', amount_total: 10000, currency: 'usd', metadata: meta })).updated, true)
  assertEquals(paid('vb1'), 'paid')
})

/* ---------------- finding 5: MCP limits ---------------- */

const mcpPost = (h: (r: Request) => Promise<Response>, body: unknown) =>
  h(new Request('http://x/mcp', { method: 'POST', headers: { authorization: `Bearer ${GOOD_KEY}` }, body: JSON.stringify(body) }))
const call = (i: number) => ({ jsonrpc: '2.0', id: i, method: 'tools/call', params: { name: 'list_bookings', arguments: {} } })

Deno.test('mcp: batches over 20 messages are rejected before any call (PoC 500)', async () => {
  const svc = fakeService()
  const res = await mcpPost(createMcpHandler({ service: svc }), Array.from({ length: 500 }, (_, i) => call(i)))
  assertEquals(res.status, 400)
  assertEquals(svc.calls.length, 0)
  assertEquals(MAX_BATCH, 20)
})

Deno.test('mcp: each call in a batch counts against the per key limit; batches run sequentially', async () => {
  let running = 0
  let maxParallel = 0
  const svc = fakeService({
    listBookings: async () => {
      maxParallel = Math.max(maxParallel, ++running)
      await new Promise((r) => setTimeout(r, 1))
      running--
      return { bookings: [], total: 0, limit: 50, offset: 0 }
    },
  })
  const h = createMcpHandler({ service: svc, limiter: new SlidingWindowLimiter(5, 60_000) })
  const out = await (await mcpPost(h, Array.from({ length: 8 }, (_, i) => call(i)))).json()
  assertEquals(out.filter((r: { result?: unknown }) => r.result).length, 5)
  assertEquals(out.filter((r: { error?: { code: number } }) => r.error?.code === -32029).length, 3)
  assertEquals(maxParallel, 1)
  // the key is now over the limit: a single request gets HTTP 429
  const single = await mcpPost(h, call(99))
  assertEquals(single.status, 429)
  assert(single.headers.get('retry-after'))
})

/* ---------------- finding 6: messaging ---------------- */

function serviceWorld() {
  const repo = new MemoryRepo()
  repo.seed('profile', OWNER, 'prof', { id: OWNER, name: 'Host', email: 'host@example.com', username: 'host', timezone: 'UTC', locale: 'en', weekStart: 0, defaultScheduleId: 's1', phone: '' })
  const day = [{ start: '00:00', end: '24:00' }]
  repo.seed('schedule', OWNER, 's1', { id: 's1', name: 'Work', timezone: 'UTC', weekly: Array(7).fill(day), overrides: [] })
  repo.seed('event_type', OWNER, 'et1', {
    id: 'et1', ownerId: OWNER, title: 'Intro', durations: [30], defaultDuration: 30, scheduleId: 's1', bufferBefore: 0, bufferAfter: 0,
    minNoticeMins: 0, window: { type: 'rolling', days: 30 }, limits: {}, seats: null, locations: [{ type: 'meet' }], requiresConfirmation: false,
  })
  repo.rpcs.public_busy = () => ({ bookings: [], busy: [] })
  const sent: Record<string, unknown>[] = []
  repo.rpcs.public_create_booking = (a) => {
    const p = a.p_booking as Record<string, unknown>
    sent.push(p)
    const b = { ...p, id: 'srv1', token: 'tok1xxxxxxxxxxxxxxxx', status: 'accepted', history: [], createdAt: NOW.toISOString() }
    repo.seed('booking', OWNER, 'srv1', b)
    return { ok: true, booking: b }
  }
  repo.seed('booking', OWNER, 'b1', {
    id: 'b1', token: 'tok_b1_xxxxxxxxxxxxxxx', eventTypeId: 'et1', title: 'Intro', status: 'accepted', start: '2030-01-02T09:00:00Z', end: '2030-01-02T09:30:00Z',
    attendee: { name: 'Dana', email: 'dana@example.com', phone: '0501234567', timezone: 'UTC', locale: 'en', whatsappOptIn: true }, history: [], location: { type: 'meet' }, notes: '',
  })
  const c: Caller = { ownerId: OWNER, apiKeyId: 'k1', keyName: 't', scopes: ['read', 'write'], actor: 'mcp', client: 'x' }
  return { repo, sent, c, svc: createService({ repo, now: () => NOW }) }
}

Deno.test('service: API / MCP bookings never carry whatsappOptIn from the caller', async () => {
  const { svc, c, sent } = serviceWorld()
  // deno-lint-ignore no-explicit-any
  const attendee = { name: 'Dana', email: 'dana@example.com', phone: '+15550001', whatsappOptIn: true } as any
  await svc.createBooking(c, { eventTypeId: 'et1', start: '2030-01-02T10:00:00Z', attendee })
  assertEquals((sent[0].attendee as { whatsappOptIn: boolean }).whatsappOptIn, false)
})

Deno.test('service: reminder text is capped at 500 chars and 50 reminders per owner per day', async () => {
  const { svc, c, repo } = serviceWorld()
  await assertRejects(() => svc.sendReminder(c, { bookingId: 'b1', channel: 'email', message: 'x'.repeat(501) }), Error, 'at most 500')
  for (let i = 0; i < REMINDER_DAILY_LIMIT; i++) {
    repo.seed('audit', OWNER, 'a' + i, { id: 'a' + i, ownerId: OWNER, at: new Date(NOW.getTime() - 3600_000).toISOString(), action: i % 2 ? 'reminder.email' : 'reminder.whatsapp', actor: 'mcp', client: 'x', target: 'b1' })
  }
  await assertRejects(() => svc.sendReminder(c, { bookingId: 'b1', channel: 'email', message: 'hi' }), Error, 'daily reminder limit')
  assertEquals(repo.all('outbox').length, 0)
})

/* ---------------- finding 7: SSRF ---------------- */

Deno.test('ssrf: url policy', async () => {
  for (const u of [
    'http://example.com/hook', 'https://localhost/x', 'https://127.0.0.1/', 'https://10.1.2.3/', 'https://169.254.169.254/latest/meta-data',
    'https://[::1]/', 'https://[fd00:ec2::254]/', 'https://[::ffff:192.168.0.1]/', 'https://metadata.google.internal/', 'https://printer.local/',
    'https://intranet/', 'https://2130706433/', 'https://user:pw@example.com/', 'https://example.com:8443/',
  ]) assert(urlPolicyError(u), u)
  assertEquals(urlPolicyError('https://hooks.example.com/x'), null)
  assertEquals(urlPolicyError('https://93.184.216.34/x'), null)
  const resolver = (ip: string) => (_h: string, t: 'A' | 'AAAA') => (t === 'A' ? Promise.resolve([ip]) : Promise.reject(Object.assign(new Error('nx'), { name: 'NotFound' })))
  assertEquals(await checkOutboundUrl('https://rebind.example.com/', resolver('10.0.0.5')), 'resolves to a private address')
  assertEquals(await checkOutboundUrl('https://ok.example.com/', resolver('93.184.216.34')), null)
})

Deno.test('ssrf: webhook delivery to an internal address is never fetched; generic errors; no redirects', async () => {
  const repo = new MemoryRepo()
  repo.seed('webhook', OWNER, 'h1', { id: 'h1', url: 'https://169.254.169.254/latest', secret: 's', active: true, events: ['booking.created'], createdAt: '' })
  repo.seed('webhook', OWNER, 'h2', { id: 'h2', url: 'https://hooks.example.com/a', secret: 's', active: true, events: ['booking.created'], createdAt: '' })
  const seen: RequestInit[] = []
  const f = ((_u: string, init: RequestInit) => (seen.push(init), Promise.reject(new Error('connect ECONNREFUSED 10.0.0.1:443 (internal detail)')))) as unknown as typeof fetch
  const out = await dispatchEvent({ repo, fetch: f, resolveDns: null }, { ownerId: OWNER, event: 'booking.created', data: {} })
  const byHook = Object.fromEntries(out.map((d) => [d.webhookId, d.lastError]))
  assertEquals(byHook, { h1: BLOCKED_DESTINATION, h2: NETWORK_ERROR })
  assertEquals(seen.length, 1)
  assertEquals(seen[0].redirect, 'manual')
})

/* ---------------- finding 3: retries use row columns ---------------- */

Deno.test('webhook retry: forged delivery row is updated by row id (PoC), not re-sent forever', async () => {
  const repo = new MemoryRepo()
  repo.seed('webhook', 'atk', 'h1', { id: 'h1', url: 'https://target.example/', secret: 's', active: true, events: [] })
  repo.seed('webhook_delivery', 'atk', 'row1', { id: 'not-row1', ownerId: 'atk', webhookId: 'h1', status: 'retrying', attempts: 0, at: '', payload: {} })
  let n = 0
  const f = (async () => (n++, new Response('', { status: 500 }))) as unknown as typeof fetch
  for (let i = 0; i < 10; i++) await retryDueDeliveries({ repo, fetch: f, resolveDns: null })
  assertEquals(n, 1) // backoff applied to the stored row
  const d = repo.rows.get('row1')!.data as ServerWebhookDelivery
  assertEquals([d.id, d.attempts, d.status], ['row1', 1, 'retrying'])
})

Deno.test('webhook retry: data.ownerId cannot point a delivery at another owner\'s webhook', async () => {
  const repo = new MemoryRepo()
  repo.seed('webhook', 'victim', 'vh', { id: 'vh', url: 'https://victim.example/', secret: 'victim-secret', active: true, events: [] })
  repo.seed('webhook_delivery', 'atk', 'row2', { id: 'row2', ownerId: 'victim', webhookId: 'vh', status: 'retrying', attempts: 0, at: '', payload: { forged: true } })
  let n = 0
  const f = (async () => (n++, new Response(''))) as unknown as typeof fetch
  await retryDueDeliveries({ repo, fetch: f, resolveDns: null })
  assertEquals(n, 0)
  assertEquals((repo.rows.get('row2')!.data as ServerWebhookDelivery).status, 'failed')
})

/* ---------------- finding 8: per owner workflow signing ---------------- */

Deno.test('workflow webhook steps are signed with the owner\'s own secret, generated once', async () => {
  Deno.env.set('WORKFLOW_WEBHOOK_SECRET', 'global-shared-secret')
  const repo = new MemoryRepo()
  repo.seed('profile', OWNER, 'prof', { id: OWNER, name: 'Host', email: 'h@example.com', phone: '', timezone: 'UTC', locale: 'en', automationOnServer: true })
  repo.seed('workflow', OWNER, 'w1', {
    id: 'w1', name: 'Hook', active: true, trigger: 'before_start', offsetMins: 60, eventTypeIds: [], createdAt: '2029-01-01T00:00:00Z',
    steps: [{ id: 's1', action: 'webhook', to: 'https://hooks.example.com/wf', subject: '', body: 'x' }],
  })
  repo.seed('booking', OWNER, 'b1', {
    id: 'b1', token: 'tok', eventTypeId: 'et1', title: 'Intro', status: 'accepted', start: '2030-01-01T00:30:00Z', end: '2030-01-01T01:00:00Z',
    attendee: { name: 'Dana', email: 'd@example.com', phone: '', timezone: 'UTC', locale: 'en', whatsappOptIn: false }, history: [], location: { type: 'meet' }, notes: '', createdAt: '2029-12-31T00:00:00Z', noShow: false,
  })
  const posts: { body: string; sig: string; redirect?: string }[] = []
  const f = (async (_u: string, init: RequestInit) => {
    posts.push({ body: String(init.body), sig: (init.headers as Record<string, string>)['X-Slotwise-Signature'], redirect: init.redirect })
    return new Response('')
  }) as typeof fetch
  assertEquals((await runWorkflows({ repo, fetch: f, now: () => NOW, resolveDns: null })).executed, 1)
  const secret = (repo.rows.get('prof')!.data as { workflowSecret?: string }).workflowSecret!
  assert(secret && secret.length >= 24)
  assert(await verifySignatureHeader(secret, posts[0].body, posts[0].sig))
  assertFalse(await verifySignatureHeader('global-shared-secret', posts[0].body, posts[0].sig))
  assertEquals(posts[0].redirect, 'manual')
  Deno.env.delete('WORKFLOW_WEBHOOK_SECRET')
})
