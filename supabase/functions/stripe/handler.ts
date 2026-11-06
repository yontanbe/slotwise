/**
 * Stripe payments without the SDK.
 *   POST /stripe/checkout  { token }  -> { url, id }   (public: called from the invitee's booking page)
 *   POST /stripe/webhook               Stripe events, Stripe-Signature verified with STRIPE_WEBHOOK_SECRET
 */
import { mutate, type Repo } from '../_shared/db.ts'
import { errorResponse, json, preflight, stripPrefix } from '../_shared/http.ts'
import { chargeAmount, checkoutForm, fromMinorUnits, toMinorUnits, verifyStripeSignature } from '../_shared/stripe.ts'
import type { Booking, EventType } from '../_shared/types.ts'
import { appUrl, env, timingSafeEqual } from '../_shared/util.ts'

export interface StripeDeps {
  repo: () => Repo
  fetch?: typeof fetch
  now?: () => Date
}

interface CheckoutSession {
  id: string
  client_reference_id?: string | null
  payment_status?: string
  payment_intent?: string | null
  amount_total?: number | null
  currency?: string | null
  metadata?: Record<string, string>
}

export function createStripeHandler(deps: StripeDeps) {
  const nowDate = () => deps.now?.() ?? new Date()

  async function checkout(req: Request): Promise<Response> {
    const key = env('STRIPE_SECRET_KEY')
    if (!key) return errorResponse('internal', 'payments are not configured')
    const b = await req.json().catch(() => null)
    const token = typeof b?.token === 'string' ? b.token : ''
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(token)) return errorResponse('invalid_request', 'token is required')
    const repo = deps.repo()
    const rec = (await repo.find<Booking>('booking', { eq: { 'data->>token': token }, limit: 1 }))[0]
    if (!rec) return errorResponse('not_found', 'booking not found')
    // the row id is authoritative (data.id is client data); the token is checked again in the webhook
    const booking = { ...rec.data, id: rec.id }
    if (!['accepted', 'pending'].includes(booking.status)) return errorResponse('conflict', `booking is ${booking.status}`)
    if (booking.payment?.status === 'paid') return errorResponse('conflict', 'already paid')
    const etRec = await repo.get<EventType>('event_type', booking.eventTypeId)
    // the price comes from the booking owner's event type (or a team type they host)
    const et = etRec && (etRec.owner_id === rec.owner_id || (etRec.data.hosts ?? []).some((h) => h.userId === rec.owner_id)) ? etRec.data : null
    if (!et) return errorResponse('not_found', 'event type not found')
    const form = checkoutForm(booking, et, appUrl())
    const charge = chargeAmount(et)
    if (!form || !charge) return errorResponse('invalid_request', 'this event type has no price')
    const res = await (deps.fetch ?? fetch)('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        // same booking + same amount within 24h returns the same session
        'Idempotency-Key': `checkout-${booking.id}-${form.get('line_items[0][price_data][unit_amount]')}-${form.get('line_items[0][price_data][currency]')}`,
      },
      body: form.toString(),
      signal: AbortSignal.timeout(15_000),
    })
    const out = await res.json().catch(() => ({}))
    if (!res.ok) {
      console.error('stripe checkout', res.status, out?.error?.message)
      return errorResponse('upstream_error', out?.error?.message ?? `stripe error ${res.status}`)
    }
    if (typeof out?.id !== 'string') return errorResponse('upstream_error', 'stripe returned no session')
    // remember the session and the amount it must collect; the webhook only accepts this session
    const checkoutInfo = { sessionId: out.id, amountMinor: toMinorUnits(charge.amount, charge.currency), currency: charge.currency, createdAt: nowDate().toISOString() }
    await mutate<Booking>(repo, 'booking', rec.id, rec.owner_id, (b) => ({
      ...b,
      payment: { ...(b.payment ?? { status: 'unpaid', amount: charge.amount, currency: charge.currency.toUpperCase() }), checkout: checkoutInfo },
    }))
    return json({ id: out.id, url: out.url })
  }

  async function webhook(req: Request): Promise<Response> {
    const secret = env('STRIPE_WEBHOOK_SECRET')
    if (!secret) return errorResponse('internal', 'webhook secret not configured')
    const raw = await req.text()
    const why = await verifyStripeSignature(secret, raw, req.headers.get('stripe-signature'), Math.floor(nowDate().getTime() / 1000))
    if (why) return errorResponse('unauthorized', `invalid signature: ${why}`)
    let event: { id: string; type: string; data?: { object?: CheckoutSession } }
    try {
      event = JSON.parse(raw)
    } catch {
      return errorResponse('invalid_request', 'invalid JSON')
    }
    if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.async_payment_succeeded') {
      return json({ received: true, ignored: event.type })
    }
    const s = event.data?.object
    if (!s || s.payment_status !== 'paid') return json({ received: true, ignored: 'not paid yet' })
    const ignore = (reason: string) => {
      console.warn('stripe webhook ignored', event.id, s.id, reason)
      return json({ received: true, ignored: reason })
    }
    const bookingId = s.client_reference_id || s.metadata?.booking_id
    if (!bookingId) return ignore('no booking reference')
    const repo = deps.repo()
    const rec = await repo.get<Booking>('booking', bookingId)
    if (!rec) return ignore('booking not found')
    const token = s.metadata?.booking_token ?? ''
    if (!rec.data.token || !timingSafeEqual(token, rec.data.token)) return ignore('booking token mismatch')
    const expected = rec.data.payment?.checkout
    if (!expected || expected.sessionId !== s.id) return ignore('checkout session mismatch')
    const currency = (s.currency ?? '').toLowerCase()
    if (currency !== expected.currency.toLowerCase()) return ignore('currency mismatch')
    if (typeof s.amount_total !== 'number' || s.amount_total < expected.amountMinor) return ignore('amount below expected')
    const ref = s.payment_intent || s.id
    const at = nowDate().toISOString()
    const updated = await mutate<Booking>(repo, 'booking', rec.id, rec.owner_id, (b) => {
      if (b.payment?.status === 'paid' && b.payment.ref === ref) return null // Stripe retries: already applied
      return {
        ...b,
        payment: {
          ...(b.payment ?? {}),
          status: 'paid',
          amount: fromMinorUnits(s.amount_total ?? 0, currency),
          currency: currency.toUpperCase(),
          paidAt: at,
          ref,
        },
        history: [...(b.history ?? []), { at, action: 'paid', by: 'system', note: `stripe ${s.id}` }],
      }
    })
    return json({ received: true, updated: !!updated })
  }

  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return preflight()
    const path = stripPrefix(new URL(req.url).pathname, 'stripe')
    if (req.method !== 'POST') return errorResponse('method_not_allowed', 'POST only')
    try {
      if (path === '/checkout') return await checkout(req)
      if (path === '/webhook') return await webhook(req)
      return errorResponse('not_found', 'unknown path')
    } catch (e) {
      console.error(e)
      return errorResponse('internal', 'internal error')
    }
  }
}
