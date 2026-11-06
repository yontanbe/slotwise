import { DateTime } from 'luxon'

export interface IcsEvent {
  uid: string
  start: string
  end: string
  title: string
  description?: string
  location?: string
  organizerName?: string
  organizerEmail?: string
  attendees?: { name: string; email: string }[]
  status?: 'CONFIRMED' | 'CANCELLED' | 'TENTATIVE'
  sequence?: number
}

const fmt = (iso: string) => DateTime.fromISO(iso).toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'")
const esc = (s = '') => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\;')

function fold(line: string): string {
  // RFC 5545: lines over 75 octets are folded. Use char count as a safe approximation.
  const out: string[] = []
  let rest = line
  while (rest.length > 70) {
    out.push(rest.slice(0, 70))
    rest = ' ' + rest.slice(70)
  }
  out.push(rest)
  return out.join('\r\n')
}

export function buildIcs(ev: IcsEvent, method: 'PUBLISH' | 'REQUEST' | 'CANCEL' = 'PUBLISH'): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Slotwise//Booking//HE',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${ev.uid}@slotwise`,
    `DTSTAMP:${fmt(new Date().toISOString())}`,
    `DTSTART:${fmt(ev.start)}`,
    `DTEND:${fmt(ev.end)}`,
    `SUMMARY:${esc(ev.title)}`,
    ev.description ? `DESCRIPTION:${esc(ev.description)}` : '',
    ev.location ? `LOCATION:${esc(ev.location)}` : '',
    ev.organizerEmail ? `ORGANIZER;CN=${esc(ev.organizerName)}:mailto:${ev.organizerEmail}` : '',
    ...(ev.attendees || []).map((a) => `ATTENDEE;CN=${esc(a.name)};RSVP=TRUE:mailto:${a.email}`),
    `STATUS:${ev.status || 'CONFIRMED'}`,
    `SEQUENCE:${ev.sequence ?? 0}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean)
  return lines.map(fold).join('\r\n')
}

export function downloadIcs(ev: IcsEvent, filename = 'invite.ics') {
  const blob = new Blob([buildIcs(ev)], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
