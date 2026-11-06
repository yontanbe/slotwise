/**
 * Remote MCP server (Streamable HTTP transport, JSON responses, no SSE) over the service layer.
 * Pure request -> response with injected dependencies so it can be tested without network or DB.
 */
import { bearer, CORS_HEADERS, json, preflight, ServiceError, stripPrefix } from '../_shared/http.ts'
import { SlidingWindowLimiter } from '../_shared/ratelimit.ts'
import type { AuthInfo, Caller, SlotwiseService } from '../_shared/service.ts'
import { uid } from '../_shared/util.ts'

export const PROTOCOL_VERSION = '2025-06-18'
export const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
export const SERVER_INFO = { name: 'slotwise', title: 'Slotwise', version: '0.1.0' }
/** JSON-RPC batches are capped; each message in a batch counts against the key's rate limit. */
export const MAX_BATCH = 20

/* ---------------- JSON-RPC ---------------- */

type Id = string | number | null
interface RpcRequest {
  jsonrpc: '2.0'
  id?: Id
  method: string
  params?: Record<string, unknown>
}
interface RpcResponse {
  jsonrpc: '2.0'
  id: Id
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export const RPC = { PARSE: -32700, INVALID_REQUEST: -32600, METHOD_NOT_FOUND: -32601, INVALID_PARAMS: -32602, INTERNAL: -32603 }

const ok = (id: Id, result: unknown): RpcResponse => ({ jsonrpc: '2.0', id, result })
const fail = (id: Id, code: number, message: string, data?: unknown): RpcResponse => ({ jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } })

/* ---------------- minimal JSON Schema validation ---------------- */

// deno-lint-ignore no-explicit-any
type Schema = Record<string, any>

export function validate(schema: Schema, value: unknown, path = 'arguments'): string[] {
  const errs: string[] = []
  if (schema.const !== undefined && value !== schema.const) errs.push(`${path} must be ${JSON.stringify(schema.const)}`)
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${path} must be one of ${schema.enum.join(', ')}`)
  const t = schema.type
  if (t) {
    const types: string[] = Array.isArray(t) ? t : [t]
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
    const okType = types.some((x) => x === actual || (x === 'integer' && typeof value === 'number' && Number.isInteger(value)) || (x === 'number' && actual === 'number'))
    if (!okType) return [`${path} must be ${types.join(' or ')}`]
  }
  if (typeof value === 'string') {
    if (schema.minLength && value.length < schema.minLength) errs.push(`${path} is too short`)
    if (schema.maxLength && value.length > schema.maxLength) errs.push(`${path} is too long`)
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errs.push(`${path} does not match ${schema.pattern}`)
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errs.push(`${path} must be >= ${schema.minimum}`)
    if (schema.maximum !== undefined && value > schema.maximum) errs.push(`${path} must be <= ${schema.maximum}`)
  }
  if (Array.isArray(value)) {
    if (schema.minItems && value.length < schema.minItems) errs.push(`${path} needs at least ${schema.minItems} items`)
    if (schema.maxItems && value.length > schema.maxItems) errs.push(`${path} allows at most ${schema.maxItems} items`)
    if (schema.items) value.forEach((v, i) => errs.push(...validate(schema.items, v, `${path}[${i}]`)))
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>
    for (const r of schema.required ?? []) if (o[r] === undefined) errs.push(`${path}.${r} is required`)
    for (const [k, v] of Object.entries(o)) {
      const ps = schema.properties?.[k]
      if (ps) errs.push(...validate(ps, v, `${path}.${k}`))
      else if (schema.additionalProperties === false) errs.push(`${path}.${k} is not allowed`)
    }
  }
  return errs
}

/* ---------------- tools ---------------- */

const str = (description: string, extra: Schema = {}) => ({ type: 'string', description, ...extra })
const isoTs = (description: string) => str(description + ' (ISO 8601 timestamp, e.g. 2026-11-10T09:00:00Z)')
const dateOrTs = (description: string) => str(description + ' (yyyy-MM-dd or ISO timestamp)')
const confirmProp = { type: 'boolean', const: true, description: 'Must be true. Ask the user to confirm before setting it.' }
const attendeeSchema = {
  type: 'object',
  required: ['name', 'email'],
  properties: {
    name: str('Attendee full name'),
    email: str('Attendee email'),
    phone: str('Attendee phone, international format'),
    timezone: str('Attendee IANA timezone, e.g. Asia/Jerusalem'),
    locale: { type: 'string', enum: ['he', 'en'] },
  },
  additionalProperties: false,
}

export interface ToolDef {
  name: string
  title: string
  description: string
  inputSchema: Schema
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean }
  /** requires `confirm: true` */
  destructive?: boolean
  run: (s: SlotwiseService, c: Caller, a: Record<string, unknown>) => Promise<Record<string, unknown>>
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false })
// deno-lint-ignore no-explicit-any
const A = (a: Record<string, unknown>) => a as any

export const TOOLS: ToolDef[] = [
  {
    name: 'list_event_types',
    title: 'List event types',
    description: 'List the meeting types the user offers (id, title, durations, locations). Use the id with get_availability and create_booking.',
    inputSchema: obj({ include_hidden: { type: 'boolean', description: 'Include hidden event types (default true)' } }),
    annotations: { readOnlyHint: true },
    run: async (s, c, a) => ({ eventTypes: await s.listEventTypes(c, { includeHidden: a.include_hidden !== false }) }),
  },
  {
    name: 'get_event_type',
    title: 'Get event type',
    description: 'Full settings of one event type: durations, buffers, notice, booking window, questions, price.',
    inputSchema: obj({ event_type_id: str('Event type id') }, ['event_type_id']),
    annotations: { readOnlyHint: true },
    run: async (s, c, a) => ({ eventType: await s.getEventType(c, String(a.event_type_id)) }),
  },
  {
    name: 'get_availability',
    title: 'Get availability',
    description:
      'Free bookable slots for an event type in a date range (max 62 days, default next 7 days), grouped by day in the given timezone. Respects working hours, overrides, buffers, notice, limits, existing bookings, calendar busy times and Shabbat.',
    inputSchema: obj(
      {
        event_type_id: str('Event type id'),
        from: dateOrTs('Range start, default now'),
        to: dateOrTs('Range end, dates are inclusive'),
        timezone: str('IANA timezone for grouping and date-only bounds, default the user timezone'),
        duration: { type: 'integer', description: 'Minutes; must be one of the event type durations' },
      },
      ['event_type_id'],
    ),
    annotations: { readOnlyHint: true },
    run: async (s, c, a) =>
      ({ ...(await s.getAvailability(c, { eventTypeId: String(a.event_type_id), from: A(a).from, to: A(a).to, timezone: A(a).timezone, duration: A(a).duration })) }),
  },
  {
    name: 'create_booking',
    title: 'Create booking',
    description:
      'Book a slot returned by get_availability for an attendee. Requires an idempotency_key (any unique string, reuse it when retrying the same booking). The attendee gets the usual confirmations.',
    inputSchema: obj(
      {
        event_type_id: str('Event type id'),
        start: isoTs('Slot start exactly as returned by get_availability'),
        duration: { type: 'integer', description: 'Minutes, default the event default duration' },
        attendee: attendeeSchema,
        notes: str('Notes shown to the host'),
        guests: { type: 'array', items: { type: 'string' }, maxItems: 10, description: 'Extra guest emails' },
        idempotency_key: str('Unique key for this booking attempt; reuse on retry', { minLength: 8, maxLength: 255 }),
      },
      ['event_type_id', 'start', 'attendee', 'idempotency_key'],
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    run: async (s, c, a) => {
      const out = await s.createBooking(
        c,
        { eventTypeId: String(a.event_type_id), start: String(a.start), duration: A(a).duration, attendee: A(a).attendee, notes: A(a).notes, guests: A(a).guests },
        String(a.idempotency_key),
      )
      return { booking: out.booking, replayed: out.replayed }
    },
  },
  {
    name: 'reschedule_booking',
    title: 'Reschedule booking',
    description: 'Move a booking to a new start time (same duration). Returns the new booking; the old one is marked as rescheduled.',
    inputSchema: obj({ booking_id: str('Booking id'), start: isoTs('New start, must be an available slot'), reason: str('Reason shown to the attendee') }, ['booking_id', 'start']),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    run: async (s, c, a) => ({ booking: await s.rescheduleBooking(c, String(a.booking_id), { start: String(a.start), reason: A(a).reason }) }),
  },
  {
    name: 'cancel_booking',
    title: 'Cancel booking',
    description: 'Cancel a booking and notify the attendee. Destructive: only call with confirm: true after the user explicitly agreed.',
    inputSchema: obj({ booking_id: str('Booking id'), reason: str('Reason shown to the attendee'), confirm: confirmProp }, ['booking_id', 'confirm']),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    destructive: true,
    run: async (s, c, a) => ({ booking: await s.cancelBooking(c, String(a.booking_id), { reason: A(a).reason, confirm: a.confirm === true }) }),
  },
  {
    name: 'list_bookings',
    title: 'List bookings',
    description: 'List or search bookings by status, date range and free text (attendee name, email, phone, title, notes, answers).',
    inputSchema: obj({
      status: str('Comma separated statuses: accepted, pending, cancelled, rejected'),
      from: dateOrTs('Bookings ending after this'),
      to: dateOrTs('Bookings starting before this (dates inclusive)'),
      query: str('Free text search'),
      event_type_id: str('Only this event type'),
      limit: { type: 'integer', minimum: 1, maximum: 200 },
      offset: { type: 'integer', minimum: 0 },
    }),
    annotations: { readOnlyHint: true },
    run: async (s, c, a) => ({
      ...(await s.listBookings(c, { status: A(a).status, from: A(a).from, to: A(a).to, q: A(a).query, eventTypeId: A(a).event_type_id, limit: A(a).limit, offset: A(a).offset })),
    }),
  },
  {
    name: 'get_booking',
    title: 'Get booking',
    description: 'Full details of one booking including history, answers and internal notes.',
    inputSchema: obj({ booking_id: str('Booking id') }, ['booking_id']),
    annotations: { readOnlyHint: true },
    run: async (s, c, a) => ({ booking: await s.getBooking(c, String(a.booking_id)) }),
  },
  {
    name: 'create_single_use_link',
    title: 'Create single use link',
    description: 'Create a booking link for one event type that can be used for exactly one booking.',
    inputSchema: obj({ event_type_id: str('Event type id'), label: str('Who the link is for'), expires_at: isoTs('Optional expiry') }, ['event_type_id']),
    annotations: { readOnlyHint: false, destructiveHint: false },
    run: async (s, c, a) => ({ ...(await s.createLink(c, { eventTypeId: String(a.event_type_id), label: A(a).label, expiresAt: A(a).expires_at })) }),
  },
  {
    name: 'create_poll',
    title: 'Create meeting poll',
    description: 'Create a group meeting poll with candidate times; returns a URL to share with participants.',
    inputSchema: obj(
      {
        title: str('Poll title'),
        description: str('Optional description'),
        duration: { type: 'integer', minimum: 5, maximum: 1440, description: 'Meeting length in minutes' },
        options: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: { type: 'object', required: ['start'], properties: { start: isoTs('Option start'), end: isoTs('Option end, default start + duration') }, additionalProperties: false },
        },
      },
      ['title', 'duration', 'options'],
    ),
    annotations: { readOnlyHint: false, destructiveHint: false },
    run: async (s, c, a) => ({ ...(await s.createPoll(c, A(a))) }),
  },
  {
    name: 'update_availability',
    title: 'Update availability',
    description:
      "Change availability for specific dates: type 'override' sets the working ranges for one date (empty ranges = day off); type 'out_of_office' blocks every day from start to end inclusive. Replaces existing overrides on those dates, so require confirm: true after the user agreed.",
    inputSchema: obj(
      {
        type: { type: 'string', enum: ['override', 'out_of_office'] },
        date: str('override: yyyy-MM-dd', { pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
        ranges: {
          type: 'array',
          items: {
            type: 'object',
            required: ['start', 'end'],
            properties: { start: str('HH:MM', { pattern: '^\\d{2}:\\d{2}$' }), end: str('HH:MM', { pattern: '^\\d{2}:\\d{2}$' }) },
            additionalProperties: false,
          },
        },
        start: str('out_of_office first day yyyy-MM-dd', { pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
        end: str('out_of_office last day yyyy-MM-dd', { pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
        schedule_id: str('Schedule id, default the default schedule'),
        note: str('Optional note'),
        confirm: confirmProp,
      },
      ['type', 'confirm'],
    ),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    destructive: true,
    run: async (s, c, a) =>
      ({ ...(await s.updateAvailability(c, { type: A(a).type, date: A(a).date, ranges: A(a).ranges, start: A(a).start, end: A(a).end, scheduleId: A(a).schedule_id, note: A(a).note })) }),
  },
  {
    name: 'get_insights',
    title: 'Get insights',
    description: 'Booking statistics for a period (default last 90 days): counts by status, reschedules, no show rate, busiest weekday and hour, per event type.',
    inputSchema: obj({ from: dateOrTs('Period start'), to: dateOrTs('Period end') }),
    annotations: { readOnlyHint: true },
    run: async (s, c, a) => ({ ...(await s.getInsights(c, { from: A(a).from, to: A(a).to })) }),
  },
  {
    name: 'send_reminder',
    title: 'Send reminder',
    description: 'Send a reminder for an upcoming booking to the attendee by email or WhatsApp (WhatsApp needs the attendee opt in).',
    inputSchema: obj(
      { booking_id: str('Booking id'), channel: { type: 'string', enum: ['email', 'whatsapp'] }, message: str('Optional template (max 500 chars), supports {invitee_first_name}, {event_time}, {manage_url}...', { maxLength: 500 }) },
      ['booking_id', 'channel'],
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    run: async (s, c, a) => ({ ...(await s.sendReminder(c, { bookingId: String(a.booking_id), channel: A(a).channel, message: A(a).message })) }),
  },
]

/* ---------------- resources & prompts ---------------- */

const RESOURCES = [
  { uri: 'slotwise://agenda', name: 'agenda', title: 'Upcoming agenda', description: 'Accepted and pending bookings for the next 7 days', mimeType: 'application/json' },
  { uri: 'slotwise://event-types', name: 'event-types', title: 'Event type catalog', description: 'All event types with durations and locations', mimeType: 'application/json' },
]

const PROMPTS = [
  {
    name: 'plan_my_week',
    title: 'Plan my week',
    description: 'Review the coming week: agenda, gaps, conflicts and suggestions.',
    arguments: [{ name: 'focus', description: 'Optional priorities for the week', required: false }],
  },
  {
    name: 'find_time_with',
    title: 'Find time with someone',
    description: 'Find mutually good slots with a person and offer to book or send a single use link.',
    arguments: [
      { name: 'person', description: 'Name or email of the person', required: true },
      { name: 'duration', description: 'Meeting length in minutes', required: false },
      { name: 'within', description: 'Time frame, e.g. "next week"', required: false },
    ],
  },
  { name: 'prepare_next_meeting', title: 'Prepare my next meeting', description: 'Brief for the next upcoming meeting.', arguments: [] },
]

function promptMessages(name: string, args: Record<string, string>): { description: string; messages: unknown[] } | null {
  const user = (text: string) => ({ role: 'user', content: { type: 'text', text } })
  switch (name) {
    case 'plan_my_week':
      return {
        description: 'Plan the coming week',
        messages: [
          user(
            'Read the slotwise://agenda resource (or call list_bookings for the next 7 days) and get_insights. ' +
              'Summarise my week day by day, flag pending requests, back-to-back meetings and days without breaks, and suggest which free blocks to protect. ' +
              (args.focus ? `My priorities this week: ${args.focus}. ` : '') +
              'Do not change anything without asking me first.',
          ),
        ],
      }
    case 'find_time_with': {
      if (!args.person) return null
      return {
        description: `Find time with ${args.person}`,
        messages: [
          user(
            `I want to meet ${args.person}${args.duration ? ` for ${args.duration} minutes` : ''}${args.within ? ` ${args.within}` : ' in the next two weeks'}. ` +
              'Use list_event_types to pick the best event type, then get_availability, and propose 3 to 5 good options in my timezone (prefer preferred slots). ' +
              'Then ask me whether to book one directly with create_booking (I will give the email) or send a create_single_use_link.',
          ),
        ],
      }
    }
    case 'prepare_next_meeting':
      return {
        description: 'Prepare the next meeting',
        messages: [
          user(
            'Find my next accepted booking with list_bookings (status accepted, from now, limit 1) and get_booking for full details. ' +
              'Give me a short brief: who, when (my timezone), where or meeting link, their answers and notes, past bookings with the same attendee (search by email), and suggested talking points.',
          ),
        ],
      }
  }
  return null
}

/* ---------------- sessions ---------------- */

const b64url = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64url = (s: string) => {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
    return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)))
  } catch {
    return ''
  }
}

export interface McpDeps {
  service: SlotwiseService
  /** sessionId -> client name. In memory per isolate; the name is also encoded in the id as a fallback. */
  sessions?: Map<string, { client: string; protocolVersion: string; ownerId: string }>
  /** per API key limiter, same class and default as the REST API (120 / minute) */
  limiter?: SlidingWindowLimiter
}

/* ---------------- handler ---------------- */

export function createMcpHandler(deps: McpDeps): (req: Request) => Promise<Response> {
  const { service } = deps
  const sessions = deps.sessions ?? new Map()
  const limiter = deps.limiter ?? new SlidingWindowLimiter(120, 60_000)

  function clientFor(req: Request): string {
    const sid = req.headers.get('mcp-session-id')
    if (sid) {
      const hit = sessions.get(sid)
      if (hit) return hit.client
      const enc = sid.split('.')[1]
      if (enc) return unb64url(enc).slice(0, 80) || 'unknown'
    }
    return (req.headers.get('x-slotwise-client') || 'unknown').slice(0, 80)
  }

  async function callTool(caller: Caller, params: Record<string, unknown>, id: Id): Promise<RpcResponse> {
    const name = params?.name
    const tool = TOOLS.find((t) => t.name === name)
    if (!tool) return fail(id, RPC.INVALID_PARAMS, `Unknown tool: ${String(name)}`)
    const args = (params.arguments ?? {}) as Record<string, unknown>
    const toolError = (text: string, structured: Record<string, unknown>) => ok(id, { content: [{ type: 'text', text }], structuredContent: structured, isError: true })
    if (tool.destructive && args.confirm !== true) {
      return toolError(
        `${tool.name} is destructive and needs explicit confirmation. Describe the change to the user, get their approval, then call again with "confirm": true.`,
        { error: { code: 'confirmation_required', message: 'confirm: true is required' } },
      )
    }
    const errs = validate(tool.inputSchema, args)
    if (errs.length) return toolError(`Invalid arguments: ${errs.join('; ')}`, { error: { code: 'invalid_arguments', message: errs.join('; ') } })
    try {
      const result = await tool.run(service, caller, args)
      return ok(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result })
    } catch (e) {
      if (e instanceof ServiceError) return toolError(`Error (${e.code}): ${e.message}`, { error: { code: e.code, message: e.message } })
      console.error(e)
      return toolError('Internal error while running the tool', { error: { code: 'internal', message: 'internal error' } })
    }
  }

  async function readResource(caller: Caller, uri: string) {
    if (uri === 'slotwise://agenda') {
      const now = new Date()
      const out = await service.listBookings(caller, { status: 'accepted,pending', from: now.toISOString(), to: new Date(now.getTime() + 7 * 86400000).toISOString(), limit: 200 })
      return { uri, mimeType: 'application/json', text: JSON.stringify(out.bookings, null, 2) }
    }
    if (uri === 'slotwise://event-types') {
      return { uri, mimeType: 'application/json', text: JSON.stringify(await service.listEventTypes(caller), null, 2) }
    }
    return null
  }

  async function handle(msg: unknown, req: Request, auth: AuthInfo, ctx: { newSession?: string }): Promise<RpcResponse | null> {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return fail(null, RPC.INVALID_REQUEST, 'Invalid Request')
    const m = msg as RpcRequest
    const isNotification = m.id === undefined
    if (m.jsonrpc !== '2.0' || typeof m.method !== 'string') return isNotification ? null : fail(m.id ?? null, RPC.INVALID_REQUEST, 'Invalid Request')
    const id = m.id ?? null
    const params = (m.params ?? {}) as Record<string, unknown>
    if (isNotification) return null // notifications/initialized, notifications/cancelled, ...
    const caller: Caller = { ...auth, actor: 'mcp', client: clientFor(req) }
    try {
      switch (m.method) {
        case 'initialize': {
          const requested = String(params.protocolVersion ?? '')
          const protocolVersion = SUPPORTED_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSION
          const info = (params.clientInfo ?? {}) as { name?: string; version?: string }
          const client = `${String(info.name ?? 'unknown').slice(0, 60)}${info.version ? '/' + String(info.version).slice(0, 20) : ''}`
          const sid = `${uid(24)}.${b64url(client)}`
          sessions.set(sid, { client, protocolVersion, ownerId: auth.ownerId })
          if (sessions.size > 5000) sessions.delete(sessions.keys().next().value!)
          ctx.newSession = sid
          return ok(id, {
            protocolVersion,
            capabilities: { tools: { listChanged: false }, resources: { listChanged: false, subscribe: false }, prompts: { listChanged: false } },
            serverInfo: SERVER_INFO,
            instructions:
              'Slotwise schedules meetings for the signed-in host. Typical flow: list_event_types -> get_availability -> create_booking (with an idempotency_key). ' +
              'cancel_booking and update_availability are destructive and need confirm: true after the user explicitly agrees. Times are ISO 8601; show them to the user in their timezone.',
          })
        }
        case 'ping':
          return ok(id, {})
        case 'tools/list':
          return ok(id, { tools: TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations })) })
        case 'tools/call':
          return await callTool(caller, params, id)
        case 'resources/list':
          return ok(id, { resources: RESOURCES })
        case 'resources/templates/list':
          return ok(id, { resourceTemplates: [] })
        case 'resources/read': {
          const content = await readResource(caller, String(params.uri ?? ''))
          if (!content) return fail(id, -32002, `Resource not found: ${String(params.uri)}`)
          return ok(id, { contents: [content] })
        }
        case 'prompts/list':
          return ok(id, { prompts: PROMPTS })
        case 'prompts/get': {
          const p = promptMessages(String(params.name ?? ''), (params.arguments ?? {}) as Record<string, string>)
          if (!p) return fail(id, RPC.INVALID_PARAMS, `Unknown prompt or missing arguments: ${String(params.name)}`)
          return ok(id, p)
        }
        default:
          return fail(id, RPC.METHOD_NOT_FOUND, `Method not found: ${m.method}`)
      }
    } catch (e) {
      if (e instanceof ServiceError) return fail(id, RPC.INTERNAL, e.message, { code: e.code })
      console.error(e)
      return fail(id, RPC.INTERNAL, 'Internal error')
    }
  }

  return async (req: Request) => {
    if (req.method === 'OPTIONS') return preflight()
    const path = stripPrefix(new URL(req.url).pathname, 'mcp')
    if (path !== '/' && path !== '/mcp') return json({ error: { code: 'not_found', message: 'MCP endpoint is at /mcp' } }, 404)
    if (req.method === 'GET') return new Response('SSE stream not supported; use POST', { status: 405, headers: { ...CORS_HEADERS, Allow: 'POST, DELETE, OPTIONS' } })
    if (req.method === 'DELETE') {
      const sid = req.headers.get('mcp-session-id')
      if (sid) sessions.delete(sid)
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }
    if (req.method !== 'POST') return new Response(null, { status: 405, headers: { ...CORS_HEADERS, Allow: 'POST, DELETE, OPTIONS' } })

    const auth = await service.authenticate(bearer(req))
    if (!auth) {
      return json(fail(null, -32001, 'Unauthorized: send Authorization: Bearer <Slotwise API key>'), 401, {
        'WWW-Authenticate': 'Bearer realm="slotwise", error="invalid_token"',
      })
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(await req.text())
    } catch {
      return json(fail(null, RPC.PARSE, 'Parse error'), 400)
    }
    const ctx: { newSession?: string } = {}
    const headers: Record<string, string> = { 'X-RateLimit-Limit': String(limiter.limit) }
    const isRequest = (m: unknown) => !!m && typeof m === 'object' && (m as RpcRequest).id !== undefined
    /** every request message counts once against the key (notifications are free) */
    const limited = (m: unknown): RpcResponse | null => {
      if (!isRequest(m)) return null
      const rl = limiter.check(auth.apiKeyId)
      headers['X-RateLimit-Remaining'] = String(rl.remaining)
      if (rl.ok) return null
      headers['Retry-After'] = String(rl.retryAfterSec)
      return fail((m as RpcRequest).id ?? null, -32029, `Rate limit exceeded: retry after ${rl.retryAfterSec}s`, { code: 'rate_limited', retryAfter: rl.retryAfterSec })
    }
    if (Array.isArray(parsed)) {
      if (!parsed.length) return json(fail(null, RPC.INVALID_REQUEST, 'Empty batch'), 400)
      if (parsed.length > MAX_BATCH) return json(fail(null, RPC.INVALID_REQUEST, `Batch too large (max ${MAX_BATCH} messages)`), 400)
      const out: RpcResponse[] = []
      // sequential on purpose: one batch cannot fan out into parallel writes
      for (const m of parsed) {
        const r = limited(m) ?? (await handle(m, req, auth, ctx))
        if (r) out.push(r)
      }
      if (ctx.newSession) headers['Mcp-Session-Id'] = ctx.newSession
      return out.length ? json(out, 200, headers) : new Response(null, { status: 202, headers: { ...CORS_HEADERS, ...headers } })
    }
    const over = limited(parsed)
    if (over) return json(over, 429, headers)
    const res = await handle(parsed, req, auth, ctx)
    if (ctx.newSession) headers['Mcp-Session-Id'] = ctx.newSession
    return res ? json(res, 200, headers) : new Response(null, { status: 202, headers: { ...CORS_HEADERS, ...headers } })
  }
}
