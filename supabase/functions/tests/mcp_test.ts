import { assert, assertEquals, assertExists } from '@std/assert'
import { ServiceError } from '../_shared/http.ts'
import { createMcpHandler, PROTOCOL_VERSION, RPC, TOOLS, validate } from '../mcp/server.ts'
import { fakeService, GOOD_KEY } from './fakes.ts'

const EXPECTED_TOOLS = [
  'list_event_types',
  'get_event_type',
  'get_availability',
  'create_booking',
  'reschedule_booking',
  'cancel_booking',
  'list_bookings',
  'get_booking',
  'create_single_use_link',
  'create_poll',
  'update_availability',
  'get_insights',
  'send_reminder',
]

function setup(overrides = {}) {
  const service = fakeService(overrides)
  const handler = createMcpHandler({ service })
  const post = async (body: unknown, headers: Record<string, string> = {}) => {
    const res = await handler(
      new Request('http://localhost/functions/v1/mcp', {
        method: 'POST',
        headers: { authorization: `Bearer ${GOOD_KEY}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    )
    const text = await res.text()
    return { res, json: text ? JSON.parse(text) : null }
  }
  const call = (name: string, args: Record<string, unknown>, headers: Record<string, string> = {}) =>
    post({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } }, headers)
  return { service, handler, post, call }
}

Deno.test('initialize negotiates 2025-06-18 and returns a session id', async () => {
  const { post } = setup()
  const { res, json } = await post({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-ai', version: '1.0' } },
  })
  assertEquals(res.status, 200)
  assertEquals(json.id, 1)
  assertEquals(json.result.protocolVersion, PROTOCOL_VERSION)
  assertExists(json.result.capabilities.tools)
  assertExists(json.result.capabilities.resources)
  assertExists(json.result.capabilities.prompts)
  assertEquals(json.result.serverInfo.name, 'slotwise')
  assert(res.headers.get('mcp-session-id'))
  // unknown versions fall back to ours
  const old = await post({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01', clientInfo: { name: 'x' } } })
  assertEquals(old.json.result.protocolVersion, PROTOCOL_VERSION)
})

Deno.test('notifications/initialized gets 202 with no body, ping works', async () => {
  const { post } = setup()
  const n = await post({ jsonrpc: '2.0', method: 'notifications/initialized' })
  assertEquals(n.res.status, 202)
  assertEquals(n.json, null)
  const p = await post({ jsonrpc: '2.0', id: 'p', method: 'ping' })
  assertEquals(p.json, { jsonrpc: '2.0', id: 'p', result: {} })
})

Deno.test('tools/list exposes exactly the 13 tools with object input schemas', async () => {
  const { post } = setup()
  const { json } = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
  const tools = json.result.tools as { name: string; description: string; inputSchema: { type: string; properties: object; required?: string[] } }[]
  assertEquals(tools.map((t) => t.name).sort(), [...EXPECTED_TOOLS].sort())
  for (const t of tools) {
    assertEquals(t.inputSchema.type, 'object', t.name)
    assert(t.description.length > 10, t.name)
    assertExists(t.inputSchema.properties)
  }
  const cancel = tools.find((t) => t.name === 'cancel_booking')!
  assert(cancel.inputSchema.required!.includes('confirm'))
  const create = tools.find((t) => t.name === 'create_booking')!
  assert(create.inputSchema.required!.includes('idempotency_key'))
})

Deno.test('tools/call routes to the service with the MCP client name for audit', async () => {
  const { post, call, service } = setup()
  const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: PROTOCOL_VERSION, clientInfo: { name: 'claude-ai', version: '2' } } })
  const sid = init.res.headers.get('mcp-session-id')!
  const { json } = await call('get_availability', { event_type_id: 'et1', from: '2030-01-01', timezone: 'Asia/Jerusalem' }, { 'mcp-session-id': sid })
  assertEquals(json.result.isError, undefined)
  assertEquals(json.result.content[0].type, 'text')
  assertEquals(json.result.structuredContent.eventTypeId, 'et1')
  const c = service.calls.find((x) => x.method === 'getAvailability')!
  const [caller, input] = c.args as [{ actor: string; client: string }, Record<string, unknown>]
  assertEquals(caller.actor, 'mcp')
  assertEquals(caller.client, 'claude-ai/2')
  assertEquals(input, { eventTypeId: 'et1', from: '2030-01-01', to: undefined, timezone: 'Asia/Jerusalem', duration: undefined })

  // the client name survives a cold isolate: it is encoded in the session id
  const fresh = setup()
  await fresh.call('list_event_types', {}, { 'mcp-session-id': sid })
  assertEquals((fresh.service.calls[0].args[0] as { client: string }).client, 'claude-ai/2')
})

Deno.test('create_booking needs an idempotency_key and passes it through', async () => {
  const { call, service } = setup()
  const args = { event_type_id: 'et1', start: '2030-01-01T09:00:00Z', attendee: { name: 'Dana', email: 'dana@example.com' } }
  const missing = await call('create_booking', args)
  assertEquals(missing.json.result.isError, true)
  assert(missing.json.result.content[0].text.includes('idempotency_key'))
  assertEquals(service.calls.length, 0)
  const ok = await call('create_booking', { ...args, idempotency_key: 'abc-12345' })
  assertEquals(ok.json.result.isError, undefined)
  assertEquals(service.calls[0].args[2], 'abc-12345')
})

Deno.test('destructive tools require confirm: true', async () => {
  const { call, service } = setup()
  for (const [name, args] of [
    ['cancel_booking', { booking_id: 'b1' }],
    ['cancel_booking', { booking_id: 'b1', confirm: false }],
    ['update_availability', { type: 'override', date: '2030-01-01', ranges: [] }],
  ] as const) {
    const { json } = await call(name, args)
    assertEquals(json.result.isError, true, name)
    assertEquals(json.result.structuredContent.error.code, 'confirmation_required')
  }
  assertEquals(service.calls.length, 0)
  const ok = await call('cancel_booking', { booking_id: 'b1', confirm: true, reason: 'sick' })
  assertEquals(ok.json.result.isError, undefined)
  assertEquals(service.calls[0].method, 'cancelBooking')
  assertEquals(service.calls[0].args[2], { reason: 'sick', confirm: true })
})

Deno.test('service errors become tool errors, unknown tools are protocol errors', async () => {
  const { call } = setup({
    getBooking: () => Promise.reject(new ServiceError('not_found', "booking 'zz' not found")),
  })
  const nf = await call('get_booking', { booking_id: 'zz' })
  assertEquals(nf.json.result.isError, true)
  assert(nf.json.result.content[0].text.includes('not_found'))
  const unk = await call('drop_database', {})
  assertEquals(unk.json.error.code, RPC.INVALID_PARAMS)
})

Deno.test('unknown method, parse error and invalid request', async () => {
  const { post } = setup()
  const m = await post({ jsonrpc: '2.0', id: 3, method: 'tools/destroy' })
  assertEquals(m.json.error.code, RPC.METHOD_NOT_FOUND)
  assertEquals(m.json.id, 3)
  const p = await post('{not json')
  assertEquals(p.res.status, 400)
  assertEquals(p.json.error.code, RPC.PARSE)
  const bad = await post({ id: 4, method: 5 })
  assertEquals(bad.json.error.code, RPC.INVALID_REQUEST)
})

Deno.test('batch requests return one response per request and skip notifications', async () => {
  const { post } = setup()
  const { json } = await post([
    { jsonrpc: '2.0', id: 1, method: 'ping' },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'nope' },
  ])
  assert(Array.isArray(json))
  assertEquals(json.map((r: { id: number }) => r.id), [1, 2, 3])
  assertEquals(json[2].error.code, RPC.METHOD_NOT_FOUND)
  const onlyNotes = await post([{ jsonrpc: '2.0', method: 'notifications/initialized' }])
  assertEquals(onlyNotes.res.status, 202)
})

Deno.test('resources and prompts', async () => {
  const { post } = setup()
  const list = await post({ jsonrpc: '2.0', id: 1, method: 'resources/list' })
  assertEquals(list.json.result.resources.map((r: { uri: string }) => r.uri), ['slotwise://agenda', 'slotwise://event-types'])
  const read = await post({ jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: 'slotwise://agenda' } })
  assertEquals(JSON.parse(read.json.result.contents[0].text)[0].id, 'b1')
  const missing = await post({ jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: 'slotwise://nope' } })
  assertExists(missing.json.error)
  const prompts = await post({ jsonrpc: '2.0', id: 4, method: 'prompts/list' })
  assertEquals(prompts.json.result.prompts.map((p: { name: string }) => p.name), ['plan_my_week', 'find_time_with', 'prepare_next_meeting'])
  const got = await post({ jsonrpc: '2.0', id: 5, method: 'prompts/get', params: { name: 'find_time_with', arguments: { person: 'Noa' } } })
  assert(got.json.result.messages[0].content.text.includes('Noa'))
  const noArg = await post({ jsonrpc: '2.0', id: 6, method: 'prompts/get', params: { name: 'find_time_with', arguments: {} } })
  assertEquals(noArg.json.error.code, RPC.INVALID_PARAMS)
})

Deno.test('auth: 401 without a valid key, 405 for GET, CORS preflight', async () => {
  const { handler } = setup()
  const res = await handler(new Request('http://localhost/mcp', { method: 'POST', body: '{"jsonrpc":"2.0","id":1,"method":"ping"}' }))
  assertEquals(res.status, 401)
  assert(res.headers.get('www-authenticate')?.startsWith('Bearer'))
  assertEquals((await handler(new Request('http://localhost/mcp', { method: 'GET' }))).status, 405)
  const pre = await handler(new Request('http://localhost/mcp', { method: 'OPTIONS' }))
  assertEquals(pre.status, 204)
  assertEquals(pre.headers.get('access-control-allow-origin'), '*')
})

Deno.test('every tool schema accepts a minimal valid call', () => {
  const samples: Record<string, Record<string, unknown>> = {
    list_event_types: {},
    get_event_type: { event_type_id: 'x' },
    get_availability: { event_type_id: 'x' },
    create_booking: { event_type_id: 'x', start: '2030-01-01T00:00:00Z', attendee: { name: 'a', email: 'a@b.co' }, idempotency_key: '12345678' },
    reschedule_booking: { booking_id: 'b', start: '2030-01-01T00:00:00Z' },
    cancel_booking: { booking_id: 'b', confirm: true },
    list_bookings: {},
    get_booking: { booking_id: 'b' },
    create_single_use_link: { event_type_id: 'x' },
    create_poll: { title: 't', duration: 30, options: [{ start: '2030-01-01T00:00:00Z' }] },
    update_availability: { type: 'out_of_office', start: '2030-01-01', end: '2030-01-03', confirm: true },
    get_insights: {},
    send_reminder: { booking_id: 'b', channel: 'email' },
  }
  for (const t of TOOLS) assertEquals(validate(t.inputSchema, samples[t.name]), [], t.name)
  assert(validate(TOOLS.find((t) => t.name === 'list_bookings')!.inputSchema, { limit: 'x' }).length > 0)
  assert(validate(TOOLS.find((t) => t.name === 'get_insights')!.inputSchema, { nope: 1 }).length > 0)
})
