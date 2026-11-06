/**
 * WhatsApp Cloud API webhook (Meta) + internal send endpoint.
 *   GET  /whatsapp        verification handshake (hub.mode / hub.verify_token / hub.challenge)
 *   POST /whatsapp        inbound messages, signed with X-Hub-Signature-256 (WHATSAPP_APP_SECRET)
 *   POST /whatsapp/send   internal: send a template message (service role key or DB_WEBHOOK_SECRET)
 */
import { mutate, type Repo } from '../_shared/db.ts'
import { authorizedInternal, CORS_HEADERS, errorResponse, json, preflight, stripPrefix } from '../_shared/http.ts'
import { replyWhatsAppText, sendWhatsApp } from '../_shared/messaging.ts'
import type { Booking } from '../_shared/types.ts'
import { appUrl, digitsOnly, env, hmacSha256Hex, samePhone, timingSafeEqual } from '../_shared/util.ts'

export interface WhatsAppDeps {
  repo: () => Repo
  fetch?: typeof fetch
  now?: () => Date
  reply?: (to: string, text: string) => Promise<unknown>
  authorizeInternal?: (req: Request) => boolean
}

export async function verifyMetaSignature(appSecret: string, rawBody: string, header: string | null): Promise<boolean> {
  if (!header?.startsWith('sha256=')) return false
  return timingSafeEqual(header.slice(7), await hmacSha256Hex(appSecret, rawBody))
}

export const ACTION_RE = /^(confirm|cancel|reschedule):([A-Za-z0-9_-]{8,64})$/
export const STOP_RE = /^\s*(stop|unsubscribe|עצור|הסר|הסרה)\s*[.!]?\s*$/i

interface InboundMessage {
  from: string
  id?: string
  type: string
  text?: { body?: string }
  button?: { payload?: string; text?: string }
  interactive?: { button_reply?: { id?: string }; list_reply?: { id?: string } }
}

export function messageText(m: InboundMessage): string {
  return (m.button?.payload ?? m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id ?? m.text?.body ?? m.button?.text ?? '').trim()
}

const T = {
  confirmed: { he: 'תודה! הפגישה אושרה. נתראה 🙂', en: 'Thanks, your meeting is confirmed. See you then!' },
  cancelled: { he: 'הפגישה בוטלה. תודה שעדכנת.', en: 'Your meeting was cancelled. Thanks for letting us know.' },
  reschedule: { he: 'לבחירת מועד חדש: ', en: 'Pick a new time here: ' },
  stale: {
    he: 'הפגישה הזו כבר לא פעילה (בוטלה או עברה), אז לא שינינו דבר. לשאלות אפשר לפנות ישירות למארח.',
    en: 'That meeting is no longer active (cancelled or already past), so nothing was changed. Please contact the host directly if needed.',
  },
  notFound: { he: 'לא מצאנו את הפגישה הזו. אפשר לפנות ישירות למארח.', en: "We couldn't find that meeting. Please contact the host directly." },
  stopped: { he: 'הוסרת מהודעות WhatsApp לפגישות הקרובות. לא נשלח הודעות נוספות.', en: "You're unsubscribed from WhatsApp messages for your upcoming meetings." },
}

export function createWhatsAppHandler(deps: WhatsAppDeps) {
  const reply = deps.reply ?? ((to: string, text: string) => replyWhatsAppText(to, text, deps.fetch))
  const now = () => (deps.now?.() ?? new Date()).getTime()

  async function findByToken(repo: Repo, token: string) {
    return (await repo.find<Booking>('booking', { eq: { 'data->>token': token }, limit: 1 }))[0] ?? null
  }

  async function handleAction(repo: Repo, from: string, action: string, token: string): Promise<string> {
    const rec = await findByToken(repo, token)
    // only the attendee's own number may act on the booking
    if (!rec || !samePhone(from, rec.data.attendee?.phone ?? '')) return 'not_found'
    const b = rec.data
    const loc = b.attendee.locale === 'en' ? 'en' : 'he'
    const stale = !['accepted', 'pending'].includes(b.status) || Date.parse(b.end) < now()
    if (stale) {
      await reply(from, T.stale[loc])
      return 'stale'
    }
    if (action === 'reschedule') {
      await reply(from, T.reschedule[loc] + `${appUrl()}#/b/${b.token}?action=reschedule`)
      return 'reschedule_link'
    }
    if (action === 'confirm') {
      // public_reconfirm sets reconfirmedAt + history; it returns null for pending/past bookings
      const out = await repo.rpc<Booking | null>('public_reconfirm', { p_token: token })
      await reply(from, out ? T.confirmed[loc] : T.stale[loc])
      return out ? 'confirmed' : 'stale'
    }
    // cancel: same rules as the invitee cancel page
    const out = await repo.rpc<Booking | null>('public_cancel_booking', { p_token: token, p_reason: 'Cancelled via WhatsApp' })
    await reply(from, out ? T.cancelled[loc] : T.stale[loc])
    return out ? 'cancelled' : 'stale'
  }

  async function handleStop(repo: Repo, from: string): Promise<number> {
    const last9 = digitsOnly(from).slice(-9)
    if (last9.length < 7) return 0
    // tolerate separators in stored numbers: 0%5%0%1%2...
    const pattern = '%' + last9.split('').join('%') + '%'
    const rows = await repo.find<Booking>('booking', { ilike: { 'data->attendee->>phone': pattern }, in: { 'data->>status': ['accepted', 'pending'] } })
    let n = 0
    for (const r of rows) {
      const b = r.data
      if (!samePhone(from, b.attendee?.phone ?? '') || Date.parse(b.end) < now() || b.attendee.whatsappOptIn === false) continue
      const out = await mutate<Booking>(repo, 'booking', r.id, r.owner_id, (x) => ({
        ...x,
        attendee: { ...x.attendee, whatsappOptIn: false },
        history: [...(x.history ?? []), { at: new Date(now()).toISOString(), action: 'whatsapp_opt_out', by: 'invitee' }],
      }))
      if (out) n++
    }
    const loc = rows.find((r) => samePhone(from, r.data.attendee?.phone ?? ''))?.data.attendee.locale === 'en' ? 'en' : 'he'
    await reply(from, T.stopped[loc])
    return n
  }

  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return preflight()
    const url = new URL(req.url)
    const path = stripPrefix(url.pathname, 'whatsapp')

    if (path === '/send') {
      if (req.method !== 'POST') return errorResponse('method_not_allowed', 'POST only')
      if (!(deps.authorizeInternal ?? authorizedInternal)(req)) return errorResponse('unauthorized', 'internal endpoint')
      const b = await req.json().catch(() => null)
      if (!b?.ownerId || !b?.to || !b?.body) return errorResponse('invalid_request', 'ownerId, to and body are required')
      const res = await sendWhatsApp({ repo: deps.repo(), fetch: deps.fetch }, {
        ownerId: String(b.ownerId),
        to: String(b.to),
        body: String(b.body),
        bookingId: b.bookingId,
        bookingToken: b.bookingToken,
        locale: b.locale === 'en' ? 'en' : 'he',
        template: b.template,
      })
      return json(res, res.status === 'failed' ? 502 : 200)
    }
    if (path !== '/') return errorResponse('not_found', 'unknown path')

    if (req.method === 'GET') {
      const s = url.searchParams
      const expected = env('WHATSAPP_VERIFY_TOKEN')
      if (s.get('hub.mode') === 'subscribe' && expected && timingSafeEqual(s.get('hub.verify_token') ?? '', expected)) {
        return new Response(s.get('hub.challenge') ?? '', { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' } })
      }
      return new Response('Forbidden', { status: 403, headers: CORS_HEADERS })
    }
    if (req.method !== 'POST') return errorResponse('method_not_allowed', 'GET or POST')

    const raw = await req.text()
    const secret = env('WHATSAPP_APP_SECRET')
    if (!secret || !(await verifyMetaSignature(secret, raw, req.headers.get('x-hub-signature-256')))) {
      return errorResponse('unauthorized', 'bad signature')
    }
    let body: { entry?: { changes?: { value?: { messages?: InboundMessage[] } }[] }[] }
    try {
      body = JSON.parse(raw)
    } catch {
      return errorResponse('invalid_request', 'invalid JSON')
    }
    const repo = deps.repo()
    const results: { from: string; result: string }[] = []
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const m of change.value?.messages ?? []) {
          try {
            const text = messageText(m)
            const act = ACTION_RE.exec(text)
            if (act) results.push({ from: m.from, result: await handleAction(repo, m.from, act[1], act[2]) })
            else if (STOP_RE.test(text)) results.push({ from: m.from, result: `opted_out:${await handleStop(repo, m.from)}` })
            else results.push({ from: m.from, result: 'ignored' })
          } catch (e) {
            console.error('whatsapp inbound', e)
            results.push({ from: m.from, result: 'error' })
          }
        }
      }
    }
    // always 200 after a valid signature so Meta does not retry processed messages
    return json({ ok: true, results })
  }
}
