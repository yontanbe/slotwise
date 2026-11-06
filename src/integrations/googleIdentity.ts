/**
 * Sign in with Google without a server: one consent gives identity (openid, email, profile)
 * plus calendar access, so a visitor lands in their own account with their calendar connected.
 * Used in demo mode (accounts live in the browser). With Supabase, Supabase OAuth is used instead.
 */
import { getConfig } from '../lib/config'

const TK = 'slotwise:gtoken'
const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
]

type Gis = {
  accounts: {
    oauth2: {
      initTokenClient: (cfg: {
        client_id: string
        scope: string
        include_granted_scopes?: boolean
        callback: (r: { access_token?: string; expires_in?: number; scope?: string; error?: string }) => void
        error_callback?: (e: { type: string }) => void
      }) => { requestAccessToken: (o?: { prompt?: string }) => void }
    }
  }
}

let loading: Promise<void> | null = null
function loadGis(): Promise<void> {
  const g = (window as unknown as { google?: Gis }).google
  if (g?.accounts?.oauth2) return Promise.resolve()
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      loading = null
      reject(new Error('gis_load_failed'))
    }
    document.head.appendChild(s)
  })
  return loading
}

export interface GoogleProfile {
  sub: string
  email: string
  name: string
  picture?: string
}

export const googleSignInAvailable = () => !!getConfig().googleClientId

export async function signInWithGoogleIdentity(): Promise<GoogleProfile> {
  const clientId = getConfig().googleClientId
  if (!clientId) throw new Error('missing_client_id')
  await loadGis()
  const g = (window as unknown as { google: Gis }).google
  const token = await new Promise<{ access_token: string; expires_in: number; scope: string }>((resolve, reject) => {
    const client = g.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES.join(' '),
      include_granted_scopes: true,
      callback: (r) => (r.access_token ? resolve({ access_token: r.access_token, expires_in: r.expires_in ?? 3600, scope: r.scope ?? SCOPES.join(' ') }) : reject(new Error(r.error || 'no_token'))),
      error_callback: (e) => reject(new Error(e.type)),
    })
    client.requestAccessToken({ prompt: 'select_account' })
  })
  try {
    sessionStorage.setItem(TK, JSON.stringify({ access_token: token.access_token, expires_at: Date.now() + token.expires_in * 1000, scope: token.scope }))
  } catch {
    /* ignore */
  }
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${token.access_token}` } })
  if (!res.ok) throw new Error(`userinfo_${res.status}`)
  const p = (await res.json()) as GoogleProfile
  if (!p.sub || !p.email) throw new Error('userinfo_incomplete')
  return p
}

export interface CalendarEvent {
  id: string
  summary: string
  start: string
  end: string
  calendarId: string
  color?: string
  htmlLink?: string
  allDay: boolean
}

/** The signed-in user's own events, for the week view. Requires calendar.readonly. */
export async function listMyEvents(calendarIds: string[], timeMin: string, timeMax: string): Promise<CalendarEvent[]> {
  let t: { access_token: string; expires_at: number } | null = null
  try {
    t = JSON.parse(sessionStorage.getItem(TK) || 'null')
  } catch {
    t = null
  }
  if (!t || t.expires_at < Date.now()) return []
  const out: CalendarEvent[] = []
  for (const cal of calendarIds.length ? calendarIds : ['primary']) {
    const u = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal)}/events`)
    u.searchParams.set('timeMin', timeMin)
    u.searchParams.set('timeMax', timeMax)
    u.searchParams.set('singleEvents', 'true')
    u.searchParams.set('orderBy', 'startTime')
    u.searchParams.set('maxResults', '250')
    const r = await fetch(u, { headers: { Authorization: `Bearer ${t.access_token}` } })
    if (r.status === 401) {
      sessionStorage.removeItem(TK)
      return out
    }
    if (!r.ok) continue
    const j = (await r.json()) as { items?: { id: string; summary?: string; status?: string; start: { dateTime?: string; date?: string }; end: { dateTime?: string; date?: string }; htmlLink?: string; transparency?: string }[] }
    for (const e of j.items || []) {
      if (e.status === 'cancelled') continue
      const allDay = !e.start.dateTime
      out.push({
        id: e.id,
        summary: e.summary || '(busy)',
        start: new Date(e.start.dateTime || e.start.date + 'T00:00:00').toISOString(),
        end: new Date(e.end.dateTime || e.end.date + 'T00:00:00').toISOString(),
        calendarId: cal,
        htmlLink: e.htmlLink,
        allDay,
      })
    }
  }
  return out
}
