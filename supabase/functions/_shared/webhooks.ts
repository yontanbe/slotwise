/**
 * Outgoing webhooks: event derivation from record changes, HMAC signing, delivery log,
 * exponential backoff retries and dead lettering.
 *
 * Signature header: X-Slotwise-Signature: t=<unix seconds>,v1=<hex hmac_sha256(secret, `${t}.${body}`)>
 */
import { mutate, type Repo, type Rec } from './db.ts'
import type { Booking, Poll, RoutingForm, ServerWebhookDelivery, Webhook, WebhookEvent } from './types.ts'
import { hmacSha256Hex, timingSafeEqual, uid } from './util.ts'

export const WEBHOOK_EVENTS: WebhookEvent[] = [
  'booking.created',
  'booking.cancelled',
  'booking.rescheduled',
  'booking.confirmed',
  'booking.rejected',
  'booking.paid',
  'poll.voted',
  'routing.submitted',
]

export const MAX_ATTEMPTS = 5
export const BACKOFF_BASE_MS = 2 * 60_000

/** Delay after the n-th failed attempt (1-based): 2, 4, 8, 16 minutes. */
export function backoffMs(attempts: number): number {
  return BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1)
}

export async function signatureHeader(secret: string, body: string, unixSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
  return `t=${unixSeconds},v1=${await hmacSha256Hex(secret, `${unixSeconds}.${body}`)}`
}

/** Receiver side check, exported so integrators (and tests) can use the same code. */
export async function verifySignatureHeader(
  secret: string,
  body: string,
  header: string | null,
  toleranceSec = 300,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!header) return false
  const parts = header.split(',').map((p) => p.trim().split('='))
  const t = Number(parts.find(([k]) => k === 't')?.[1])
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v)
  if (!Number.isFinite(t) || !sigs.length) return false
  if (Math.abs(nowSec - t) > toleranceSec) return false
  const expected = await hmacSha256Hex(secret, `${t}.${body}`)
  return sigs.some((s) => timingSafeEqual(s, expected))
}

/* ---------------- event derivation ---------------- */

export interface DbWebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  table: string
  schema?: string
  record: { id: string; owner_id: string; kind: string; data: unknown } | null
  old_record: { id: string; owner_id: string; kind: string; data: unknown } | null
}

export interface DerivedEvent {
  ownerId: string
  event: WebhookEvent
  data: Record<string, unknown>
  /** booking events: id used to claim the event in booking.webhooksSent (shared with the browser sync) */
  bookingId?: string
  /** only webhooks created at or before this time receive the event (same rule as the browser) */
  notAfter?: string
}

const ACTIVE = ['accepted', 'pending']

/** Same shape the browser sync sends: no internal notes, no manage token. */
export function publicBooking(b: Booking): Record<string, unknown> {
  const { internalNotes: _n, token: _t, ...rest } = b
  return rest as unknown as Record<string, unknown>
}

/** Turns a records insert/update into zero or more webhook events. */
export function deriveEvents(p: DbWebhookPayload): DerivedEvent[] {
  const rec = p.record
  if (!rec || p.type === 'DELETE') return []
  const ownerId = rec.owner_id
  const out: DerivedEvent[] = []
  if (rec.kind === 'booking') {
    const b = rec.data as Booking
    const old = p.type === 'UPDATE' ? (p.old_record?.data as Booking | undefined) : undefined
    const data = { booking: publicBooking(b) }
    const meta = { bookingId: b.id, notAfter: b.createdAt }
    if (!old) {
      if (ACTIVE.includes(b.status)) out.push({ ownerId, event: b.rescheduledFromId ? 'booking.rescheduled' : 'booking.created', data, ...meta })
    } else {
      if (old.status !== b.status) {
        if (old.status === 'pending' && b.status === 'accepted') out.push({ ownerId, event: 'booking.confirmed', data, ...meta })
        else if (b.status === 'rejected') out.push({ ownerId, event: 'booking.rejected', data, ...meta })
        // the old half of a reschedule is reported once, as booking.rescheduled on the new row
        else if (b.status === 'cancelled' && !b.rescheduledToId) out.push({ ownerId, event: 'booking.cancelled', data, ...meta })
      }
      if (b.payment?.status === 'paid' && old.payment?.status !== 'paid') out.push({ ownerId, event: 'booking.paid', data, ...meta })
    }
  } else if (rec.kind === 'poll') {
    const poll = rec.data as Poll
    const old = p.old_record?.data as Poll | undefined
    const before = old?.voters?.length ?? 0
    if ((poll.voters?.length ?? 0) > before || (old && JSON.stringify(old.voters) !== JSON.stringify(poll.voters))) {
      out.push({ ownerId, event: 'poll.voted', data: { poll } })
    }
  } else if (rec.kind === 'routing_form') {
    const form = rec.data as RoutingForm
    const old = p.old_record?.data as RoutingForm | undefined
    const before = old?.responses?.length ?? 0
    const fresh = (form.responses ?? []).slice(before)
    for (const response of fresh) out.push({ ownerId, event: 'routing.submitted', data: { formId: form.id, response } })
  }
  return out
}

/* ---------------- delivery ---------------- */

export interface WebhookDeps {
  repo: Repo
  fetch?: typeof fetch
  now?: () => Date
}

export function deliveryBody(d: Pick<ServerWebhookDelivery, 'id' | 'event' | 'at' | 'payload'>): string {
  return JSON.stringify({ id: d.id, event: d.event, createdAt: d.at, data: d.payload })
}

/** One HTTP attempt. Mutates and persists the delivery record. */
export async function attemptDelivery(deps: WebhookDeps, hook: Webhook, d: ServerWebhookDelivery, isNew: boolean): Promise<ServerWebhookDelivery> {
  const now = deps.now?.() ?? new Date()
  const body = deliveryBody(d)
  const f = deps.fetch ?? fetch
  let code: number | undefined
  let error: string | undefined
  try {
    const res = await f(hook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Slotwise-Webhooks/1',
        'X-Slotwise-Event': d.event,
        'X-Slotwise-Delivery': d.id,
        'X-Slotwise-Signature': await signatureHeader(hook.secret, body, Math.floor(now.getTime() / 1000)),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    })
    code = res.status
    await res.body?.cancel().catch(() => {})
    if (!res.ok) error = `HTTP ${res.status}`
  } catch (e) {
    error = String((e as Error).message ?? e)
  }
  d.attempts += 1
  d.code = code
  d.at = d.at || now.toISOString()
  if (!error) {
    d.status = 'ok'
    delete d.nextAttemptAt
    delete d.lastError
  } else if (d.attempts >= MAX_ATTEMPTS) {
    d.status = 'failed'
    d.lastError = error
    d.deadAt = now.toISOString()
    delete d.nextAttemptAt
  } else {
    d.status = 'retrying'
    d.lastError = error
    d.nextAttemptAt = new Date(now.getTime() + backoffMs(d.attempts)).toISOString()
  }
  if (isNew) await deps.repo.insert('webhook_delivery', d.ownerId, d.id, d)
  else {
    const rec = await deps.repo.get<ServerWebhookDelivery>('webhook_delivery', d.id, d.ownerId)
    if (rec) await deps.repo.update(rec, d)
  }
  return d
}

/** Sends an event to every active webhook of the owner subscribed to it. */
export async function dispatchEvent(deps: WebhookDeps, ev: DerivedEvent): Promise<ServerWebhookDelivery[]> {
  const hooks = (await deps.repo.find<Webhook>('webhook', { owner: ev.ownerId })).map((r) => r.data)
  const targets = hooks.filter((h) => h.active && h.url && (h.events ?? []).includes(ev.event) && (!ev.notAfter || h.createdAt <= ev.notAfter))
  const at = (deps.now?.() ?? new Date()).toISOString()
  return await Promise.all(
    targets.map((hook) =>
      attemptDelivery(
        deps,
        hook,
        { id: 'whd_' + uid(16), ownerId: ev.ownerId, webhookId: hook.id, url: hook.url, event: ev.event, status: 'retrying', attempts: 0, at, payload: ev.data },
        true,
      ),
    ),
  )
}

/** Retries deliveries whose backoff has elapsed. Called by cron. */
export async function retryDueDeliveries(deps: WebhookDeps): Promise<{ retried: number; dead: number }> {
  const now = (deps.now?.() ?? new Date()).getTime()
  const due = (await deps.repo.find<ServerWebhookDelivery>('webhook_delivery', { eq: { 'data->>status': 'retrying' } }))
    .map((r: Rec<ServerWebhookDelivery>) => r.data)
    .filter((d) => !d.nextAttemptAt || Date.parse(d.nextAttemptAt) <= now)
  let retried = 0
  let dead = 0
  for (const d of due) {
    const hook = await deps.repo.get<Webhook>('webhook', d.webhookId, d.ownerId)
    if (!hook || !hook.data.active) {
      const rec = await deps.repo.get<ServerWebhookDelivery>('webhook_delivery', d.id, d.ownerId)
      if (rec) await deps.repo.update(rec, { ...d, status: 'failed', lastError: 'webhook removed or inactive', deadAt: new Date(now).toISOString() })
      dead++
      continue
    }
    const out = await attemptDelivery(deps, hook.data, d, false)
    retried++
    if (out.status === 'failed') dead++
  }
  return { retried, dead }
}

/**
 * Claims booking events in booking.webhooksSent so the browser sync and the server never both
 * send the same event. Returns the events this caller won.
 */
export async function claimBookingEvents(repo: Repo, ownerId: string, bookingId: string, events: WebhookEvent[]): Promise<WebhookEvent[]> {
  let won: WebhookEvent[] = []
  await mutate<Booking>(repo, 'booking', bookingId, ownerId, (b) => {
    const sent = new Set(b.webhooksSent ?? [])
    won = events.filter((e) => !sent.has(e))
    return won.length ? { ...b, webhooksSent: [...sent, ...won] } : null
  })
  return won
}
