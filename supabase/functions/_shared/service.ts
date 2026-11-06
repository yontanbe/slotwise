/**
 * Slotwise service layer: the single source of truth used by the REST API and the MCP server.
 * Owner scoped, audited, and built on the Repo interface so it can be faked in tests.
 *
 * Conflict rules live in the database (public_create_booking / public_reschedule_booking take an
 * advisory lock per owner and run _check_slot). This layer additionally checks that a requested
 * slot is actually offered by computeSlots (working hours, notice, window, limits, Shabbat).
 */
import { DateTime } from 'luxon'
import { computeSlots, groupByDate, type Slot } from './availability.ts'
import { shabbatBlocks } from './holidays.ts'
import { bookingVars, renderTemplate } from './workflows.ts'
import { DuplicateError, mutate, type Repo } from './db.ts'
import { ServiceError } from './http.ts'
import { sendEmail, sendWhatsApp, type SendResult } from './messaging.ts'
import type {
  ApiKey,
  AuditEntry,
  Booking,
  BusyBlock,
  DateOverride,
  EventLocation,
  EventType,
  IdempotencyEntry,
  OneOffLink,
  Poll,
  Schedule,
  TimeRange,
  User,
} from './types.ts'
import { appUrl, isIsoDate, newToken, sha256Hex, stableStringify, uid } from './util.ts'

export type Scope = 'read' | 'write'

export interface AuthInfo {
  ownerId: string
  apiKeyId: string
  keyName: string
  scopes: Scope[]
}

/** Who is calling: resolved key plus the surface and client name used for audit. */
export interface Caller extends AuthInfo {
  actor: 'api' | 'mcp'
  client: string
}

export interface AvailabilityInput {
  eventTypeId: string
  from?: string
  to?: string
  timezone?: string
  duration?: number
}

export interface AvailabilityResult {
  eventTypeId: string
  duration: number
  timezone: string
  from: string
  to: string
  slots: (Slot & { local: string; date: string })[]
  days: { date: string; times: string[] }[]
}

export interface BookingQuery {
  status?: string
  from?: string
  to?: string
  q?: string
  eventTypeId?: string
  limit?: number
  offset?: number
}

export interface CreateBookingInput {
  eventTypeId: string
  start: string
  end?: string
  duration?: number
  attendee: { name: string; email: string; phone?: string; timezone?: string; locale?: 'he' | 'en'; whatsappOptIn?: boolean }
  guests?: string[]
  notes?: string
  answers?: Record<string, string | string[] | boolean>
  location?: EventLocation
  utm?: Record<string, string>
}

export interface UpdateAvailabilityInput {
  type: 'override' | 'out_of_office'
  scheduleId?: string
  date?: string
  ranges?: TimeRange[]
  start?: string
  end?: string
  note?: string
}

export interface CreatePollInput {
  title: string
  description?: string
  duration: number
  location?: EventLocation
  options: { start: string; end?: string }[]
}

export interface Insights {
  from: string
  to: string
  total: number
  byStatus: Record<string, number>
  rescheduled: number
  noShows: number
  noShowRate: number
  busiestWeekday: string | null
  byWeekday: Record<string, number>
  busiestHour: number | null
  byEventType: { eventTypeId: string; title: string; count: number }[]
}

export interface SlotwiseService {
  authenticate(rawKey: string | null): Promise<AuthInfo | null>
  me(c: Caller): Promise<Record<string, unknown>>
  listEventTypes(c: Caller, opts?: { includeHidden?: boolean }): Promise<EventType[]>
  getEventType(c: Caller, id: string): Promise<EventType>
  getAvailability(c: Caller, input: AvailabilityInput): Promise<AvailabilityResult>
  listBookings(c: Caller, q: BookingQuery): Promise<{ bookings: Booking[]; total: number; limit: number; offset: number }>
  getBooking(c: Caller, id: string): Promise<Booking>
  createBooking(c: Caller, input: CreateBookingInput, idempotencyKey?: string): Promise<{ booking: Booking; replayed: boolean }>
  cancelBooking(c: Caller, id: string, opts: { reason?: string; confirm?: boolean }): Promise<Booking>
  rescheduleBooking(c: Caller, id: string, opts: { start: string; reason?: string }): Promise<Booking>
  createLink(c: Caller, input: { eventTypeId: string; label?: string; expiresAt?: string }): Promise<{ link: OneOffLink; url: string }>
  createPoll(c: Caller, input: CreatePollInput): Promise<{ poll: Poll; url: string }>
  updateAvailability(c: Caller, input: UpdateAvailabilityInput): Promise<{ schedule: Schedule; changedDates: string[] }>
  getInsights(c: Caller, q: { from?: string; to?: string }): Promise<Insights>
  sendReminder(c: Caller, input: { bookingId: string; channel: 'email' | 'whatsapp'; message?: string }): Promise<SendResult>
}

export interface ServiceDeps {
  repo: Repo
  now?: () => Date
  fetch?: typeof fetch
}

const ACTIVE = ['accepted', 'pending']
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const MAX_RANGE_DAYS = 62
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function need(c: Caller, scope: Scope) {
  if (!c.scopes.includes(scope)) throw new ServiceError('forbidden', `API key lacks the '${scope}' scope`)
}

function invalid(message: string): never {
  throw new ServiceError('invalid_request', message)
}

function validZone(tz: string | undefined): tz is string {
  return !!tz && DateTime.now().setZone(tz).isValid
}

/** Accepts ISO timestamps or yyyy-MM-dd (interpreted in `tz`, `to` dates are inclusive). */
function parseBound(v: string | undefined, tz: string, endOfDay: boolean): DateTime | null {
  if (!v) return null
  if (DATE_RE.test(v)) {
    const d = DateTime.fromISO(v, { zone: tz })
    if (!d.isValid) invalid(`invalid date '${v}'`)
    return endOfDay ? d.plus({ days: 1 }).startOf('day') : d.startOf('day')
  }
  if (!isIsoDate(v)) invalid(`invalid timestamp '${v}'`)
  return DateTime.fromISO(v, { setZone: true }).toUTC()
}

const iso = (d: Date | DateTime) => (d instanceof Date ? d.toISOString() : d.toUTC().toISO()!)

export function createService(deps: ServiceDeps): SlotwiseService {
  const { repo } = deps
  const now = () => deps.now?.() ?? new Date()

  async function audit(c: Caller, action: string, target: string) {
    const id = 'aud_' + uid(16)
    const entry: AuditEntry = { id, ownerId: c.ownerId, at: now().toISOString(), actor: c.actor, client: c.client || 'unknown', action, target, apiKeyId: c.apiKeyId }
    try {
      await repo.insert('audit', c.ownerId, id, entry)
    } catch (e) {
      console.error('audit write failed', e)
    }
  }

  async function profile(ownerId: string): Promise<User> {
    const rows = await repo.find<User>('profile', { owner: ownerId, limit: 1 })
    if (!rows.length) throw new ServiceError('not_found', 'profile not found for this API key owner')
    return rows[0].data
  }

  async function eventType(c: Caller, id: string): Promise<EventType> {
    if (!id) invalid('eventTypeId is required')
    const rec = await repo.get<EventType>('event_type', id)
    const mine = rec && (rec.owner_id === c.ownerId || (rec.data.hosts ?? []).some((h) => h.userId === c.ownerId))
    if (!rec || !mine) throw new ServiceError('not_found', `event type '${id}' not found`)
    return rec.data
  }

  /** Owner or co-host may read; only the owner may change a booking. */
  async function bookingRec(c: Caller, id: string, write = false) {
    if (!id) invalid('booking id is required')
    const rec = await repo.get<Booking>('booking', id)
    const isOwner = rec?.owner_id === c.ownerId
    const isCoHost = !!rec && (rec.data.coHostIds ?? []).includes(c.ownerId)
    if (!rec || !(isOwner || isCoHost)) throw new ServiceError('not_found', `booking '${id}' not found`)
    if (write && !isOwner) throw new ServiceError('forbidden', 'only the booking owner can change it')
    return rec
  }

  /** Bookings the caller owns plus those where they are a co-host (collective events). */
  async function myBookings(ownerId: string, statuses: string[]) {
    const statusFilter = statuses.length ? { in: { 'data->>status': statuses } } : {}
    const [own, co] = await Promise.all([
      repo.find<Booking>('booking', { owner: ownerId, ...statusFilter }),
      repo.find<Booking>('booking', { contains: { 'data->coHostIds': [ownerId] }, ...statusFilter }),
    ])
    const seen = new Set<string>()
    return [...own, ...co].filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
  }

  async function scheduleFor(ownerId: string, et: EventType, user: User): Promise<Schedule> {
    for (const id of [et.scheduleId, user.defaultScheduleId]) {
      if (!id) continue
      const rec = await repo.get<Schedule>('schedule', id, ownerId)
      if (rec) return rec.data
    }
    const any = await repo.find<Schedule>('schedule', { owner: ownerId, limit: 1 })
    if (!any.length) throw new ServiceError('not_found', 'no availability schedule configured')
    return any[0].data
  }

  /** Same data the public booking page sees (public_busy), padded for buffers. */
  async function busyFor(ownerId: string, from: DateTime, to: DateTime) {
    const res = await repo.rpc<{ bookings: { id: string; eventTypeId: string; start: string; end: string }[]; busy: BusyBlock[] }>(
      'public_busy',
      { p_owner: ownerId, p_from: iso(from.minus({ days: 1 })), p_to: iso(to.plus({ days: 1 })) },
    )
    return { bookings: res?.bookings ?? [], busy: res?.busy ?? [] }
  }

  async function slotsFor(ownerId: string, et: EventType, duration: number, from: DateTime, to: DateTime, ignoreBookingId?: string) {
    const user = await profile(ownerId)
    const schedule = await scheduleFor(ownerId, et, user)
    const { bookings, busy } = await busyFor(ownerId, from, to)
    const blocked = user.shabbat ? shabbatBlocks(user.shabbat, iso(from), iso(to)).map((b) => ({ start: b.start, end: b.end })) : []
    const slots = computeSlots({
      eventType: et,
      schedule,
      duration,
      from: iso(from),
      to: iso(to),
      now: now().toISOString(),
      busy,
      bookings,
      blocked,
      ignoreBookingId,
      weekStart: user.weekStart,
    })
    return { slots, user, schedule }
  }

  function pickDuration(et: EventType, start: string, end?: string, duration?: number): number {
    const d = end ? Math.round((Date.parse(end) - Date.parse(start)) / 60000) : duration ?? et.defaultDuration
    if (!et.durations.includes(d)) invalid(`duration ${d} is not offered; allowed: ${et.durations.join(', ')}`)
    return d
  }

  async function assertOffered(ownerId: string, et: EventType, startIso: string, duration: number, ignoreBookingId?: string) {
    const s = DateTime.fromISO(startIso, { zone: 'utc' })
    const { slots } = await slotsFor(ownerId, et, duration, s, s.plus({ minutes: 1 }), ignoreBookingId)
    if (!slots.some((x) => Date.parse(x.start) === s.toMillis())) {
      throw new ServiceError('conflict', 'slot_not_available: that time is not offered for this event type (check get_availability)')
    }
  }

  function rpcError(err: string): never {
    switch (err) {
      case 'not_found':
        throw new ServiceError('not_found', 'event type or booking not found')
      case 'blocked':
        throw new ServiceError('forbidden', 'attendee email is blocked by the host')
      case 'full':
        throw new ServiceError('conflict', 'slot_full: no seats left or a booking limit was reached')
      case 'limit':
        throw new ServiceError('conflict', 'invitee_limit: this attendee reached the per-invitee booking limit')
      case 'used':
        throw new ServiceError('conflict', 'link_used: the single use link was already used or expired')
      default:
        throw new ServiceError('conflict', `slot_not_available (${err})`)
    }
  }

  async function doCreate(c: Caller, input: CreateBookingInput): Promise<Booking> {
    if (!input || typeof input !== 'object') invalid('body is required')
    const et = await eventType(c, input.eventTypeId)
    if (!isIsoDate(input.start)) invalid('start must be an ISO timestamp')
    if (input.end !== undefined && !isIsoDate(input.end)) invalid('end must be an ISO timestamp')
    const a = input.attendee
    if (!a || typeof a.name !== 'string' || !a.name.trim()) invalid('attendee.name is required')
    if (typeof a.email !== 'string' || !EMAIL_RE.test(a.email.trim())) invalid('attendee.email must be a valid email')
    const start = new Date(input.start).toISOString()
    const duration = pickDuration(et, start, input.end, input.duration)
    const end = new Date(Date.parse(start) + duration * 60000).toISOString()
    await assertOffered(c.ownerId, et, start, duration)
    const user = await profile(c.ownerId)
    // id, token, status, history and source are decided by public_create_booking (_clean_booking allow-list)
    const booking = {
      ownerId: c.ownerId,
      eventTypeId: et.id,
      start,
      end,
      attendee: {
        name: a.name.trim(),
        email: a.email.trim(),
        phone: a.phone ?? '',
        timezone: validZone(a.timezone) ? a.timezone : user.timezone,
        locale: a.locale === 'en' || a.locale === 'he' ? a.locale : user.locale,
        whatsappOptIn: a.whatsappOptIn ?? false,
      },
      guests: input.guests ?? [],
      notes: input.notes ?? '',
      answers: input.answers ?? {},
      location: input.location ?? et.locations?.[0] ?? { type: 'link' },
      utm: input.utm ?? {},
      source: 'web',
    }
    const res = await repo.rpc<{ ok: boolean; booking?: Booking; error?: string }>('public_create_booking', { p_booking: booking, p_link_token: null })
    if (!res?.ok || !res.booking) rpcError(res?.error ?? 'conflict')
    // The RPC records the creation as by 'invitee'; mark it as made by the host through this surface.
    const annotated = await mutate<Booking>(repo, 'booking', res.booking.id, c.ownerId, (b) => {
      b.history = (b.history ?? []).map((h, i) => (i === 0 && h.action === 'created' ? { ...h, action: 'created_by_host', by: 'host', note: `via ${c.actor} (${c.client || 'unknown'})` } : h))
      return { ...b, createdVia: c.actor } as Booking
    }).catch(() => null)
    return annotated ?? res.booking
  }

  return {
    async authenticate(rawKey) {
      if (!rawKey || !/^sw_[A-Za-z0-9_-]{8,}$/.test(rawKey)) return null
      const hash = await sha256Hex(rawKey)
      const rows = await repo.find<ApiKey>('api_key', { eq: { 'data->>hash': hash }, limit: 1 })
      const rec = rows[0]
      if (!rec) return null
      const scopes = (rec.data.scopes ?? []).filter((s): s is Scope => s === 'read' || s === 'write')
      // throttle lastUsedAt writes to one per minute per key
      const last = rec.data.lastUsedAt ? Date.parse(rec.data.lastUsedAt) : 0
      if (now().getTime() - last > 60_000) {
        repo.update(rec, { ...rec.data, lastUsedAt: now().toISOString() }).catch((e) => console.error('lastUsedAt', e))
      }
      return { ownerId: rec.owner_id, apiKeyId: rec.data.id ?? rec.id, keyName: rec.data.name ?? '', scopes }
    },

    async me(c) {
      need(c, 'read')
      const u = await profile(c.ownerId)
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        username: u.username,
        timezone: u.timezone,
        locale: u.locale,
        weekStart: u.weekStart,
        bookingPageUrl: `${appUrl()}#/${u.username}`,
        apiKey: { id: c.apiKeyId, name: c.keyName, scopes: c.scopes },
      }
    },

    async listEventTypes(c, opts = {}) {
      need(c, 'read')
      const rows = await repo.find<EventType>('event_type', { owner: c.ownerId })
      return rows
        .map((r) => r.data)
        .filter((e) => opts.includeHidden !== false || !e.hidden)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    },

    async getEventType(c, id) {
      need(c, 'read')
      return await eventType(c, id)
    },

    async getAvailability(c, input) {
      need(c, 'read')
      const et = await eventType(c, input?.eventTypeId)
      const user = await profile(c.ownerId)
      const tz = input.timezone ?? user.timezone
      if (!validZone(tz)) invalid(`unknown timezone '${tz}'`)
      const duration = input.duration ?? et.defaultDuration
      if (!et.durations.includes(duration)) invalid(`duration ${duration} is not offered; allowed: ${et.durations.join(', ')}`)
      const from = parseBound(input.from, tz, false) ?? DateTime.fromJSDate(now()).toUTC()
      const to = parseBound(input.to, tz, true) ?? from.plus({ days: 7 })
      if (to <= from) invalid('to must be after from')
      if (to.diff(from, 'days').days > MAX_RANGE_DAYS) invalid(`range too large (max ${MAX_RANGE_DAYS} days)`)
      const { slots } = await slotsFor(c.ownerId, et, duration, from, to)
      const grouped = groupByDate(slots, tz)
      return {
        eventTypeId: et.id,
        duration,
        timezone: tz,
        from: iso(from),
        to: iso(to),
        slots: slots.map((s) => {
          const l = DateTime.fromISO(s.start).setZone(tz)
          return { ...s, date: l.toISODate()!, local: l.toFormat('HH:mm') }
        }),
        days: [...grouped.entries()].map(([date, ss]) => ({ date, times: ss.map((s) => DateTime.fromISO(s.start).setZone(tz).toFormat('HH:mm')) })),
      }
    },

    async listBookings(c, q = {}) {
      need(c, 'read')
      const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200)
      const offset = Math.max(Number(q.offset) || 0, 0)
      const statuses = q.status ? q.status.split(',').map((s) => s.trim()).filter(Boolean) : []
      for (const s of statuses) if (!['accepted', 'pending', 'cancelled', 'rejected'].includes(s)) invalid(`unknown status '${s}'`)
      const user = await profile(c.ownerId)
      const from = parseBound(q.from, user.timezone, false)
      const to = parseBound(q.to, user.timezone, true)
      const rows = await myBookings(c.ownerId, statuses)
      const needle = (q.q ?? '').trim().toLowerCase()
      const list = rows
        .map((r) => r.data)
        .filter((b) => !statuses.length || statuses.includes(b.status))
        .filter((b) => !q.eventTypeId || b.eventTypeId === q.eventTypeId)
        .filter((b) => !from || Date.parse(b.end) > from.toMillis())
        .filter((b) => !to || Date.parse(b.start) < to.toMillis())
        .filter((b) => {
          if (!needle) return true
          const hay = [b.id, b.title, b.notes, b.attendee?.name, b.attendee?.email, b.attendee?.phone, ...(b.guests ?? []), ...Object.values(b.answers ?? {}).flat().map(String)]
            .join(' \u0001 ')
            .toLowerCase()
          return hay.includes(needle)
        })
        .sort((a, b) => a.start.localeCompare(b.start))
      return { bookings: list.slice(offset, offset + limit), total: list.length, limit, offset }
    },

    async getBooking(c, id) {
      need(c, 'read')
      return (await bookingRec(c, id)).data
    },

    async createBooking(c, input, idempotencyKey) {
      need(c, 'write')
      if (!idempotencyKey) {
        const booking = await doCreate(c, input)
        await audit(c, 'booking.create', booking.id)
        return { booking, replayed: false }
      }
      if (idempotencyKey.length > 255) invalid('idempotency key too long (max 255)')
      const id = 'idem_' + (await sha256Hex(`${c.ownerId}:${idempotencyKey}`)).slice(0, 40)
      const requestHash = await sha256Hex(stableStringify(input))
      const entry: IdempotencyEntry = { id, ownerId: c.ownerId, key: idempotencyKey, requestHash, status: 'pending', createdAt: now().toISOString() }
      try {
        await repo.insert('idempotency', c.ownerId, id, entry)
      } catch (e) {
        if (!(e instanceof DuplicateError)) throw e
        const prev = await repo.get<IdempotencyEntry>('idempotency', id, c.ownerId)
        if (!prev) throw new ServiceError('idempotency_in_progress', 'retry shortly')
        if (prev.data.requestHash !== requestHash) {
          throw new ServiceError('idempotency_mismatch', 'this idempotency key was already used with a different request')
        }
        if (prev.data.status !== 'done') throw new ServiceError('idempotency_in_progress', 'a request with this idempotency key is still in progress')
        return { booking: prev.data.result as Booking, replayed: true }
      }
      try {
        const booking = await doCreate(c, input)
        await mutate<IdempotencyEntry>(repo, 'idempotency', id, c.ownerId, (d) => ({ ...d, status: 'done', result: booking }))
        await audit(c, 'booking.create', booking.id)
        return { booking, replayed: false }
      } catch (e) {
        // failed attempts are not remembered, so a retry can succeed once the cause is fixed
        await repo.remove(id).catch(() => {})
        throw e
      }
    },

    async cancelBooking(c, id, opts) {
      need(c, 'write')
      if (opts?.confirm !== true) {
        throw new ServiceError('confirmation_required', 'Cancelling notifies the attendee and cannot be undone. Repeat the call with confirm: true.')
      }
      const rec = await bookingRec(c, id, true)
      if (!ACTIVE.includes(rec.data.status)) throw new ServiceError('conflict', `booking is already ${rec.data.status}`)
      const reason = (opts.reason ?? '').slice(0, 1000)
      const out = await mutate<Booking>(repo, 'booking', id, c.ownerId, (b) => {
        if (!ACTIVE.includes(b.status)) return null
        b.status = 'cancelled'
        b.cancelReason = reason
        b.history = [...(b.history ?? []), { at: now().toISOString(), action: 'cancelled', by: 'host', note: reason || `via ${c.actor}` }]
        return b
      })
      if (!out) throw new ServiceError('conflict', 'booking is no longer active')
      await audit(c, 'booking.cancel', id)
      return out
    },

    async rescheduleBooking(c, id, opts) {
      need(c, 'write')
      const rec = await bookingRec(c, id, true)
      const old = rec.data
      if (!ACTIVE.includes(old.status)) throw new ServiceError('conflict', `booking is ${old.status}`)
      if (!isIsoDate(opts?.start)) invalid('start must be an ISO timestamp')
      const et = await eventType(c, old.eventTypeId)
      const duration = Math.round((Date.parse(old.end) - Date.parse(old.start)) / 60000)
      const start = new Date(opts.start).toISOString()
      const end = new Date(Date.parse(start) + duration * 60000).toISOString()
      await assertOffered(c.ownerId, et, start, duration, old.id)
      const reason = (opts.reason ?? '').slice(0, 1000)
      const res = await repo.rpc<{ ok: boolean; booking?: Booking; error?: string }>('public_reschedule_booking', {
        p_token: old.token,
        p_new: { start, end },
        p_reason: reason,
      })
      if (!res?.ok || !res.booking) rpcError(res?.error ?? 'conflict')
      // the RPC records the change as made by the invitee; correct the actor on both rows
      const byHost = (action: string) => (b: Booking) => {
        const h = b.history ?? []
        for (let i = h.length - 1; i >= 0; i--) if (h[i].action === action) return ((h[i] = { ...h[i], by: 'host' }), b)
        return null
      }
      const fixed = await mutate<Booking>(repo, 'booking', res.booking.id, c.ownerId, byHost('rescheduled')).catch(() => null)
      await mutate<Booking>(repo, 'booking', old.id, c.ownerId, byHost('rescheduled_away')).catch(() => null)
      await audit(c, 'booking.reschedule', `${old.id}->${res.booking.id}`)
      return fixed ?? res.booking
    },

    async createLink(c, input) {
      need(c, 'write')
      const et = await eventType(c, input?.eventTypeId)
      if (input.expiresAt !== undefined && !isIsoDate(input.expiresAt)) invalid('expiresAt must be an ISO timestamp')
      const link: OneOffLink = {
        id: uid(),
        token: newToken(),
        ownerId: c.ownerId,
        eventTypeId: et.id,
        label: (input.label ?? '').slice(0, 200),
        ...(input.expiresAt ? { expiresAt: new Date(input.expiresAt).toISOString() } : {}),
        createdAt: now().toISOString(),
      }
      await repo.insert('link', c.ownerId, link.id, link)
      await audit(c, 'link.create', link.id)
      return { link, url: `${appUrl()}#/d/${link.token}` }
    },

    async createPoll(c, input) {
      need(c, 'write')
      if (!input?.title?.trim()) invalid('title is required')
      const duration = Number(input.duration)
      if (!Number.isInteger(duration) || duration < 5 || duration > 24 * 60) invalid('duration must be minutes between 5 and 1440')
      if (!Array.isArray(input.options) || !input.options.length || input.options.length > 50) invalid('options must contain 1 to 50 time options')
      const options = input.options.map((o, i) => {
        if (!isIsoDate(o?.start)) invalid(`options[${i}].start must be an ISO timestamp`)
        const start = new Date(o.start).toISOString()
        const end = o.end && isIsoDate(o.end) ? new Date(o.end).toISOString() : new Date(Date.parse(start) + duration * 60000).toISOString()
        if (end <= start) invalid(`options[${i}] ends before it starts`)
        return { start, end }
      })
      const poll: Poll = {
        id: uid(),
        ownerId: c.ownerId,
        title: input.title.trim().slice(0, 200),
        description: (input.description ?? '').slice(0, 2000),
        duration,
        location: input.location ?? { type: 'meet' },
        options,
        voters: [],
        status: 'open',
        chosenIndex: null,
        createdAt: now().toISOString(),
      }
      await repo.insert('poll', c.ownerId, poll.id, poll)
      await audit(c, 'poll.create', poll.id)
      return { poll, url: `${appUrl()}#/p/${poll.id}` }
    },

    async updateAvailability(c, input) {
      need(c, 'write')
      const user = await profile(c.ownerId)
      const scheduleId = input?.scheduleId || user.defaultScheduleId
      if (!(await repo.get<Schedule>('schedule', scheduleId, c.ownerId))) throw new ServiceError('not_found', `schedule '${scheduleId}' not found`)
      let overrides: DateOverride[]
      if (input.type === 'override') {
        if (!input.date || !DATE_RE.test(input.date)) invalid('date must be yyyy-MM-dd')
        const ranges = input.ranges ?? []
        if (!Array.isArray(ranges)) invalid('ranges must be an array')
        for (const r of ranges) {
          if (!HHMM_RE.test(r?.start) || !HHMM_RE.test(r?.end) || r.end <= r.start) invalid(`invalid range ${JSON.stringify(r)} (use HH:MM, end after start)`)
        }
        overrides = [{ date: input.date, ranges: ranges.map((r) => ({ start: r.start, end: r.end })) }]
      } else if (input.type === 'out_of_office') {
        if (!input.start || !DATE_RE.test(input.start) || !input.end || !DATE_RE.test(input.end)) invalid('start and end must be yyyy-MM-dd')
        const s = DateTime.fromISO(input.start)
        const e = DateTime.fromISO(input.end)
        if (e < s) invalid('end must not be before start')
        if (e.diff(s, 'days').days > 92) invalid('out of office spans at most 93 days')
        overrides = []
        for (let d = s; d <= e; d = d.plus({ days: 1 })) overrides.push({ date: d.toISODate()!, ranges: [] })
      } else {
        invalid("type must be 'override' or 'out_of_office'")
      }
      const dates = new Set(overrides.map((o) => o.date))
      const schedule = await mutate<Schedule>(repo, 'schedule', scheduleId, c.ownerId, (s) => ({
        ...s,
        overrides: [...(s.overrides ?? []).filter((o) => !dates.has(o.date)), ...overrides].sort((a, b) => a.date.localeCompare(b.date)),
      }))
      if (!schedule) throw new ServiceError('not_found', 'schedule disappeared')
      await audit(c, `availability.${input.type}`, `${scheduleId}:${[...dates][0]}${dates.size > 1 ? '..' + [...dates].pop() : ''}`)
      return { schedule, changedDates: [...dates] }
    },

    async getInsights(c, q = {}) {
      need(c, 'read')
      const user = await profile(c.ownerId)
      const tz = validZone(user.timezone) ? user.timezone : 'UTC'
      const to = parseBound(q.to, tz, true) ?? DateTime.fromJSDate(now()).toUTC()
      const from = parseBound(q.from, tz, false) ?? to.minus({ days: 90 })
      const [rows, ets] = await Promise.all([myBookings(c.ownerId, []), repo.find<EventType>('event_type', { owner: c.ownerId })])
      const list = rows.map((r) => r.data).filter((b) => Date.parse(b.start) >= from.toMillis() && Date.parse(b.start) < to.toMillis())
      const byStatus: Record<string, number> = { accepted: 0, pending: 0, cancelled: 0, rejected: 0 }
      const byWeekday: Record<string, number> = Object.fromEntries(WEEKDAYS.map((d) => [d, 0]))
      const byHour = new Map<number, number>()
      const byEt = new Map<string, number>()
      let rescheduled = 0
      let noShows = 0
      let pastAccepted = 0
      for (const b of list) {
        // the cancelled half of a reschedule is not a real cancellation
        if (b.status === 'cancelled' && b.rescheduledToId) continue
        byStatus[b.status] = (byStatus[b.status] ?? 0) + 1
        if (b.rescheduledFromId) rescheduled++
        if (b.status === 'accepted' && Date.parse(b.end) <= now().getTime()) {
          pastAccepted++
          if (b.noShow) noShows++
        }
        if (ACTIVE.includes(b.status)) {
          const l = DateTime.fromISO(b.start).setZone(tz)
          byWeekday[WEEKDAYS[l.weekday % 7]]++
          byHour.set(l.hour, (byHour.get(l.hour) ?? 0) + 1)
          byEt.set(b.eventTypeId, (byEt.get(b.eventTypeId) ?? 0) + 1)
        }
      }
      const top = <K>(m: Map<K, number> | [K, number][]) => {
        const arr = [...m].sort((a, b) => b[1] - a[1])
        return arr.length && arr[0][1] > 0 ? arr[0][0] : null
      }
      const titles = new Map(ets.map((r) => [r.data.id, r.data.title]))
      return {
        from: iso(from),
        to: iso(to),
        total: Object.values(byStatus).reduce((a, b) => a + b, 0),
        byStatus,
        rescheduled,
        noShows,
        noShowRate: pastAccepted ? Math.round((noShows / pastAccepted) * 1000) / 1000 : 0,
        busiestWeekday: top(Object.entries(byWeekday)),
        byWeekday,
        busiestHour: top(byHour),
        byEventType: [...byEt].map(([eventTypeId, count]) => ({ eventTypeId, title: titles.get(eventTypeId) ?? '', count })).sort((a, b) => b.count - a.count),
      }
    },

    async sendReminder(c, input) {
      need(c, 'write')
      if (input?.channel !== 'email' && input?.channel !== 'whatsapp') invalid("channel must be 'email' or 'whatsapp'")
      const rec = await bookingRec(c, input.bookingId, true)
      const b = rec.data
      if (!ACTIVE.includes(b.status)) throw new ServiceError('conflict', `booking is ${b.status}`)
      if (Date.parse(b.end) < now().getTime()) throw new ServiceError('conflict', 'booking is in the past')
      const user = await profile(c.ownerId)
      const host = { name: user.name, email: user.email, phone: user.phone, timezone: user.timezone, locale: user.locale }
      const vars = bookingVars(b, host, appUrl())
      const he = (b.attendee.locale || user.locale) === 'he'
      const tpl =
        input.message ??
        (he
          ? 'היי {invitee_first_name}, תזכורת: {event_name} עם {host_name} ב-{event_date} בשעה {event_time}. לניהול: {manage_url}'
          : 'Hi {invitee_first_name}, a reminder: {event_name} with {host_name} on {event_date} at {event_time}. Manage: {manage_url}')
      const body = renderTemplate(tpl, vars)
      let result: SendResult
      if (input.channel === 'email') {
        result = await sendEmail(
          { repo, fetch: deps.fetch },
          { ownerId: c.ownerId, to: b.attendee.email, subject: renderTemplate(he ? 'תזכורת: {event_name}' : 'Reminder: {event_name}', vars), body, bookingId: b.id, replyTo: user.email },
        )
      } else {
        if (!b.attendee.whatsappOptIn) throw new ServiceError('conflict', 'attendee has not opted in to WhatsApp messages')
        result = await sendWhatsApp({ repo, fetch: deps.fetch }, { ownerId: c.ownerId, to: b.attendee.phone, body, bookingId: b.id, bookingToken: b.token, locale: he ? 'he' : 'en' })
      }
      await mutate<Booking>(repo, 'booking', b.id, c.ownerId, (x) => ({
        ...x,
        history: [...(x.history ?? []), { at: now().toISOString(), action: 'reminder_sent', by: 'host', note: `${input.channel}: ${result.status}` }],
      })).catch((e) => console.error('history append', e))
      await audit(c, `reminder.${input.channel}`, b.id)
      return result
    },
  }
}
