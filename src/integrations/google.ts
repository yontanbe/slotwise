/**
 * Google Calendar + Gmail from the browser with Google Identity Services (token model).
 * No server needed. Tokens live in sessionStorage and expire after ~1 hour; reconnect is one click.
 * Setup: create an OAuth Client ID (Web) in Google Cloud, add the Pages origin to
 * "Authorized JavaScript origins", enable Calendar API and Gmail API.
 */
import { getConfig } from '../lib/config'

export const SCOPES = {
  calendarRead: 'https://www.googleapis.com/auth/calendar.readonly',
  events: 'https://www.googleapis.com/auth/calendar.events',
  gmailSend: 'https://www.googleapis.com/auth/gmail.send',
  email: 'email',
}

interface TokenState {
  access_token: string
  expires_at: number
  scope: string
}

const TK = 'slotwise:gtoken'

type TokenClient = { requestAccessToken: (o?: { prompt?: string }) => void }
interface GoogleGlobal {
  accounts: {
    oauth2: {
      initTokenClient: (cfg: {
        client_id: string
        scope: string
        include_granted_scopes?: boolean
        callback: (r: { access_token?: string; expires_in?: number; scope?: string; error?: string }) => void
        error_callback?: (e: { type: string }) => void
      }) => TokenClient
      revoke: (token: string, cb?: () => void) => void
    }
  }
}
declare global {
  interface Window {
    google?: GoogleGlobal
  }
}

let gisLoading: Promise<void> | null = null
function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  if (gisLoading) return gisLoading
  gisLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Failed to load Google Identity Services'))
    document.head.appendChild(s)
  })
  return gisLoading
}

export function getToken(): TokenState | null {
  try {
    const t = JSON.parse(sessionStorage.getItem(TK) || 'null') as TokenState | null
    if (t && t.expires_at > Date.now() + 30_000) return t
  } catch {
    /* ignore */
  }
  return null
}

export const isGoogleConfigured = () => !!getConfig().googleClientId
export const isGoogleConnected = () => !!getToken()
export const hasScope = (s: string) => !!getToken()?.scope.split(' ').includes(s)

export async function connectGoogle(withGmail: boolean): Promise<TokenState> {
  const clientId = getConfig().googleClientId
  if (!clientId) throw new Error('missing_client_id')
  await loadGis()
  const scope = [SCOPES.calendarRead, SCOPES.events, SCOPES.email, ...(withGmail ? [SCOPES.gmailSend] : [])].join(' ')
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope,
      include_granted_scopes: true,
      callback: (r) => {
        if (r.error || !r.access_token) return reject(new Error(r.error || 'no_token'))
        const t: TokenState = { access_token: r.access_token, expires_at: Date.now() + (r.expires_in ?? 3600) * 1000, scope: r.scope ?? scope }
        try {
          sessionStorage.setItem(TK, JSON.stringify(t))
          notifyGoogle()
        } catch {
          /* ignore */
        }
        resolve(t)
      },
      error_callback: (e) => reject(new Error(e.type)),
    })
    client.requestAccessToken({ prompt: '' })
  })
}

export function disconnectGoogle() {
  const t = getToken()
  sessionStorage.removeItem(TK)
  notifyGoogle()
  if (!t) return
  // revoke at Google too; after a reload GIS is not loaded yet, so load it first
  if (window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(t.access_token)
  else if (isGoogleConfigured()) loadGis().then(() => window.google?.accounts.oauth2.revoke(t.access_token)).catch(() => {})
}

async function gfetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const t = getToken()
  if (!t) throw new Error('not_connected')
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${t.access_token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  if (res.status === 401) {
    sessionStorage.removeItem(TK)
    notifyGoogle()
    throw new Error('expired')
  }
  if (res.status === 204) return undefined as T
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error?.message || `google_${res.status}`)
  return body as T
}

export interface GCalendar {
  id: string
  summary: string
  primary?: boolean
  backgroundColor?: string
  accessRole: string
}

export async function listCalendars(): Promise<GCalendar[]> {
  const r = await gfetch<{ items: GCalendar[] }>('https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=freeBusyReader')
  return r.items || []
}

export async function getUserEmail(): Promise<string> {
  const r = await gfetch<{ email: string }>('https://www.googleapis.com/oauth2/v3/userinfo')
  return r.email
}

export async function freeBusy(calendarIds: string[], timeMin: string, timeMax: string) {
  const r = await gfetch<{ calendars: Record<string, { busy: { start: string; end: string }[]; errors?: unknown[] }> }>(
    'https://www.googleapis.com/calendar/v3/freeBusy',
    { method: 'POST', body: JSON.stringify({ timeMin, timeMax, items: calendarIds.map((id) => ({ id })) }) },
  )
  return Object.values(r.calendars).flatMap((c) => c.busy || [])
}

export interface GEventInput {
  /** deterministic id so retries and parallel tabs cannot create duplicates */
  id?: string
  summary: string
  description: string
  start: string
  end: string
  location?: string
  attendees: { email: string; displayName?: string }[]
  withMeet: boolean
  requestId: string
}

export async function insertEvent(calendarId: string, ev: GEventInput) {
  const body: Record<string, unknown> = {
    summary: ev.summary,
    description: ev.description,
    start: { dateTime: ev.start },
    end: { dateTime: ev.end },
    location: ev.location,
    attendees: ev.attendees,
    reminders: { useDefault: true },
  }
  if (ev.withMeet) body.conferenceData = { createRequest: { requestId: ev.requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } } }
  if (ev.id) body.id = ev.id
  try {
    return await gfetch<{ id: string; hangoutLink?: string; htmlLink: string }>(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1&sendUpdates=all`,
      { method: 'POST', body: JSON.stringify(body) },
    )
  } catch (e) {
    // 409: another tab or a previous run already created it
    if (ev.id && /already exists|duplicate|409/i.test(String((e as Error).message))) {
      return gfetch<{ id: string; hangoutLink?: string; htmlLink: string }>(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${ev.id}`,
      )
    }
    throw e
  }
}

/** Google event ids must be base32hex (a-v, 0-9). Hex encoding of our id satisfies that. */
export function googleEventId(bookingId: string) {
  return 'slot' + Array.from(bookingId, (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
}

export const SINGLE_EMAIL = /^[^\s@,;<>"()[\]\\]+@[^\s@,;<>"()[\]\\]+\.[A-Za-z]{2,}$/

export async function patchEvent(calendarId: string, eventId: string, patch: { start: string; end: string }) {
  return gfetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}?sendUpdates=all`, {
    method: 'PATCH',
    body: JSON.stringify({ start: { dateTime: patch.start }, end: { dateTime: patch.end } }),
  })
}

export async function deleteEvent(calendarId: string, eventId: string) {
  try {
    await gfetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}?sendUpdates=all`, { method: 'DELETE' })
  } catch (e) {
    if (!String(e).includes('410') && !String(e).includes('deleted')) throw e
  }
}

function b64(s: string) {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin)
}
const b64url = (s: string) => b64(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
/** MIME body part as base64 in 76 char lines (the text is UTF-8, so 7bit would be wrong). */
const b64Body = (s: string) => (b64(s).match(/.{1,76}/g) || ['']).join('\r\n')
/** RFC 2047: encoded words of at most 75 chars, split on code points, folded with CRLF + space. */
function encWord(s: string) {
  const words: string[] = []
  let chunk = ''
  for (const ch of s) {
    if (chunk && new TextEncoder().encode(chunk + ch).length > 45) {
      words.push(chunk)
      chunk = ''
    }
    chunk += ch
  }
  if (chunk) words.push(chunk)
  return words.map((w) => `=?UTF-8?B?${b64(w)}?=`).join('\r\n ')
}

export async function sendGmail(p: { to: string; subject: string; text: string; fromName?: string; ics?: string }) {
  const to = p.to.trim()
  if (!SINGLE_EMAIL.test(to) || to.length > 254) throw new Error('invalid_recipient')
  p = { ...p, to, subject: p.subject.replace(/[\r\n]+/g, ' ').slice(0, 300) }
  const boundary = 'sw' + Math.random().toString(36).slice(2)
  const headers = [`To: ${p.to}`, `Subject: ${encWord(p.subject)}`, 'MIME-Version: 1.0']
  let raw: string
  if (p.ics) {
    raw = [
      ...headers,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      b64Body(p.text),
      `--${boundary}`,
      'Content-Type: text/calendar; charset="UTF-8"; method=PUBLISH; name="invite.ics"',
      'Content-Disposition: attachment; filename="invite.ics"',
      'Content-Transfer-Encoding: base64',
      '',
      b64Body(p.ics),
      `--${boundary}--`,
    ].join('\r\n')
  } else {
    raw = [...headers, 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', b64Body(p.text)].join('\r\n')
  }
  return gfetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', body: JSON.stringify({ raw: b64url(raw) }) })
}

/**
 * Invitee calendar overlay (SavvyCal style): read only free/busy of the invitee's own primary
 * calendar. The token lives in memory only and nothing is stored or sent to the host.
 */
let inviteeToken: { access_token: string; expires_at: number } | null = null
export async function getInviteeBusy(timeMin: string, timeMax: string): Promise<{ start: string; end: string }[]> {
  const clientId = getConfig().googleClientId
  if (!clientId) throw new Error('missing_client_id')
  if (!inviteeToken || inviteeToken.expires_at < Date.now() + 30_000) {
    await loadGis()
    inviteeToken = await new Promise((resolve, reject) => {
      const client = window.google!.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES.calendarRead,
        callback: (r) => (r.access_token ? resolve({ access_token: r.access_token, expires_at: Date.now() + (r.expires_in ?? 3600) * 1000 }) : reject(new Error(r.error || 'no_token'))),
        error_callback: (e) => reject(new Error(e.type)),
      })
      client.requestAccessToken({ prompt: '' })
    })
  }
  const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: { Authorization: `Bearer ${inviteeToken!.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeMin, timeMax, items: [{ id: 'primary' }] }),
  })
  if (res.status === 401) inviteeToken = null // revoked or expired early: ask again next time
  if (!res.ok) throw new Error(`google_${res.status}`)
  const j = (await res.json()) as { calendars: Record<string, { busy: { start: string; end: string }[] }> }
  return Object.values(j.calendars).flatMap((c) => c.busy || []).map((b) => ({ start: new Date(b.start).toISOString(), end: new Date(b.end).toISOString() }))
}

/** Fired whenever the Google token appears or disappears, so screens can update their state. */
export const GOOGLE_EVENT = 'slotwise:google'
export function notifyGoogle() {
  try {
    window.dispatchEvent(new Event(GOOGLE_EVENT))
  } catch {
    /* non-browser */
  }
}
