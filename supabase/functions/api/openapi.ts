/** OpenAPI 3.1 description of the Slotwise REST API v1. */

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })
const ok = (schema: unknown, description = 'OK') => ({
  description,
  content: { 'application/json': { schema: { type: 'object', properties: { data: schema }, required: ['data'] } } },
})
const errors = {
  '400': { $ref: '#/components/responses/Error' },
  '401': { $ref: '#/components/responses/Error' },
  '403': { $ref: '#/components/responses/Error' },
  '404': { $ref: '#/components/responses/Error' },
  '409': { $ref: '#/components/responses/Error' },
  '429': { $ref: '#/components/responses/Error' },
}
const q = (name: string, description: string, schema: unknown = { type: 'string' }, required = false) => ({ name, in: 'query', required, description, schema })
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
const jsonBody = (schema: unknown) => ({ required: true, content: { 'application/json': { schema } } })

export function openapiDocument(serverUrl: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Slotwise API',
      version: '1.0.0',
      description:
        'Scheduling API. Authenticate with an API key created in Settings > Developer: `Authorization: Bearer sw_...`. ' +
        "Keys carry scopes 'read' and/or 'write'. Errors are `{ error: { code, message } }`. Rate limit: 120 requests per minute per key (per server instance).",
    },
    servers: [{ url: serverUrl }],
    security: [{ bearerAuth: [] }],
    paths: {
      '/me': { get: { operationId: 'getMe', summary: 'The key owner profile and key scopes', responses: { '200': ok({ type: 'object' }), ...errors } } },
      '/event-types': {
        get: {
          operationId: 'listEventTypes',
          summary: 'List event types',
          parameters: [q('includeHidden', 'Include hidden event types (default true)', { type: 'boolean' })],
          responses: { '200': ok({ type: 'array', items: ref('EventType') }), ...errors },
        },
      },
      '/event-types/{id}': { get: { operationId: 'getEventType', parameters: [idParam], responses: { '200': ok(ref('EventType')), ...errors } } },
      '/availability': {
        get: {
          operationId: 'getAvailability',
          summary: 'Bookable slots for an event type',
          parameters: [
            q('eventTypeId', 'Event type id', { type: 'string' }, true),
            q('from', 'ISO timestamp or yyyy-MM-dd (default now)'),
            q('to', 'ISO timestamp or yyyy-MM-dd, inclusive date (default from + 7 days, max 62 days)'),
            q('timezone', 'IANA zone used for date grouping and date-only bounds (default host zone)'),
            q('duration', 'Minutes, one of the event type durations', { type: 'integer' }),
          ],
          responses: { '200': ok(ref('Availability')), ...errors },
        },
      },
      '/availability/overrides': {
        post: {
          operationId: 'updateAvailability',
          summary: 'Add a date override or mark out of office (appends to schedule.overrides)',
          requestBody: jsonBody(ref('UpdateAvailability')),
          responses: { '200': ok({ type: 'object', properties: { schedule: { type: 'object' }, changedDates: { type: 'array', items: { type: 'string' } } } }), ...errors },
        },
      },
      '/bookings': {
        get: {
          operationId: 'listBookings',
          summary: 'List and search bookings',
          parameters: [
            q('status', 'Comma separated: accepted,pending,cancelled,rejected'),
            q('from', 'ISO timestamp or yyyy-MM-dd'),
            q('to', 'ISO timestamp or yyyy-MM-dd (inclusive date)'),
            q('q', 'Free text across attendee, title, notes, guests, answers'),
            q('eventTypeId', 'Filter by event type'),
            q('limit', '1..200, default 50', { type: 'integer' }),
            q('offset', 'Default 0', { type: 'integer' }),
          ],
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { data: { type: 'array', items: ref('Booking') }, total: { type: 'integer' }, limit: { type: 'integer' }, offset: { type: 'integer' } } },
                },
              },
            },
            ...errors,
          },
        },
        post: {
          operationId: 'createBooking',
          summary: 'Book a slot. The slot must be offered by availability; the database re-checks conflicts under a lock.',
          parameters: [{ name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string', maxLength: 255 }, description: 'Retries with the same key return the first result' }],
          requestBody: jsonBody(ref('CreateBooking')),
          responses: { '201': ok(ref('Booking'), 'Created'), '200': ok(ref('Booking'), 'Replayed (Idempotent-Replayed: true)'), '422': { $ref: '#/components/responses/Error' }, ...errors },
        },
      },
      '/bookings/{id}': { get: { operationId: 'getBooking', parameters: [idParam], responses: { '200': ok(ref('Booking')), ...errors } } },
      '/bookings/{id}/cancel': {
        post: {
          operationId: 'cancelBooking',
          parameters: [idParam],
          requestBody: jsonBody({ type: 'object', required: ['confirm'], properties: { confirm: { const: true }, reason: { type: 'string' } } }),
          responses: { '200': ok(ref('Booking')), ...errors },
        },
      },
      '/bookings/{id}/reschedule': {
        post: {
          operationId: 'rescheduleBooking',
          summary: 'Move a booking. Returns the new booking; the old one becomes cancelled with rescheduledToId.',
          parameters: [idParam],
          requestBody: jsonBody({ type: 'object', required: ['start'], properties: { start: { type: 'string', format: 'date-time' }, reason: { type: 'string' } } }),
          responses: { '200': ok(ref('Booking')), ...errors },
        },
      },
      '/bookings/{id}/reminders': {
        post: {
          operationId: 'sendReminder',
          parameters: [idParam],
          requestBody: jsonBody({ type: 'object', required: ['channel'], properties: { channel: { enum: ['email', 'whatsapp'] }, message: { type: 'string', description: 'Template with {variables}' } } }),
          responses: { '200': ok({ type: 'object' }), ...errors },
        },
      },
      '/links': {
        post: {
          operationId: 'createSingleUseLink',
          requestBody: jsonBody({ type: 'object', required: ['eventTypeId'], properties: { eventTypeId: { type: 'string' }, label: { type: 'string' }, expiresAt: { type: 'string', format: 'date-time' } } }),
          responses: { '201': ok({ type: 'object', properties: { link: { type: 'object' }, url: { type: 'string', format: 'uri' } } }, 'Created'), ...errors },
        },
      },
      '/polls': {
        post: {
          operationId: 'createPoll',
          requestBody: jsonBody(ref('CreatePoll')),
          responses: { '201': ok({ type: 'object', properties: { poll: { type: 'object' }, url: { type: 'string', format: 'uri' } } }, 'Created'), ...errors },
        },
      },
      '/insights': {
        get: {
          operationId: 'getInsights',
          parameters: [q('from', 'Default to - 90 days'), q('to', 'Default now')],
          responses: { '200': ok(ref('Insights')), ...errors },
        },
      },
      '/openapi.json': { get: { operationId: 'getOpenApi', security: [], responses: { '200': { description: 'This document' } } } },
    },
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', description: 'Slotwise API key (sw_...)' } },
      responses: {
        Error: {
          description: 'Error',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['error'],
                properties: { error: { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string' }, message: { type: 'string' } } } },
              },
            },
          },
        },
      },
      schemas: {
        EventType: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            slug: { type: 'string' },
            description: { type: 'string' },
            durations: { type: 'array', items: { type: 'integer' } },
            defaultDuration: { type: 'integer' },
            hidden: { type: 'boolean' },
            requiresConfirmation: { type: 'boolean' },
            seats: { type: ['integer', 'null'] },
            locations: { type: 'array', items: { type: 'object' } },
          },
          additionalProperties: true,
        },
        Slot: {
          type: 'object',
          properties: {
            start: { type: 'string', format: 'date-time' },
            end: { type: 'string', format: 'date-time' },
            preferred: { type: 'boolean' },
            seatsLeft: { type: 'integer' },
            date: { type: 'string', description: 'yyyy-MM-dd in the requested timezone' },
            local: { type: 'string', description: 'HH:mm in the requested timezone' },
          },
        },
        Availability: {
          type: 'object',
          properties: {
            eventTypeId: { type: 'string' },
            duration: { type: 'integer' },
            timezone: { type: 'string' },
            from: { type: 'string' },
            to: { type: 'string' },
            slots: { type: 'array', items: ref('Slot') },
            days: { type: 'array', items: { type: 'object', properties: { date: { type: 'string' }, times: { type: 'array', items: { type: 'string' } } } } },
          },
        },
        Attendee: {
          type: 'object',
          required: ['name', 'email'],
          properties: {
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
            phone: { type: 'string' },
            timezone: { type: 'string' },
            locale: { enum: ['he', 'en'] },
            whatsappOptIn: { type: 'boolean' },
          },
        },
        Booking: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            token: { type: 'string' },
            eventTypeId: { type: 'string' },
            title: { type: 'string' },
            start: { type: 'string', format: 'date-time' },
            end: { type: 'string', format: 'date-time' },
            status: { enum: ['accepted', 'pending', 'cancelled', 'rejected'] },
            attendee: ref('Attendee'),
            history: { type: 'array', items: { type: 'object' } },
          },
          additionalProperties: true,
        },
        CreateBooking: {
          type: 'object',
          required: ['eventTypeId', 'start', 'attendee'],
          properties: {
            eventTypeId: { type: 'string' },
            start: { type: 'string', format: 'date-time' },
            duration: { type: 'integer', description: 'Minutes; default the event default duration' },
            end: { type: 'string', format: 'date-time' },
            attendee: ref('Attendee'),
            guests: { type: 'array', items: { type: 'string', format: 'email' } },
            notes: { type: 'string' },
            answers: { type: 'object' },
            location: { type: 'object', properties: { type: { type: 'string' }, value: { type: 'string' } } },
            idempotencyKey: { type: 'string', description: 'Alternative to the Idempotency-Key header' },
          },
        },
        UpdateAvailability: {
          type: 'object',
          required: ['type'],
          properties: {
            type: { enum: ['override', 'out_of_office'] },
            scheduleId: { type: 'string', description: 'Default: the default schedule' },
            date: { type: 'string', description: 'override: yyyy-MM-dd' },
            ranges: {
              type: 'array',
              description: 'override: working ranges for that date; empty = unavailable',
              items: { type: 'object', required: ['start', 'end'], properties: { start: { type: 'string', pattern: '^\\d{2}:\\d{2}$' }, end: { type: 'string', pattern: '^\\d{2}:\\d{2}$' } } },
            },
            start: { type: 'string', description: 'out_of_office: first day yyyy-MM-dd' },
            end: { type: 'string', description: 'out_of_office: last day yyyy-MM-dd (inclusive)' },
            note: { type: 'string' },
          },
        },
        CreatePoll: {
          type: 'object',
          required: ['title', 'duration', 'options'],
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            duration: { type: 'integer' },
            location: { type: 'object' },
            options: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'object', required: ['start'], properties: { start: { type: 'string', format: 'date-time' }, end: { type: 'string', format: 'date-time' } } } },
          },
        },
        Insights: {
          type: 'object',
          properties: {
            from: { type: 'string' },
            to: { type: 'string' },
            total: { type: 'integer' },
            byStatus: { type: 'object', additionalProperties: { type: 'integer' } },
            rescheduled: { type: 'integer' },
            noShows: { type: 'integer' },
            noShowRate: { type: 'number' },
            busiestWeekday: { type: ['string', 'null'] },
            byWeekday: { type: 'object' },
            busiestHour: { type: ['integer', 'null'] },
            byEventType: { type: 'array', items: { type: 'object' } },
          },
        },
      },
    },
  }
}
