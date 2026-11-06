/**
 * Host-side sync loop. Without a server this runs in the host's browser whenever the
 * dashboard is open (and right after host actions). It:
 *  1. writes pending notifications to the outbox, sends them with Gmail when connected
 *  2. creates / moves / deletes Google Calendar events (with Meet links)
 *  3. pulls Google free/busy into the store so invitees see real availability
 */
import { DateTime } from 'luxon'
import type { Store } from '../data/store'
import { buildIcs } from '../lib/ics'
import { nowISO, uid } from '../lib/id'
import { locationDetail, locationName } from '../lib/locations'
import type { Booking, EventType, User } from '../lib/types'
import { deleteEvent, freeBusy, hasScope, insertEvent, isGoogleConnected, patchEvent, SCOPES, sendGmail } from './google'
import { buildNotices, type NoticeKind } from './notifications'

let running = false

export interface SyncReport {
  notices: number
  emailed: number
  eventsCreated: number
  eventsDeleted: number
  busyBlocks: number | null
  errors: string[]
}

function neededNotice(b: Booking): NoticeKind | null {
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

export async function runSync(store: Store, user: User, opts: { pullBusy?: boolean } = {}): Promise<SyncReport> {
  const report: SyncReport = { notices: 0, emailed: 0, eventsCreated: 0, eventsDeleted: 0, busyBlocks: null, errors: [] }
  if (running) return report
  running = true
  try {
    const [bookings, eventTypes] = await Promise.all([store.listBookings(user.id), store.listEventTypes(user.id)])
    const etById = new Map<string, EventType>(eventTypes.map((e) => [e.id, e]))
    const google = isGoogleConnected()
    const canMail = google && hasScope(SCOPES.gmailSend) && !!user.google?.sendWithGmail
    const cal = user.google?.destinationCalendar || 'primary'
    const now = nowISO()

    for (const b of bookings) {
      let changed = false
      const next: Booking = { ...b, emailsSent: [...(b.emailsSent || [])] }

      // 1. Google Calendar events (demo seed bookings use example.com and are never pushed)
      if (google && !b.attendee.email.endsWith('@example.com')) {
        try {
          const future = b.end > now
          if (b.status === 'accepted' && future && !b.google?.eventId) {
            const r = await insertEvent(cal, {
              summary: `${b.title} · ${b.attendee.name}`,
              description: [b.notes, locationDetail(b.location, (he) => he)].filter(Boolean).join('\n\n'),
              start: b.start,
              end: b.end,
              location: b.location.type === 'in_person' ? b.location.value : undefined,
              attendees: [{ email: b.attendee.email, displayName: b.attendee.name }, ...b.guests.map((g) => ({ email: g }))],
              withMeet: b.location.type === 'meet',
              requestId: b.id,
            })
            next.google = { eventId: r.id, meetUrl: r.hangoutLink, syncedAt: now }
            report.eventsCreated++
            changed = true
          } else if (b.status === 'accepted' && b.google?.eventId && !b.google.syncedAt) {
            await patchEvent(cal, b.google.eventId, { start: b.start, end: b.end })
            next.google = { ...b.google, syncedAt: now }
            changed = true
          } else if ((b.status === 'cancelled' || b.status === 'rejected') && b.google?.eventId) {
            await deleteEvent(cal, b.google.eventId)
            next.google = { ...b.google, eventId: undefined, syncedAt: now }
            report.eventsDeleted++
            changed = true
          }
        } catch (e) {
          report.errors.push(String((e as Error).message || e))
          next.google = { ...(b.google || {}), error: String((e as Error).message || e) }
        }
      }

      // 2. Notifications (after calendar so the Meet link is included)
      const kind = neededNotice(next)
      if (kind) {
        const msgs = buildNotices(kind, next, user, etById.get(b.eventTypeId) ?? null)
        for (const m of msgs) {
          let status: 'logged' | 'sent' | 'failed' = 'logged'
          if (canMail && m.to && !m.to.endsWith('@example.com')) {
            try {
              const ics =
                m.audience === 'invitee' && (kind === 'booked' || kind === 'confirmed' || kind === 'rescheduled')
                  ? buildIcs({
                      uid: next.id,
                      start: next.start,
                      end: next.end,
                      title: `${next.title} · ${user.name}`,
                      location: `${locationName(next.location.type, (he) => he)} ${locationDetail(next.location, (he) => he, next.google?.meetUrl)}`,
                      organizerName: user.name,
                      organizerEmail: user.email,
                    })
                  : undefined
              await sendGmail({ to: m.to, subject: m.subject, text: m.body, ics })
              status = 'sent'
              report.emailed++
            } catch (e) {
              status = 'failed'
              report.errors.push(String((e as Error).message || e))
            }
          }
          await store.addOutbox({ id: uid(), ownerId: user.id, channel: 'email', to: m.to, subject: m.subject, body: m.body, bookingId: b.id, status, via: status === 'logged' ? 'outbox' : 'gmail', at: nowISO() })
          report.notices++
        }
        next.emailsSent!.push(kind)
        changed = true
      }

      if (changed) await store.saveBooking(next)
    }

    // 3. Busy pull
    if (google && opts.pullBusy !== false) {
      try {
        const cals = user.google?.conflictCalendars?.length ? user.google.conflictCalendars : ['primary']
        const from = DateTime.now().startOf('day').toUTC().toISO()!
        const to = DateTime.now().plus({ days: 90 }).toUTC().toISO()!
        const busy = await freeBusy(cals, from, to)
        const fresh = await store.listBookings(user.id)
        const own = new Set(fresh.filter((b) => b.status === 'accepted').map((b) => `${Date.parse(b.start)}-${Date.parse(b.end)}`))
        const blocks = busy
          .filter((x) => !own.has(`${Date.parse(x.start)}-${Date.parse(x.end)}`))
          .map((x) => ({ start: new Date(x.start).toISOString(), end: new Date(x.end).toISOString(), source: 'google' as const }))
        await store.replaceBusy(user.id, blocks)
        await store.saveUser({ ...user, google: { conflictCalendars: [], destinationCalendar: 'primary', sendWithGmail: false, ...user.google, lastSyncAt: nowISO() } })
        report.busyBlocks = blocks.length
      } catch (e) {
        report.errors.push(String((e as Error).message || e))
      }
    }
  } finally {
    running = false
  }
  return report
}
