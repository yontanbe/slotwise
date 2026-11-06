import { assert, assertEquals } from '@std/assert'
import { createApiHandler, normalizeApiPath } from '../api/router.ts'
import { ServiceError } from '../_shared/http.ts'
import { SlidingWindowLimiter } from '../_shared/ratelimit.ts'
import { fakeService, GOOD_KEY } from './fakes.ts'

function setup(overrides = {}, limiter?: SlidingWindowLimiter) {
  const service = fakeService(overrides)
  const handler = createApiHandler({ service, limiter })
  const req = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await handler(
      new Request('https://ref.supabase.co' + path, {
        method,
        headers: { authorization: `Bearer ${GOOD_KEY}`, 'content-type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    )
    const text = await res.text()
    return { res, json: text ? JSON.parse(text) : null }
  }
  return { service, handler, req }
}

Deno.test('path prefix handling', () => {
  for (const p of ['/functions/v1/api/v1/bookings', '/api/v1/bookings', '/v1/bookings', '/api/v1/bookings/', '/bookings']) {
    assertEquals(normalizeApiPath(p), '/bookings', p)
  }
  assertEquals(normalizeApiPath('/functions/v1/api/v1/bookings/b1/cancel'), '/bookings/b1/cancel')
  assertEquals(normalizeApiPath('/api'), '/')
})

Deno.test('routes work under every prefix', async () => {
  const { req, service } = setup()
  for (const p of ['/functions/v1/api/v1/me', '/api/v1/me', '/v1/me']) {
    const { res, json } = await req('GET', p)
    assertEquals(res.status, 200, p)
    assertEquals(json.data.name, 'Host')
    assertEquals(res.headers.get('access-control-allow-origin'), '*')
  }
  assertEquals(service.calls.filter((c) => c.method === 'me').length, 3)
})

Deno.test('401 without or with a bad key', async () => {
  const { req, handler } = setup()
  const bad = await req('GET', '/api/v1/bookings', undefined, { authorization: 'Bearer sw_nope' })
  assertEquals(bad.res.status, 401)
  assertEquals(bad.json.error.code, 'unauthorized')
  const none = await handler(new Request('https://x/api/v1/me'))
  assertEquals(none.status, 401)
  assert(none.headers.get('www-authenticate'))
})

Deno.test('404 for unknown routes, 405 for wrong methods', async () => {
  const { req } = setup()
  const nf = await req('GET', '/api/v1/nothing-here')
  assertEquals(nf.res.status, 404)
  assertEquals(nf.json.error.code, 'not_found')
  const wrong = await req('DELETE', '/api/v1/bookings')
  assertEquals(wrong.res.status, 405)
  assert(wrong.res.headers.get('allow')?.includes('GET'))
})

Deno.test('service errors map to status codes with {error:{code,message}}', async () => {
  const { req } = setup({ getBooking: () => Promise.reject(new ServiceError('not_found', 'nope')) })
  const r = await req('GET', '/api/v1/bookings/zz')
  assertEquals(r.res.status, 404)
  assertEquals(r.json, { error: { code: 'not_found', message: 'nope' } })
})

Deno.test('query params, body and idempotency key reach the service', async () => {
  const { req, service } = setup()
  await req('GET', '/api/v1/availability?eventTypeId=et1&from=2030-01-01&to=2030-01-07&timezone=Asia/Jerusalem&duration=30')
  assertEquals(service.calls.at(-1)!.args[1], { eventTypeId: 'et1', from: '2030-01-01', to: '2030-01-07', timezone: 'Asia/Jerusalem', duration: 30 })
  await req('GET', '/api/v1/bookings?status=accepted&q=dana')
  assertEquals((service.calls.at(-1)!.args[1] as { status: string; q: string }).q, 'dana')
  const created = await req('POST', '/api/v1/bookings', { eventTypeId: 'et1', start: '2030-01-01T09:00:00Z', attendee: { name: 'D', email: 'd@x.io' } }, { 'idempotency-key': 'k-1' })
  assertEquals(created.res.status, 201)
  assertEquals(service.calls.at(-1)!.args[2], 'k-1')
  await req('POST', '/api/v1/bookings/b1/cancel', { confirm: true, reason: 'x' })
  assertEquals(service.calls.at(-1)!.args.slice(1), ['b1', { reason: 'x', confirm: true }])
  const bad = await req('POST', '/api/v1/links', undefined, {})
  assertEquals(bad.res.status, 201) // empty body is passed as {} and validated by the service
})

Deno.test('invalid JSON body is a 400', async () => {
  const { handler } = setup()
  const res = await handler(new Request('https://x/api/v1/polls', { method: 'POST', headers: { authorization: `Bearer ${GOOD_KEY}` }, body: '{' }))
  assertEquals(res.status, 400)
})

Deno.test('rate limit returns 429 with Retry-After', async () => {
  let t = 0
  const { req } = setup({}, new SlidingWindowLimiter(2, 60_000, () => t))
  assertEquals((await req('GET', '/api/v1/me')).res.status, 200)
  assertEquals((await req('GET', '/api/v1/me')).res.headers.get('x-ratelimit-remaining'), '0')
  const limited = await req('GET', '/api/v1/me')
  assertEquals(limited.res.status, 429)
  assertEquals(limited.res.headers.get('retry-after'), '60')
  t = 60_001
  assertEquals((await req('GET', '/api/v1/me')).res.status, 200)
})

Deno.test('openapi.json is public and lists every route', async () => {
  const { handler } = setup()
  const res = await handler(new Request('https://ref.supabase.co/functions/v1/api/v1/openapi.json'))
  assertEquals(res.status, 200)
  const doc = await res.json()
  assertEquals(doc.openapi, '3.1.0')
  assertEquals(doc.servers[0].url, 'https://ref.supabase.co/functions/v1/api/v1')
  for (const p of ['/me', '/event-types', '/availability', '/availability/overrides', '/bookings', '/bookings/{id}', '/bookings/{id}/cancel', '/bookings/{id}/reschedule', '/links', '/polls', '/insights', '/openapi.json']) {
    assert(doc.paths[p], p)
  }
})
