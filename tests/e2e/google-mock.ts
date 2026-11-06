/**
 * In-test fake of the Google surfaces Slotwise talks to from the browser:
 *  - Google Identity Services token client (https://accounts.google.com/gsi/client)
 *  - Calendar v3 (calendarList, freeBusy, events insert / get / patch / delete)
 *  - OAuth2 userinfo
 *  - Gmail v1 users.messages.send (raw MIME is decoded so tests can assert on it)
 *
 * Everything is installed on the BrowserContext, so a second tab sees the same fake Google.
 */
import type { BrowserContext, Page, Route } from '@playwright/test'

export const HOST_GOOGLE_EMAIL = 'yonatan.host@gmail.com'
export const PRIMARY_ID = HOST_GOOGLE_EMAIL
export const TEAM_CAL_ID = 'team-cal@group.calendar.google.com'
export const HOLIDAYS_CAL_ID = 'he.jewish#holiday@group.v.calendar.google.com'
export const CLIENT_ID = 'test.apps.googleusercontent.com'

export const SCOPE = {
  calendarRead: 'https://www.googleapis.com/auth/calendar.readonly',
  events: 'https://www.googleapis.com/auth/calendar.events',
  gmailSend: 'https://www.googleapis.com/auth/gmail.send',
  email: 'email',
}
export const HOST_SCOPES = [SCOPE.calendarRead, SCOPE.events, SCOPE.email, SCOPE.gmailSend].join(' ')

export interface Interval {
  start: string
  end: string
}

export interface ApiRequest {
  method: string
  host: string
  path: string
  query: URLSearchParams
  auth: string | null
  body: unknown
  status: number
}

export interface GEvent {
  id: string
  calendarId: string
  status: 'confirmed' | 'cancelled'
  summary: string
  description?: string
  location?: string
  start: { dateTime: string }
  end: { dateTime: string }
  attendees: { email: string; displayName?: string }[]
  conferenceData?: unknown
  hangoutLink?: string
  htmlLink: string
  insertQuery: string
}

export interface MimePart {
  headers: Record<string, string>
  body: string
}

export interface SentMail {
  raw: string
  /** the decoded MIME message, exactly as Gmail would receive it */
  mime: string
  headers: Record<string, string>
  /** every header line, to catch duplicates (two To lines, injected Bcc) */
  headerLines: string[]
  to: string
  subject: string
  parts: MimePart[]
  text: string
  ics?: string
}

export interface GisCall {
  client_id: string
  scope: string
  prompt?: string
  include_granted_scopes?: boolean
}

export class GoogleMock {
  /** every googleapis request (OPTIONS preflights excluded) */
  requests: ApiRequest[] = []
  events = new Map<string, GEvent>()
  sent: SentMail[] = []
  gisCalls: GisCall[] = []
  revoked: string[] = []
  /** tokens the fake API accepts */
  validTokens = new Set<string>()
  /** token handed out by the next requestAccessToken() */
  nextToken = 'tok'
  /** scopes the fake consent screen grants; default: everything requested */
  grant: (requested: string) => string = (r) => r
  /** static busy blocks per calendar id (in addition to the events stored in this fake) */
  busy: Record<string, Interval[]> = {}
  /** busy blocks returned to the invitee overlay token */
  inviteeBusy: Interval[] = []
  /** artificial latency on freeBusy, to widen race windows */
  freeBusyDelayMs = 0
  private seq = 0

  constructor(readonly context: BrowserContext) {}

  calendarId(id: string) {
    return id === 'primary' ? PRIMARY_ID : id
  }

  api(filter: { method?: string; path?: RegExp | string } = {}) {
    return this.requests.filter(
      (r) => (!filter.method || r.method === filter.method) && (!filter.path || (typeof filter.path === 'string' ? r.path === filter.path : filter.path.test(r.path))),
    )
  }
  inserts() {
    return this.api({ method: 'POST', path: /\/calendar\/v3\/calendars\/[^/]+\/events$/ })
  }
  liveEvents() {
    return [...this.events.values()].filter((e) => e.status === 'confirmed')
  }

  async install() {
    const ctx = this.context
    await ctx.addInitScript(
      ({ clientId }) => {
        try {
          localStorage.setItem('slotwise:config', JSON.stringify({ googleClientId: clientId }))
        } catch {
          /* about:blank */
        }
      },
      { clientId: CLIENT_ID },
    )
    await ctx.exposeFunction('__gisRequest', (call: GisCall) => {
      this.gisCalls.push(call)
      // the invitee overlay asks for calendar.readonly only; give it its own token so the fake can tell them apart
      const token = call.scope === SCOPE.calendarRead ? 'tok-invitee' : this.nextToken
      if (call.scope === SCOPE.calendarRead) this.inviteeToken = token
      this.validTokens.add(token)
      return { access_token: token, expires_in: 3600, scope: this.grant(call.scope), token_type: 'Bearer' }
    })
    await ctx.exposeFunction('__gisRevoke', (token: string) => {
      this.revoked.push(token)
      this.validTokens.delete(token)
    })
    await ctx.route('https://accounts.google.com/gsi/client*', (route) =>
      route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: FAKE_GIS }),
    )
    await ctx.route(/^https:\/\/(www|gmail)\.googleapis\.com\//, (route) => this.handle(route))
    await ctx.route(/^https:\/\/oauth2\.googleapis\.com\//, (route) => this.handle(route))
  }

  /** Puts a host token into sessionStorage of every new tab (once per tab, so later removals stick). */
  async seedHostToken(token = 'tok', scope = HOST_SCOPES) {
    this.validTokens.add(token)
    await this.context.addInitScript(
      ({ token, scope }) => {
        try {
          if (sessionStorage.getItem('test:gtoken-seeded')) return
          sessionStorage.setItem('test:gtoken-seeded', '1')
          sessionStorage.setItem('slotwise:gtoken', JSON.stringify({ access_token: token, expires_at: Date.now() + 3600e3, scope }))
        } catch {
          /* about:blank */
        }
      },
      { token, scope },
    )
  }

  private async handle(route: Route) {
    const req = route.request()
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const url = new URL(req.url())
    let body: unknown = undefined
    const raw = req.postData()
    if (raw) {
      try {
        body = JSON.parse(raw)
      } catch {
        body = raw
      }
    }
    const auth = req.headers()['authorization'] ?? null
    const rec: ApiRequest = { method: req.method(), host: url.host, path: decodeURIComponent(url.pathname), query: url.searchParams, auth, body, status: 0 }
    this.requests.push(rec)
    const reply = async (status: number, json?: unknown) => {
      rec.status = status
      if (status === 204) return route.fulfill({ status, headers: cors })
      return route.fulfill({ status, headers: cors, contentType: 'application/json; charset=UTF-8', body: JSON.stringify(json ?? {}) })
    }
    const gerr = (code: number, message: string, reason: string) => reply(code, { error: { code, message, errors: [{ domain: 'global', reason, message }] } })

    if (url.host === 'oauth2.googleapis.com' && url.pathname === '/revoke') {
      const t = url.searchParams.get('token') || ''
      this.revoked.push(t)
      this.validTokens.delete(t)
      return reply(200, {})
    }

    const token = auth?.replace(/^Bearer /, '') ?? ''
    if (!this.validTokens.has(token)) return gerr(401, 'Request had invalid authentication credentials.', 'authError')

    const p = rec.path
    const m = req.method()

    if (m === 'GET' && p === '/oauth2/v3/userinfo') return reply(200, { sub: '1001', email: HOST_GOOGLE_EMAIL, email_verified: true })

    if (m === 'GET' && p === '/calendar/v3/users/me/calendarList')
      return reply(200, {
        kind: 'calendar#calendarList',
        items: [
          { kind: 'calendar#calendarListEntry', id: PRIMARY_ID, summary: 'Yonatan', primary: true, accessRole: 'owner', backgroundColor: '#9fe1e7' },
          { kind: 'calendar#calendarListEntry', id: TEAM_CAL_ID, summary: 'Team', accessRole: 'writer', backgroundColor: '#f83a22' },
          { kind: 'calendar#calendarListEntry', id: HOLIDAYS_CAL_ID, summary: 'Holidays', accessRole: 'freeBusyReader', backgroundColor: '#16a765' },
        ],
      })

    if (m === 'POST' && p === '/calendar/v3/freeBusy') {
      if (this.freeBusyDelayMs) await new Promise((r) => setTimeout(r, this.freeBusyDelayMs))
      const b = body as { timeMin: string; timeMax: string; items: { id: string }[] }
      const calendars: Record<string, { busy: Interval[] }> = {}
      const inside = (x: Interval) => x.end > b.timeMin && x.start < b.timeMax
      for (const { id } of b.items) {
        const cid = this.calendarId(id)
        if (this.inviteeToken && token === this.inviteeToken) {
          calendars[id] = { busy: this.inviteeBusy.filter(inside) }
          continue
        }
        const fromEvents = this.liveEvents()
          .filter((e) => e.calendarId === cid)
          .map((e) => ({ start: e.start.dateTime, end: e.end.dateTime }))
        calendars[id] = { busy: [...(this.busy[cid] || []), ...(this.busy[id] || []), ...fromEvents].filter(inside).sort((x, y) => x.start.localeCompare(y.start)) }
      }
      return reply(200, { kind: 'calendar#freeBusy', timeMin: b.timeMin, timeMax: b.timeMax, calendars })
    }

    const evList = p.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events$/)
    if (evList && m === 'POST') {
      const cid = this.calendarId(evList[1])
      const b = body as Partial<GEvent> & { id?: string; conferenceData?: { createRequest?: { requestId: string } } }
      if (b.id && this.events.has(b.id)) return gerr(409, 'The requested identifier already exists.', 'duplicate')
      if (b.id && !/^[a-v0-9]{5,1024}$/.test(b.id)) return gerr(400, 'Invalid resource id value.', 'invalid')
      const id = b.id || 'gen' + ++this.seq
      const withMeet = !!b.conferenceData?.createRequest && url.searchParams.get('conferenceDataVersion') === '1'
      const hangoutLink = withMeet ? `https://meet.google.com/${id.slice(-3)}-mock-${(++this.seq).toString().padStart(3, '0')}` : undefined
      const ev: GEvent = {
        id,
        calendarId: cid,
        status: 'confirmed',
        summary: b.summary || '',
        description: b.description,
        location: b.location,
        start: b.start!,
        end: b.end!,
        attendees: b.attendees || [],
        conferenceData: withMeet ? { createRequest: b.conferenceData!.createRequest, entryPoints: [{ entryPointType: 'video', uri: hangoutLink }] } : undefined,
        hangoutLink,
        htmlLink: `https://www.google.com/calendar/event?eid=${id}`,
        insertQuery: url.search,
      }
      this.events.set(id, ev)
      return reply(200, { kind: 'calendar#event', ...ev, calendarId: undefined, insertQuery: undefined })
    }

    const evOne = p.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events\/([^/]+)$/)
    if (evOne) {
      const cid = this.calendarId(evOne[1])
      const ev = this.events.get(evOne[2])
      if (!ev || ev.calendarId !== cid) return gerr(404, 'Not Found', 'notFound')
      if (m === 'GET') return reply(200, { kind: 'calendar#event', ...ev, calendarId: undefined, insertQuery: undefined })
      if (ev.status === 'cancelled') return gerr(410, 'Resource has been deleted', 'deleted')
      if (m === 'PATCH') {
        Object.assign(ev, body as object)
        return reply(200, { kind: 'calendar#event', ...ev, calendarId: undefined, insertQuery: undefined })
      }
      if (m === 'DELETE') {
        ev.status = 'cancelled'
        return reply(204)
      }
    }

    if (m === 'POST' && p === '/gmail/v1/users/me/messages/send') {
      const rawMsg = (body as { raw: string }).raw
      if (!rawMsg || /[+/=]/.test(rawMsg)) return gerr(400, "Invalid value for ByteString: raw", 'invalidArgument')
      const mail = parseMime(rawMsg)
      this.sent.push(mail)
      return reply(200, { id: 'msg' + ++this.seq, threadId: 'thr' + this.seq, labelIds: ['SENT'] })
    }

    return gerr(404, `fake google: no handler for ${m} ${p}`, 'notFound')
  }

  /** token the invitee overlay received (scope = calendar.readonly only) */
  inviteeToken = ''
}

/** Splits CRLF header block, unfolds continuation lines. */
function parseHeaders(block: string) {
  const lines: string[] = []
  for (const l of block.split('\r\n')) {
    if (/^[ \t]/.test(l) && lines.length) lines[lines.length - 1] += l
    else lines.push(l)
  }
  const headers: Record<string, string> = {}
  for (const l of lines) {
    const i = l.indexOf(':')
    if (i > 0) headers[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim()
  }
  return { headers, lines }
}

export function decodeRfc2047(v: string) {
  return v
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?UTF-8\?B\?([^?]*)\?=/gi, (_, b64: string) => Buffer.from(b64, 'base64').toString('utf8'))
    .replace(/=\?UTF-8\?Q\?([^?]*)\?=/gi, (_, q: string) => Buffer.from(q.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_m, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8'))
}

function decodeBody(part: MimePart) {
  const cte = (part.headers['content-transfer-encoding'] || '7bit').toLowerCase()
  if (cte === 'base64') return Buffer.from(part.body.replace(/\s+/g, ''), 'base64').toString('utf8')
  return part.body
}

export function parseMime(raw: string): SentMail {
  const mime = Buffer.from(raw, 'base64url').toString('utf8')
  const split = mime.indexOf('\r\n\r\n')
  const { headers, lines } = parseHeaders(mime.slice(0, split))
  const rest = mime.slice(split + 4)
  const parts: MimePart[] = []
  const boundary = /boundary="?([^";]+)"?/.exec(headers['content-type'] || '')?.[1]
  if (boundary) {
    const chunks = rest.split('--' + boundary)
    for (const c of chunks.slice(1)) {
      if (c.startsWith('--')) break
      const body = c.replace(/^\r\n/, '').replace(/\r\n$/, '')
      const i = body.indexOf('\r\n\r\n')
      parts.push({ headers: parseHeaders(body.slice(0, i)).headers, body: body.slice(i + 4) })
    }
  } else parts.push({ headers, body: rest })
  const decoded = parts.map((p) => ({ ...p, body: decodeBody(p) }))
  const text = decoded.find((p) => /text\/plain/i.test(p.headers['content-type'] || 'text/plain'))?.body ?? ''
  const ics = decoded.find((p) => /text\/calendar/i.test(p.headers['content-type'] || ''))?.body
  return { raw, mime, headers, headerLines: lines, to: headers['to'], subject: decodeRfc2047(headers['subject'] || ''), parts: decoded, text, ics }
}

/** Minimal stand-in for https://accounts.google.com/gsi/client (token model only). */
const FAKE_GIS = `
(function () {
  window.google = window.google || {};
  window.google.accounts = {
    oauth2: {
      initTokenClient: function (cfg) {
        return {
          requestAccessToken: function (o) {
            window.__gisRequest({ client_id: cfg.client_id, scope: cfg.scope, prompt: o && o.prompt, include_granted_scopes: !!cfg.include_granted_scopes })
              .then(function (r) { cfg.callback(r); });
          }
        };
      },
      revoke: function (token, cb) {
        window.__gisRevoke(token).then(function () { cb && cb({ successful: true }); });
      }
    }
  };
})();
`

export async function installGoogle(page: Page) {
  const mock = new GoogleMock(page.context())
  await mock.install()
  return mock
}
