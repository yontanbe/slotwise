/**
 * Host-side sync loop. Without a server this runs in the host's browser whenever the
 * dashboard is open (and right after host actions). It:
 *  1. creates / moves / deletes Google Calendar events (with Meet links)
 *  2. sends notifications (Gmail when connected, otherwise the outbox log)
 *  3. runs workflows and webhooks (unless the user moved automation to the server)
 *  4. auto-declines stale pending requests
 *  5. publishes busy blocks: Google free/busy, Shabbat / holidays, out of office
 *
 * Safety: one tab at a time (Web Locks), side effects are claimed on a fresh copy of the
 * booking before they run, and every write re-reads the booking and patches only the fields
 * this loop owns, so a concurrent cancel or confirm is never overwritten.
 */
import { DateTime } from 'luxon'
import { bookingVars, dueSteps, renderTemplate, stepRecipient, type WfBooking, type WfHost } from '../../supabase/functions/_shared/workflows'
import type { Store } from '../data/store'
import { shabbatBlocks } from '../lib/holidays'
import { buildIcs } from '../lib/ics'
import { nowISO, uid } from '../lib/id'
import { appUrl } from '../lib/links'
import { locationDetail, locationName } from '../lib/locations'
import type { Booking, BusyBlock, EventType, OutboxMessage, User, Webhook, WebhookEvent, Workflow } from '../lib/types'
import { deleteEvent, freeBusy, googleEventId, hasScope, insertEvent, isGoogleConnected, patchEvent, SCOPES, sendGmail } from './google'
import { buildNotices, type NoticeKind } from './notifications'

let running = false

export interface SyncReport {
  notices: number
  emailed: number
  eventsCreated: number
  eventsDeleted: number
  workflowSteps: number
  webhooks: number
  autoDeclined: number
  busyBlocks: number | null
  errors: string[]
}

export function neededNotice(b: Booking): NoticeKind | null {
  const sent = b.emailsSent || []
  if (b.status === 'pending' && !sent.includes('requested') && !sent.includes('booked')) return 'requested'
  if (b.status === 'accepted') {
    if (sent.includes('booked') || sent.includes('confirmed') || sent.includes('rescheduled')) return null
    if (b.rescheduledFromId) return 'rescheduled'
    return sent.includes('requested') ? 'confirmed' : 'booked'
  }
  if (b.status === 'rejected' && !sent.includes('rejected') && sent.includes('requested')) return 'rejected'
  if (b.status === 'cancelled' && !sent.includes('cancelled') && !b.rescheduledToId && sent.length > 0) return 'cancelled'
  return null
}

/** Webhook events a booking has reached and not yet delivered. */
export function pendingWebhookEvents(b: Booking): WebhookEvent[] {
  const sent = new Set(b.webhooksSent || [])
  const out: WebhookEvent[] = []
  const add = (e: WebhookEvent) => !sent.has(e) && out.push(e)
  const active = b.status === 'accepted' || b.status === 'pending'
  if (active && !b.rescheduledFromId) add('booking.created')
  if (active && b.rescheduledFromId) add('booking.rescheduled')
  if (b.history.some((h) => h.action === 'confirmed')) add('booking.confirmed')
  if (b.status === 'rejected') add('booking.rejected')
  if (b.status === 'cancelled' && !b.rescheduledToId) add('booking.cancelled')
  if (b.payment?.status === 'paid') add('booking.paid')
  return out
}

/** Removes the host's own bookings from merged free/busy intervals. */
export function subtractIntervals(busy: { start: string; end: string }[], own: { start: string; end: string }[]) {
  const out: { start: number; end: number }[] = []
  const holes = own.map((o) => [Date.parse(o.start), Date.parse(o.end)] as const).sort((a, b) => a[0] - b[0])
  for (const b of busy) {
    let pieces = [{ start: Date.parse(b.start), end: Date.parse(b.end) }]
    for (const [hs, he] of holes) {
      pieces = pieces.flatMap((p) => {
        if (he <= p.start || hs >= p.end) return [p]
        const r: { start: number; end: number }[] = []
        if (hs > p.start) r.push({ start: p.start, end: hs })
        if (he < p.end) r.push({ start: he, end: p.end })
        return r
      })
    }
    out.push(...pieces.filter((p) => p.end - p.start >= 60000))
  }
  return out.map((p) => ({ start: new Date(p.start).toISOString(), end: new Date(p.end).toISOString() }))
}

async function hmacHex(secret: string, msg: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg))
  return Array.from(new Uint8Array(sig), (x) => x.toString(16).padStart(2, '0')).join('')
}

/**
 * Browser delivery. A signed request with custom headers needs the receiver to allow CORS;
 * when it does not, we fall back to an opaque no-cors POST whose body carries the signature.
 */
export async function deliverWebhook(url: string, secret: string, event: string, payload: unknown): Promise<{ status: 'ok' | 'failed' | 'sent_opaque'; code?: number }> {
  if (!/^https:\/\//.test(url)) return { status: 'failed' }
  const body = JSON.stringify({ event, createdAt: nowISO(), payload })
  const t = Math.floor(Date.now() / 1000)
  const sig = `t=${t},v1=${await hmacHex(secret, `${t}.${body}`)}`
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Slotwise-Event': event, 'X-Slotwise-Signature': sig }, body })
    return { status: r.ok ? 'ok' : 'failed', code: r.status }
  } catch {
    try {
      await fetch(url, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ signature: sig, body }) })
      return { status: 'sent_opaque' }
    } catch {
      return { status: 'failed' }
    }
  }
}

function webhookPayload(b: Booking) {
  const { internalNotes: _n, token: _t, ...rest } = b
  void _n
  void _t
  return rest
}

export async function runSync(store: Store, user: User, opts: { pullBusy?: boolean } = {}): Promise<SyncReport> {
  const empty: SyncReport = { notices: 0, emailed: 0, eventsCreated: 0, eventsDeleted: 0, workflowSteps: 0, webhooks: 0, autoDeclined: 0, busyBlocks: null, errors: [] }
  if (running) return empty
  running = true
  try {
    const locks = (navigator as Navigator & { locks?: { request: (n: string, o: { ifAvailable: boolean }, cb: (l: unknown) => Promise<SyncReport>) => Promise<SyncReport> } }).locks
    if (locks) return await locks.request('slotwise-sync-' + user.id, { ifAvailable: true }, async (lock) => (lock ? syncOnce(store, user, opts) : empty))
    return await syncOnce(store, user, opts)
  } finally {
    running = false
  }
}

async function syncOnce(store: Store, user: User, opts: { pullBusy?: boolean }): Promise<SyncReport> {
  const report: SyncReport = { notices: 0, emailed: 0, eventsCreated: 0, eventsDeleted: 0, workflowSteps: 0, webhooks: 0, autoDeclined: 0, busyBlocks: null, errors: [] }
  const err = (e: unknown) => report.errors.push(String((e as Error)?.message || e))
  const [bookings, eventTypes, workflows, webhooks] = await Promise.all([
    store.listBookings(user.id),
    store.listEventTypes(user.id),
    store.listKind('workflow', user.id).catch(() => [] as Workflow[]),
    store.listKind('webhook', user.id).catch(() => [] as Webhook[]),
  ])
  const etById = new Map<string, EventType>(eventTypes.map((e) => [e.id, e]))
  const google = isGoogleConnected()
  const canMail = google && hasScope(SCOPES.gmailSend) && !!user.google?.sendWithGmail
  const cal = user.google?.destinationCalendar || 'primary'
  const automation = !user.automationOnServer
  const host: WfHost = { name: user.name, email: user.email, phone: user.phone, timezone: user.timezone, locale: user.locale }
  const base = appUrl('/').split('#')[0]

  /** Re-reads the booking and applies a patch to the fresh copy. Returns the saved booking. */
  const patch = async (id: string, fn: (b: Booking) => Partial<Booking> | null): Promise<Booking | null> => {
    const fresh = await store.getBooking(id)
    if (!fresh) return null
    const p = fn(fresh)
    if (!p) return fresh
    const next = { ...fresh, ...p }
    await store.saveBooking(next)
    return next
  }
  const outbox = (m: Omit<OutboxMessage, 'id' | 'ownerId' | 'at'>) => store.addOutbox({ id: uid(), ownerId: user.id, at: nowISO(), ...m })
  const sendMail = async (to: string, subject: string, body: string, bookingId?: string, ics?: string) => {
    let status: OutboxMessage['status'] = 'logged'
    if (canMail && to && !to.endsWith('@example.com')) {
      try {
        await sendGmail({ to, subject, text: body, ics })
        status = 'sent'
        report.emailed++
      } catch (e) {
        status = 'failed'
        err(e)
      }
    }
    await outbox({ channel: 'email', to, subject, body, bookingId, status, via: status === 'logged' ? 'outbox' : 'gmail' })
  }

  // only bookings that can still need work: recent or upcoming
  const horizon = Date.now() - 14 * 864e5
  for (const b0 of bookings.filter((b) => Date.parse(b.end) > horizon || Date.parse(b.createdAt) > horizon)) {
    if (b0.ownerId !== user.id) continue // co-host copies are handled by the owner
    const et = etById.get(b0.eventTypeId) ?? null
    let b: Booking | null = b0

    // 0. auto decline stale requests
    if (b.status === 'pending' && et?.autoDeclineHours && Date.now() - Date.parse(b.createdAt) > et.autoDeclineHours * 3600e3) {
      b = await patch(b.id, (f) => (f.status === 'pending' ? { status: 'rejected', history: [...f.history, { at: nowISO(), action: 'rejected', by: 'system', note: 'auto' }] } : null))
      report.autoDeclined++
      if (!b) continue
    }

    // 1. Google Calendar (demo seed bookings use example.com and are never pushed)
    if (google && !b.attendee.email.endsWith('@example.com')) {
      try {
        const future = b.end > nowISO()
        if (b.status === 'accepted' && future && !b.google?.eventId) {
          const r = await insertEvent(cal, {
            id: googleEventId(b.id),
            summary: `${b.title} · ${b.attendee.name}`,
            description: [b.notes, locationDetail(b.location, (he) => he), `${appUrl('/app/bookings')}`].filter(Boolean).join('\n\n'),
            start: b.start,
            end: b.end,
            location: b.location.type === 'in_person' ? b.location.value : undefined,
            attendees: [{ email: b.attendee.email, displayName: b.attendee.name }, ...b.guests.map((g) => ({ email: g }))],
            withMeet: b.location.type === 'meet',
            requestId: b.id,
          })
          b = await patch(b.id, () => ({ google: { eventId: r.id, meetUrl: r.hangoutLink, syncedAt: nowISO(), calendarId: cal } }))
          report.eventsCreated++
        } else if (b.status === 'accepted' && b.google?.eventId && !b.google.syncedAt) {
          await patchEvent(b.google.calendarId || cal, b.google.eventId, { start: b.start, end: b.end })
          b = await patch(b.id, (f) => ({ google: { ...f.google, syncedAt: nowISO() } }))
        } else if ((b.status === 'cancelled' || b.status === 'rejected') && b.google?.eventId) {
          await deleteEvent(b.google.calendarId || cal, b.google.eventId)
          b = await patch(b.id, (f) => ({ google: { ...f.google, eventId: undefined, syncedAt: nowISO() } }))
          report.eventsDeleted++
        }
      } catch (e) {
        err(e)
        b = await patch(b0.id, (f) => ({ google: { ...(f.google || {}), error: String((e as Error).message || e) } }))
      }
      if (!b) continue
    }

    // 2. Notifications: claim first, then send, so a second tab or a crash cannot double send
    const kind = neededNotice(b)
    if (kind) {
      const claimed = await patch(b.id, (f) => (neededNotice(f) === kind ? { emailsSent: [...(f.emailsSent || []), kind] } : null))
      if (claimed && (claimed.emailsSent || []).includes(kind)) {
        b = claimed
        for (const m of buildNotices(kind, b, user, et)) {
          const ics =
            m.audience === 'invitee' && (kind === 'booked' || kind === 'confirmed' || kind === 'rescheduled')
              ? buildIcs({
                  uid: b.id,
                  start: b.start,
                  end: b.end,
                  title: `${b.title} · ${user.name}`,
                  location: `${locationName(b.location.type, (he) => he)} ${locationDetail(b.location, (he) => he, b.google?.meetUrl)}`,
                  organizerName: user.name,
                  organizerEmail: user.email,
                })
              : undefined
          await sendMail(m.to, m.subject, m.body, b.id, ics)
          report.notices++
        }
      }
    }

    if (!automation) continue

    // 3. Workflows
    const due = dueSteps(b as unknown as WfBooking, workflows, nowISO())
    if (due.length) {
      const keys = due.map((d) => d.key)
      const claimed = await patch(b.id, (f) => {
        const done = new Set(f.workflowDone || [])
        const fresh = keys.filter((k) => !done.has(k))
        return fresh.length ? { workflowDone: [...done, ...fresh] } : null
      })
      if (claimed) {
        const doneBefore = new Set(b.workflowDone || [])
        b = claimed
        for (const d of due) {
          if (doneBefore.has(d.key)) continue
          const forHost = d.step.action === 'email_host' || d.step.action === 'whatsapp_host'
          const vars = bookingVars(b as unknown as WfBooking, host, base, forHost)
          const to = stepRecipient(d.step, b as unknown as WfBooking, host)
          const subject = renderTemplate(d.step.subject || d.workflow.name, vars)
          const body = renderTemplate(d.step.body, vars)
          try {
            if (d.step.action.startsWith('email_')) await sendMail(to, subject, body, b.id)
            else if (d.step.action === 'webhook') {
              const r = await deliverWebhook(to, '', 'workflow.step', { workflow: d.workflow.name, booking: webhookPayload(b), message: body })
              if (r.status === 'failed') err('workflow webhook failed: ' + to)
            } else {
              // WhatsApp / SMS: the static app cannot send by itself; the host taps "send" in the outbox
              const optedOut = d.step.action !== 'whatsapp_host' && b.attendee.whatsappOptIn === false
              if (to && !optedOut) await outbox({ channel: 'whatsapp', to, subject, body, bookingId: b.id, status: 'logged', via: 'outbox' })
            }
            report.workflowSteps++
          } catch (e) {
            err(e)
          }
        }
      }
    }

    // 4. Webhooks
    const evs = pendingWebhookEvents(b).filter((e) => webhooks.some((w) => w.active && w.events.includes(e) && w.createdAt <= b!.createdAt))
    const allPending = pendingWebhookEvents(b)
    if (allPending.length) {
      const claimed = await patch(b.id, (f) => {
        const sent = new Set(f.webhooksSent || [])
        const fresh = allPending.filter((e) => !sent.has(e))
        return fresh.length ? { webhooksSent: [...sent, ...fresh] } : null
      })
      if (claimed) {
        b = claimed
        for (const ev of evs) {
          for (const w of webhooks.filter((x) => x.active && x.events.includes(ev) && x.createdAt <= b!.createdAt)) {
            const r = await deliverWebhook(w.url, w.secret, ev, webhookPayload(b))
            if (store.mode === 'local') await store.saveKind('webhook_delivery', { id: uid(), ownerId: user.id, webhookId: w.id, event: ev, status: r.status, code: r.code, attempts: 1, at: nowISO(), payload: { bookingId: b.id } })
            report.webhooks++
          }
        }
      }
    }
  }

  // 5. Busy blocks: Google + Shabbat / holidays + out of office (the server's booking RPC checks these)
  if (opts.pullBusy !== false) {
    try {
      const from = DateTime.now().startOf('day').toUTC().toISO()!
      const to = DateTime.now().plus({ days: 120 }).toUTC().toISO()!
      let blocks: BusyBlock[] = []
      if (google) {
        const cals = user.google?.conflictCalendars?.length ? user.google.conflictCalendars : ['primary']
        const busy = await freeBusy(cals, from, DateTime.now().plus({ days: 90 }).toUTC().toISO()!)
        const fresh = await store.listBookings(user.id)
        const own = fresh.filter((b) => b.status === 'accepted' || b.status === 'pending')
        blocks = subtractIntervals(busy, own).map((x) => ({ ...x, source: 'google' as const }))
      } else {
        // token expired (about an hour) or disconnected: keep the last known Google busy times
        // instead of wiping them, otherwise invitees could book over the host's Google events
        const prev = await store.getPublicBusy(user.id, from, to).catch(() => ({ busy: [] as BusyBlock[] }))
        blocks = prev.busy.filter((x) => x.source === 'google')
      }
      const holy: BusyBlock[] = shabbatBlocks(user.shabbat, from, to).map((x) => ({ start: x.start, end: x.end, source: 'shabbat' }))
      const ooo: BusyBlock[] = (user.outOfOffice || []).map((o) => ({
        start: DateTime.fromISO(o.start, { zone: user.timezone }).startOf('day').toUTC().toISO()!,
        end: DateTime.fromISO(o.end, { zone: user.timezone }).plus({ days: 1 }).startOf('day').toUTC().toISO()!,
        source: 'ooo',
      }))
      const all = [...blocks, ...holy, ...ooo]
      await store.replaceBusy(user.id, all)
      if (google) {
        // re-read: the host may have changed settings while this run was waiting on Google
        const cur = (await store.getUser(user.id)) ?? user
        await store.saveUser({ ...cur, google: { conflictCalendars: [], destinationCalendar: 'primary', sendWithGmail: false, ...cur.google, lastSyncAt: nowISO() } })
      }
      report.busyBlocks = all.length
    } catch (e) {
      err(e)
    }
  }
  return report
}
