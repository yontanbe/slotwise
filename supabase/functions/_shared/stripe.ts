/** Stripe helpers without the SDK: manual signature verification and Checkout form encoding. */
import type { Booking, EventType } from './types.ts'
import { hmacSha256Hex, timingSafeEqual } from './util.ts'

export const STRIPE_TOLERANCE_SEC = 300

/**
 * Verifies a `Stripe-Signature` header (t=...,v1=...[,v1=...]) against the raw body.
 * Returns a reason string on failure, or null when valid.
 */
export async function verifyStripeSignature(
  secret: string,
  rawBody: string,
  header: string | null,
  nowSec = Math.floor(Date.now() / 1000),
  toleranceSec = STRIPE_TOLERANCE_SEC,
): Promise<string | null> {
  if (!header) return 'missing signature header'
  let t = NaN
  const v1: string[] = []
  for (const part of header.split(',')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const k = part.slice(0, i).trim()
    const v = part.slice(i + 1).trim()
    if (k === 't') t = Number(v)
    else if (k === 'v1') v1.push(v)
  }
  if (!Number.isFinite(t)) return 'missing timestamp'
  if (!v1.length) return 'missing v1 signature'
  if (Math.abs(nowSec - t) > toleranceSec) return 'timestamp outside tolerance'
  const expected = await hmacSha256Hex(secret, `${t}.${rawBody}`)
  return v1.some((s) => timingSafeEqual(s, expected)) ? null : 'signature mismatch'
}

/** Currencies Stripe treats as zero-decimal (subset that could plausibly appear). */
const ZERO_DECIMAL = new Set(['jpy', 'krw', 'vnd', 'clp', 'pyg', 'ugx', 'xaf', 'xof'])

export function toMinorUnits(amountMajor: number, currency: string): number {
  return ZERO_DECIMAL.has(currency.toLowerCase()) ? Math.round(amountMajor) : Math.round(amountMajor * 100)
}

export function fromMinorUnits(amountMinor: number, currency: string): number {
  return ZERO_DECIMAL.has(currency.toLowerCase()) ? amountMinor : amountMinor / 100
}

export function chargeAmount(et: Pick<EventType, 'price'>): { amount: number; currency: string; mode: 'full' | 'deposit' } | null {
  const p = et.price
  if (!p || !(p.amount > 0)) return null
  const amount = p.mode === 'deposit' && p.depositAmount && p.depositAmount > 0 ? p.depositAmount : p.amount
  return { amount, currency: p.currency.toLowerCase(), mode: p.mode }
}

export function checkoutForm(
  booking: Pick<Booking, 'id' | 'token' | 'title' | 'attendee' | 'start'>,
  et: Pick<EventType, 'price' | 'title'>,
  appBase: string,
): URLSearchParams | null {
  const charge = chargeAmount(et)
  if (!charge) return null
  const manage = `${appBase}#/b/${booking.token}`
  const f = new URLSearchParams()
  f.set('mode', 'payment')
  f.set('client_reference_id', booking.id)
  f.set('success_url', `${manage}?paid=1`)
  f.set('cancel_url', `${manage}?paid=0`)
  f.set('line_items[0][quantity]', '1')
  f.set('line_items[0][price_data][currency]', charge.currency)
  f.set('line_items[0][price_data][unit_amount]', String(toMinorUnits(charge.amount, charge.currency)))
  f.set('line_items[0][price_data][product_data][name]', `${et.title || booking.title}${charge.mode === 'deposit' ? ' (deposit)' : ''}`)
  f.set('metadata[booking_id]', booking.id)
  f.set('metadata[booking_token]', booking.token)
  f.set('payment_intent_data[metadata][booking_id]', booking.id)
  if (booking.attendee?.email) f.set('customer_email', booking.attendee.email)
  return f
}
