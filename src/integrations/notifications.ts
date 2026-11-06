import { DateTime } from 'luxon'
import { appUrl } from '../lib/links'
import { locationDetail, locationName } from '../lib/locations'
import type { Booking, EventType, Locale, User } from '../lib/types'

export type NoticeKind = 'booked' | 'requested' | 'confirmed' | 'rejected' | 'cancelled' | 'rescheduled'

interface Msg {
  to: string
  subject: string
  body: string
  audience: 'invitee' | 'host'
}

const tr = (loc: Locale) => (he: string, en: string) => (loc === 'he' ? he : en)

function when(b: Booking, tz: string, loc: Locale) {
  const s = DateTime.fromISO(b.start).setZone(tz).setLocale(loc === 'he' ? 'he-IL' : 'en-US')
  const e = DateTime.fromISO(b.end).setZone(tz)
  return `${s.toLocaleString({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, ${s.toFormat('HH:mm')}–${e.toFormat('HH:mm')} (${tz})`
}

export function buildNotices(kind: NoticeKind, b: Booking, host: User, _et: EventType | null): Msg[] {
  const out: Msg[] = []
  const manage = appUrl(`/b/${b.token}`)
  const il = b.attendee.locale || 'he'
  const L = tr(il)
  const H = tr(host.locale)
  const where = `${locationName(b.location.type, L)}${locationDetail(b.location, L, b.google?.meetUrl) ? ' · ' + locationDetail(b.location, L, b.google?.meetUrl) : ''}`
  const lines = (L2: ReturnType<typeof tr>, tz: string, extra: string[] = []) =>
    [`${L2('מה', 'What')}: ${b.title}`, `${L2('מתי', 'When')}: ${when(b, tz, L2 === L ? il : host.locale)}`, `${L2('איפה', 'Where')}: ${where}`, ...extra].join('\n')

  const inviteeSubject: Record<NoticeKind, string> = {
    booked: L(`הפגישה נקבעה: ${b.title} עם ${host.name}`, `Confirmed: ${b.title} with ${host.name}`),
    requested: L(`הבקשה התקבלה: ${b.title}`, `Request received: ${b.title}`),
    confirmed: L(`אושר: ${b.title} עם ${host.name}`, `Approved: ${b.title} with ${host.name}`),
    rejected: L(`הבקשה לא אושרה: ${b.title}`, `Request declined: ${b.title}`),
    cancelled: L(`בוטל: ${b.title}`, `Cancelled: ${b.title}`),
    rescheduled: L(`מועד חדש: ${b.title}`, `Rescheduled: ${b.title}`),
  }
  const inviteeLead: Record<NoticeKind, string> = {
    booked: L(`היי ${b.attendee.name}, הפגישה שלך נקבעה.`, `Hi ${b.attendee.name}, you are booked.`),
    requested: L(`היי ${b.attendee.name}, הבקשה נשלחה ל${host.name} לאישור.`, `Hi ${b.attendee.name}, your request was sent to ${host.name} for approval.`),
    confirmed: L(`היי ${b.attendee.name}, ${host.name} אישר את הפגישה.`, `Hi ${b.attendee.name}, ${host.name} approved the meeting.`),
    rejected: L(`היי ${b.attendee.name}, הבקשה לא אושרה הפעם.`, `Hi ${b.attendee.name}, the request was not approved this time.`),
    cancelled: L(`היי ${b.attendee.name}, הפגישה בוטלה.`, `Hi ${b.attendee.name}, the meeting was cancelled.`),
    rescheduled: L(`היי ${b.attendee.name}, הפגישה עברה למועד חדש.`, `Hi ${b.attendee.name}, the meeting moved to a new time.`),
  }
  const showManage = kind !== 'cancelled' && kind !== 'rejected'
  out.push({
    audience: 'invitee',
    to: b.attendee.email,
    subject: inviteeSubject[kind],
    body: [
      inviteeLead[kind],
      '',
      lines(L, b.attendee.timezone || host.timezone),
      '',
      showManage ? `${L('לשינוי או ביטול', 'Reschedule or cancel')}: ${manage}` : '',
      '',
      'Slotwise',
    ].join('\n'),
  })

  const hostSubject: Record<NoticeKind, string> = {
    booked: H(`פגישה חדשה: ${b.attendee.name} · ${b.title}`, `New booking: ${b.attendee.name} · ${b.title}`),
    requested: H(`ממתין לאישור: ${b.attendee.name} · ${b.title}`, `Needs approval: ${b.attendee.name} · ${b.title}`),
    confirmed: '',
    rejected: '',
    cancelled: H(`ביטול: ${b.attendee.name} · ${b.title}`, `Cancelled: ${b.attendee.name} · ${b.title}`),
    rescheduled: H(`שינוי מועד: ${b.attendee.name} · ${b.title}`, `Rescheduled: ${b.attendee.name} · ${b.title}`),
  }
  if (hostSubject[kind] && b.source !== 'manual') {
    const reason = kind === 'cancelled' ? b.cancelReason : kind === 'rescheduled' ? b.rescheduleReason : ''
    out.push({
      audience: 'host',
      to: host.email,
      subject: hostSubject[kind],
      body: [
        lines(H, host.timezone, [
          `${H('מוזמן', 'Invitee')}: ${b.attendee.name} <${b.attendee.email}>${b.attendee.phone ? ' · ' + b.attendee.phone : ''}`,
          reason ? `${H('סיבה', 'Reason')}: ${reason}` : '',
          b.notes ? `${H('הערות', 'Notes')}: ${b.notes}` : '',
        ]),
        '',
        appUrl('/app/bookings'),
      ]
        .filter((x) => x !== '')
        .join('\n'),
    })
  }
  return out
}

/** Short text for a WhatsApp click-to-chat message. */
export function whatsappText(kind: 'confirm' | 'reminder', b: Booking, host: { name: string; timezone: string }, locale: Locale) {
  const L = tr(locale)
  const s = DateTime.fromISO(b.start).setZone(b.attendee.timezone || host.timezone).setLocale(locale === 'he' ? 'he-IL' : 'en-US')
  const time = `${s.toLocaleString({ weekday: 'long', day: 'numeric', month: 'long' })} ${s.toFormat('HH:mm')}`
  const manage = appUrl(`/b/${b.token}`)
  if (kind === 'confirm') return L(`היי ${b.attendee.name}, נקבעה לנו פגישה (${b.title}) ב${time}. לשינוי או ביטול: ${manage}`, `Hi ${b.attendee.name}, we are booked (${b.title}) on ${time}. Reschedule or cancel: ${manage}`)
  return L(`תזכורת: ${b.title} עם ${host.name} ב${time}. מגיעים? לשינוי: ${manage}`, `Reminder: ${b.title} with ${host.name} on ${time}. Need to change? ${manage}`)
}
