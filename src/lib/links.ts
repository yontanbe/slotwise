import { DateTime } from 'luxon'

const g = (iso: string) => DateTime.fromISO(iso).toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'")

export function googleCalendarLink(p: { title: string; start: string; end: string; details?: string; location?: string }) {
  const u = new URL('https://calendar.google.com/calendar/render')
  u.searchParams.set('action', 'TEMPLATE')
  u.searchParams.set('text', p.title)
  u.searchParams.set('dates', `${g(p.start)}/${g(p.end)}`)
  if (p.details) u.searchParams.set('details', p.details)
  if (p.location) u.searchParams.set('location', p.location)
  return u.toString()
}

export function outlookLink(p: { title: string; start: string; end: string; details?: string; location?: string }) {
  const u = new URL('https://outlook.live.com/calendar/0/deeplink/compose')
  u.searchParams.set('path', '/calendar/action/compose')
  u.searchParams.set('rru', 'addevent')
  u.searchParams.set('subject', p.title)
  u.searchParams.set('startdt', DateTime.fromISO(p.start).toUTC().toISO()!)
  u.searchParams.set('enddt', DateTime.fromISO(p.end).toUTC().toISO()!)
  if (p.details) u.searchParams.set('body', p.details)
  if (p.location) u.searchParams.set('location', p.location)
  return u.toString()
}

/** Normalizes Israeli and international numbers to digits only, E.164 without plus. */
export function normalizePhone(raw: string, defaultCountry = '972'): string {
  let d = (raw || '').replace(/[^\d+]/g, '')
  if (d.startsWith('+')) return d.slice(1)
  if (d.startsWith('00')) return d.slice(2)
  if (d.startsWith('0')) return defaultCountry + d.slice(1)
  return d
}

export function isValidPhone(raw: string): boolean {
  const n = normalizePhone(raw)
  return /^\d{9,15}$/.test(n)
}

export function whatsappLink(phone: string, text: string) {
  const n = normalizePhone(phone)
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`
}

/** Absolute URL to an in-app hash route, works on GitHub Pages subpaths. */
export function appUrl(path: string) {
  const base = window.location.href.split('#')[0]
  return `${base}#${path.startsWith('/') ? path : '/' + path}`
}
