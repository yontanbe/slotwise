/** REST API v1 over the service layer. Pure request -> response, dependencies injected. */
import { bearer, errorResponse, fromError, json, preflight, ServiceError, stripPrefix } from '../_shared/http.ts'
import { SlidingWindowLimiter } from '../_shared/ratelimit.ts'
import type { Caller, SlotwiseService } from '../_shared/service.ts'
import { openapiDocument } from './openapi.ts'

export interface ApiDeps {
  service: SlotwiseService
  limiter?: SlidingWindowLimiter
  serverUrl?: string
}

/** '/functions/v1/api/v1/x', '/api/v1/x', '/v1/x' and '/x' all become '/x'. */
export function normalizeApiPath(pathname: string): string {
  let p = stripPrefix(pathname, 'api')
  if (p === '/v1') return '/'
  if (p.startsWith('/v1/')) p = p.slice(3)
  return p
}

async function body<T>(req: Request): Promise<T> {
  const text = await req.text()
  if (!text.trim()) return {} as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new ServiceError('invalid_request', 'body must be valid JSON')
  }
}

type Handler = (c: Caller, req: Request, params: string[], url: URL) => Promise<Response>

export function createApiHandler(deps: ApiDeps): (req: Request) => Promise<Response> {
  const { service } = deps
  const limiter = deps.limiter ?? new SlidingWindowLimiter(120, 60_000)

  const routes: { method: string; re: RegExp; h: Handler }[] = [
    { method: 'GET', re: /^\/me$/, h: async (c) => json({ data: await service.me(c) }) },
    {
      method: 'GET',
      re: /^\/event-types$/,
      h: async (c, _r, _p, url) => json({ data: await service.listEventTypes(c, { includeHidden: url.searchParams.get('includeHidden') !== 'false' }) }),
    },
    { method: 'GET', re: /^\/event-types\/([^/]+)$/, h: async (c, _r, [id]) => json({ data: await service.getEventType(c, id) }) },
    {
      method: 'GET',
      re: /^\/availability$/,
      h: async (c, _r, _p, url) => {
        const s = url.searchParams
        const duration = s.get('duration')
        return json({
          data: await service.getAvailability(c, {
            eventTypeId: s.get('eventTypeId') ?? '',
            from: s.get('from') ?? undefined,
            to: s.get('to') ?? undefined,
            timezone: s.get('timezone') ?? undefined,
            duration: duration ? Number(duration) : undefined,
          }),
        })
      },
    },
    {
      method: 'POST',
      re: /^\/availability\/overrides$/,
      h: async (c, req) => json({ data: await service.updateAvailability(c, await body(req)) }),
    },
    {
      method: 'GET',
      re: /^\/bookings$/,
      h: async (c, _r, _p, url) => {
        const s = url.searchParams
        const out = await service.listBookings(c, {
          status: s.get('status') ?? undefined,
          from: s.get('from') ?? undefined,
          to: s.get('to') ?? undefined,
          q: s.get('q') ?? undefined,
          eventTypeId: s.get('eventTypeId') ?? undefined,
          limit: s.get('limit') ? Number(s.get('limit')) : undefined,
          offset: s.get('offset') ? Number(s.get('offset')) : undefined,
        })
        return json({ data: out.bookings, total: out.total, limit: out.limit, offset: out.offset })
      },
    },
    {
      method: 'POST',
      re: /^\/bookings$/,
      h: async (c, req) => {
        const input = await body<Record<string, unknown>>(req)
        const key = req.headers.get('idempotency-key') ?? (typeof input.idempotencyKey === 'string' ? input.idempotencyKey : undefined)
        delete input.idempotencyKey
        // deno-lint-ignore no-explicit-any
        const out = await service.createBooking(c, input as any, key ?? undefined)
        return json({ data: out.booking }, out.replayed ? 200 : 201, out.replayed ? { 'Idempotent-Replayed': 'true' } : {})
      },
    },
    { method: 'GET', re: /^\/bookings\/([^/]+)$/, h: async (c, _r, [id]) => json({ data: await service.getBooking(c, id) }) },
    {
      method: 'POST',
      re: /^\/bookings\/([^/]+)\/cancel$/,
      h: async (c, req, [id]) => {
        const b = await body<{ reason?: string; confirm?: boolean }>(req)
        return json({ data: await service.cancelBooking(c, id, { reason: b.reason, confirm: b.confirm }) })
      },
    },
    {
      method: 'POST',
      re: /^\/bookings\/([^/]+)\/reschedule$/,
      h: async (c, req, [id]) => {
        const b = await body<{ start: string; reason?: string }>(req)
        return json({ data: await service.rescheduleBooking(c, id, b) })
      },
    },
    {
      method: 'POST',
      re: /^\/bookings\/([^/]+)\/reminders$/,
      h: async (c, req, [id]) => {
        const b = await body<{ channel: 'email' | 'whatsapp'; message?: string }>(req)
        return json({ data: await service.sendReminder(c, { ...b, bookingId: id }) })
      },
    },
    { method: 'POST', re: /^\/links$/, h: async (c, req) => json({ data: await service.createLink(c, await body(req)) }, 201) },
    { method: 'POST', re: /^\/polls$/, h: async (c, req) => json({ data: await service.createPoll(c, await body(req)) }, 201) },
    {
      method: 'GET',
      re: /^\/insights$/,
      h: async (c, _r, _p, url) =>
        json({ data: await service.getInsights(c, { from: url.searchParams.get('from') ?? undefined, to: url.searchParams.get('to') ?? undefined }) }),
    },
  ]

  return async (req: Request) => {
    if (req.method === 'OPTIONS') return preflight()
    const url = new URL(req.url)
    const path = normalizeApiPath(url.pathname)
    try {
      if (req.method === 'GET' && (path === '/openapi.json' || path === '/')) {
        const base = deps.serverUrl ?? `${url.origin}${url.pathname.slice(0, url.pathname.length - (path === '/' ? 0 : path.length)).replace(/\/+$/, '')}`
        return json(openapiDocument(base.endsWith('/v1') ? base : base + '/v1'))
      }
      const matches = routes.filter((r) => r.re.test(path))
      if (!matches.length) return errorResponse('not_found', `no route for ${req.method} ${path}`)
      const route = matches.find((r) => r.method === req.method)
      if (!route) return errorResponse('method_not_allowed', `${req.method} not allowed on ${path}`, { Allow: matches.map((m) => m.method).join(', ') })

      const auth = await service.authenticate(bearer(req))
      if (!auth) {
        return errorResponse('unauthorized', 'missing or invalid API key (Authorization: Bearer sw_...)', { 'WWW-Authenticate': 'Bearer realm="slotwise"' })
      }
      const rl = limiter.check(auth.apiKeyId)
      const rlHeaders = { 'X-RateLimit-Limit': String(limiter.limit), 'X-RateLimit-Remaining': String(rl.remaining) }
      if (!rl.ok) return errorResponse('rate_limited', 'too many requests', { ...rlHeaders, 'Retry-After': String(rl.retryAfterSec) })
      const caller: Caller = { ...auth, actor: 'api', client: (req.headers.get('x-slotwise-client') || req.headers.get('user-agent') || 'unknown').slice(0, 120) }
      const params = route.re.exec(path)!.slice(1).map(decodeURIComponent)
      const res = await route.h(caller, req, params, url)
      for (const [k, v] of Object.entries(rlHeaders)) res.headers.set(k, v)
      return res
    } catch (e) {
      return fromError(e)
    }
  }
}
