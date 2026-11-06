import { assert, assertEquals } from '@std/assert'
import { checkoutForm, toMinorUnits, verifyStripeSignature } from '../_shared/stripe.ts'
import { hmacSha256Hex } from '../_shared/util.ts'
import { createStripeHandler } from '../stripe/handler.ts'
import type { Booking } from '../_shared/types.ts'
import { MemoryRepo } from './fakes.ts'

const SECRET = 'whsec_test_secret'
const T = 1_800_000_000
const stripeHeader = async (secret: string, body: string, t = T) => `t=${t},v1=${await hmacSha256Hex(secret, `${t}.${body}`)}`

Deno.test('stripe signature: valid', async () => {
  const body = '{"id":"evt_1","type":"checkout.session.completed"}'
  assertEquals(await verifyStripeSignature(SECRET, body, await stripeHeader(SECRET, body), T + 30), null)
  // extra v0 / multiple v1 entries are tolerated (secret rotation)
  const multi = `t=${T},v1=deadbeef,v1=${await hmacSha256Hex(SECRET, `${T}.${body}`)},v0=abc`
  assertEquals(await verifyStripeSignature(SECRET, body, multi, T), null)
})

Deno.test('stripe signature: wrong secret', async () => {
  const body = '{"id":"evt_1"}'
  assertEquals(await verifyStripeSignature(SECRET, body, await stripeHeader('whsec_other', body), T), 'signature mismatch')
})

Deno.test('stripe signature: expired and malformed', async () => {
  const body = '{"id":"evt_1"}'
  assertEquals(await verifyStripeSignature(SECRET, body, await stripeHeader(SECRET, body), T + 301), 'timestamp outside tolerance')
  assertEquals(await verifyStripeSignature(SECRET, body, null, T), 'missing signature header')
  assertEquals(await verifyStripeSignature(SECRET, body, 'v1=abc', T), 'missing timestamp')
  assertEquals(await verifyStripeSignature(SECRET, body, `t=${T}`, T), 'missing v1 signature')
})

Deno.test('checkout form uses minor units, lower-case currency and deposit', () => {
  assertEquals(toMinorUnits(12.5, 'ils'), 1250)
  const b = { id: 'b1', token: 'tok123456789', title: 'Session', attendee: { email: 'a@example.com' }, start: '' } as unknown as Booking
  const full = checkoutForm(b, { title: 'Session', price: { amount: 200, currency: 'ILS', mode: 'full' } }, 'https://app.example/')!
  assertEquals(full.get('line_items[0][price_data][currency]'), 'ils')
  assertEquals(full.get('line_items[0][price_data][unit_amount]'), '20000')
  assertEquals(full.get('client_reference_id'), 'b1')
  assertEquals(full.get('success_url'), 'https://app.example/#/b/tok123456789?paid=1')
  const dep = checkoutForm(b, { title: 'Session', price: { amount: 200, currency: 'USD', mode: 'deposit', depositAmount: 50 } }, 'https://app.example/')!
  assertEquals(dep.get('line_items[0][price_data][unit_amount]'), '5000')
  assertEquals(checkoutForm(b, { title: 'x', price: null }, ''), null)
})

Deno.test('stripe webhook marks the booking paid once', async () => {
  Deno.env.set('STRIPE_WEBHOOK_SECRET', SECRET)
  const repo = new MemoryRepo()
  repo.seed('booking', 'owner', 'b1', { id: 'b1', status: 'accepted', history: [], payment: { status: 'unpaid', amount: 200, currency: 'ILS' } })
  const handler = createStripeHandler({ repo: () => repo, now: () => new Date(T * 1000) })
  const event = JSON.stringify({
    id: 'evt_1',
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_1', client_reference_id: 'b1', payment_status: 'paid', payment_intent: 'pi_1', amount_total: 20000, currency: 'ils' } },
  })
  const send = async (sig: string) =>
    await handler(new Request('http://x/functions/v1/stripe/webhook', { method: 'POST', body: event, headers: { 'stripe-signature': sig } }))

  assertEquals((await send(await stripeHeader('wrong', event))).status, 401)
  const res = await send(await stripeHeader(SECRET, event))
  assertEquals(res.status, 200)
  const b = repo.all<Booking>('booking')[0].data
  assertEquals(b.payment?.status, 'paid')
  assertEquals(b.payment?.amount, 200)
  assertEquals(b.payment?.currency, 'ILS')
  assertEquals(b.payment?.ref, 'pi_1')
  assertEquals(b.history.at(-1)?.action, 'paid')
  // Stripe retry: no duplicate history entry
  assertEquals((await (await send(await stripeHeader(SECRET, event))).json()).updated, false)
  assertEquals(repo.all<Booking>('booking')[0].data.history.length, 1)
  assert(true)
})
