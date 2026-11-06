import { DateTime } from 'luxon'
import { computeSlots } from '../lib/availability'
import { shabbatBlocks } from '../lib/holidays'
import { nowISO, token as newToken, uid } from '../lib/id'
import type { Booking, BusyBlock, EventType, OneOffLink, OutboxMessage, Poll, RoutingResponse, Schedule, Team, User } from '../lib/types'
import { buildSeed } from './defaults'
import {
  ACTIVE,
  seriesStarts,
  toPublicUser,
  type CreateResult,
  type ExportBundle,
  type Kind,
  type KindMap,
  type NewBookingInput,
  type PublicProfile,
  type Store,
} from './store'

interface DB {
  version: 1
  users: User[]
  eventTypes: EventType[]
  schedules: Schedule[]
  bookings: Booking[]
  polls: Poll[]
  links: OneOffLink[]
  busy: Record<string, BusyBlock[]>
  outbox: OutboxMessage[]
  kinds: { [K in Kind]?: KindMap[K][] }
}

const KEY = 'slotwise:db'
/** bump when the demo seed changes so returning visitors get the new sample data */
const SEED_VERSION = 3
const empty = (): DB => ({ version: 1, users: [], eventTypes: [], schedules: [], bookings: [], polls: [], links: [], busy: {}, outbox: [], kinds: {} })

/** In-memory fallback when localStorage is blocked (private mode, previews). */
let memory: DB | null = null

function read(): DB {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...empty(), ...JSON.parse(raw) }
  } catch {
    /* fall through */
  }
  return memory ?? empty()
}

function write(db: DB) {
  memory = db
  try {
    localStorage.setItem(KEY, JSON.stringify(db))
  } catch {
    /* quota or blocked: keep in memory */
  }
}

export function seedDemo(force = false) {
  const db = read()
  if (!force && db.users.some((u) => u.id === 'demo-host') && (db as DB & { seedVersion?: number }).seedVersion === SEED_VERSION) return
  const s = buildSeed()
  const ids = new Set(s.users.map((u) => u.id))
  const others = <T extends { ownerId: string }>(arr: T[]) => arr.filter((x) => !ids.has(x.ownerId))
  const kinds = { ...db.kinds }
  for (const [k, items] of Object.entries(s.kinds) as [Kind, { ownerId: string }[]][]) {
    ;(kinds as Record<string, unknown[]>)[k] = [...others(((db.kinds as Record<string, { ownerId: string }[]>)[k] || [])), ...items]
  }
  write({
    ...db,
    users: [...db.users.filter((u) => !ids.has(u.id)), ...s.users],
    schedules: [...others(db.schedules), ...s.schedules],
    eventTypes: [...others(db.eventTypes), ...s.eventTypes],
    bookings: [...others(db.bookings), ...s.bookings],
    polls: [...others(db.polls), ...s.polls],
    busy: { ...db.busy, ...Object.fromEntries(s.users.map((u) => [u.id, []])) },
    kinds,
    seedVersion: SEED_VERSION,
  } as DB)
}

function publicPoll(p: Poll): Poll {
  return { ...p, voters: p.voters.map((v) => ({ ...v, id: '', email: '' })) }
}

/**
 * Same availability rules the server enforces: the start must be one of the slots the engine
 * offers for every host (working hours, overrides, notice, window, limits, buffers, Shabbat, OOO).
 */
export function slotOffered(db: { users: User[]; schedules: Schedule[]; bookings: Booking[]; busy: Record<string, BusyBlock[]> }, et: EventType, hostIds: string[], start: string, end: string, ignoreId?: string): boolean {
  const duration = Math.round((Date.parse(end) - Date.parse(start)) / 60000)
  if (!et.durations.includes(duration)) return false
  for (const hid of hostIds) {
    const u = db.users.find((x) => x.id === hid)
    if (!u) return false
    const schedId = et.ownerId === hid ? et.scheduleId : u.defaultScheduleId
    const schedule = db.schedules.find((x) => x.id === schedId) ?? db.schedules.find((x) => x.ownerId === hid)
    if (!schedule) return false
    const from = new Date(Date.parse(start) - 60000).toISOString()
    const to = new Date(Date.parse(start) + 60000).toISOString()
    const ooo = (u.outOfOffice || []).map((o) => ({
      start: DateTime.fromISO(o.start, { zone: u.timezone }).startOf('day').toUTC().toISO()!,
      end: DateTime.fromISO(o.end, { zone: u.timezone }).plus({ days: 1 }).startOf('day').toUTC().toISO()!,
    }))
    const slots = computeSlots({
      eventType: et,
      schedule,
      duration,
      from,
      to,
      now: new Date().toISOString(),
      busy: db.busy[hid] || [],
      bookings: db.bookings
        .filter((b) => (b.ownerId === hid || (b.coHostIds || []).includes(hid)) && ACTIVE.includes(b.status))
        .map((b) => ({ id: b.id, eventTypeId: b.eventTypeId, start: b.start, end: b.end })),
      blocked: [...shabbatBlocks(u.shabbat, from, to), ...ooo],
      ignoreBookingId: ignoreId,
      weekStart: u.weekStart,
      travel: u.travel,
    })
    if (!slots.some((x) => Date.parse(x.start) === Date.parse(start))) return false
  }
  return true
}

const overlaps = (a: { start: string; end: string }, b: { start: string; end: string }) => a.start < b.end && a.end > b.start

export function checkCreate(
  input: NewBookingInput,
  ctx: { user: User; eventType: EventType; bookings: Booking[]; busy: BusyBlock[]; ignoreId?: string },
): CreateResult | null {
  const { user, eventType, bookings } = ctx
  if (input.hp) return { ok: false, error: 'spam' }
  const email = input.attendee.email.toLowerCase().trim()
  const domain = email.split('@')[1] || ''
  if (user.blockedEmails.some((b) => b && (b.toLowerCase() === email || b.toLowerCase() === domain || b.toLowerCase() === '@' + domain)))
    return { ok: false, error: 'blocked' }
  if (input.override) return null
  const hosts = [input.ownerId, ...(input.coHostIds || [])]
  const involves = (b: Booking) => hosts.includes(b.ownerId) || (b.coHostIds || []).some((h) => hosts.includes(h))
  const active = bookings.filter((b) => involves(b) && ACTIVE.includes(b.status) && b.id !== ctx.ignoreId)
  const lim = eventType.perInviteeLimit
  if (lim && lim.count > 0) {
    const win = lim.days * 864e5
    const t = Date.parse(input.start)
    const mine = active.filter((b) => b.eventTypeId === eventType.id && b.attendee.email.toLowerCase() === email && Math.abs(Date.parse(b.start) - t) < win)
    if (mine.length >= lim.count) return { ok: false, error: 'limit' }
  }
  if (eventType.seats) {
    const same = active.filter((b) => b.eventTypeId === eventType.id && b.start === input.start)
    if (same.length >= eventType.seats) return { ok: false, error: 'full' }
    const others = active.filter((b) => !(b.eventTypeId === eventType.id && b.start === input.start))
    if (others.some((b) => overlaps(b, input))) return { ok: false, error: 'conflict' }
  } else if (active.some((b) => overlaps(b, input))) return { ok: false, error: 'conflict' }
  if (ctx.busy.some((b) => overlaps(b, input))) return { ok: false, error: 'conflict' }
  return null
}

export function makeBooking(input: NewBookingInput, eventType: EventType): Booking {
  return {
    id: uid(),
    token: newToken(),
    ownerId: input.ownerId,
    eventTypeId: input.eventTypeId,
    title: eventType.title,
    start: input.start,
    end: input.end,
    status: eventType.requiresConfirmation && !input.override ? 'pending' : 'accepted',
    attendee: input.attendee,
    guests: input.guests,
    notes: input.notes,
    answers: input.answers,
    location: input.location,
    noShow: false,
    internalNotes: '',
    history: [{ at: nowISO(), action: input.source === 'manual' ? 'created_by_host' : 'created', by: input.source === 'manual' ? 'host' : 'invitee' }],
    source: input.source,
    utm: input.utm,
    emailsSent: [],
    createdAt: nowISO(),
    coHostIds: input.coHostIds?.length ? input.coHostIds : undefined,
    teamId: input.teamId,
    personalLinkId: input.personalLinkId,
    routingResponseId: input.routingResponseId,
    payment: eventType.price && eventType.price.amount > 0
      ? {
          status: 'unpaid',
          amount: eventType.price.mode === 'deposit' && eventType.price.depositAmount ? eventType.price.depositAmount : eventType.price.amount,
          currency: eventType.price.currency,
          link: eventType.price.paymentLink || undefined,
        }
      : undefined,
  }
}

export class LocalStore implements Store {
  readonly mode = 'local' as const
  private listeners = new Set<() => void>()

  constructor() {
    window.addEventListener('storage', (e) => {
      if (e.key === KEY) this.emit()
    })
  }

  subscribe(cb: () => void) {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }
  private emit() {
    this.listeners.forEach((l) => l())
  }
  private mutate(fn: (db: DB) => void) {
    const db = read()
    fn(db)
    write(db)
    this.emit()
  }
  private upsert<T extends { id: string }>(arr: T[], item: T) {
    const i = arr.findIndex((x) => x.id === item.id)
    if (i >= 0) arr[i] = item
    else arr.push(item)
  }

  async getUser(id: string) {
    return read().users.find((u) => u.id === id) ?? null
  }
  async saveUser(u: User) {
    this.mutate((db) => this.upsert(db.users, u))
  }
  async isUsernameFree(username: string, exceptUserId: string) {
    const n = username.toLowerCase()
    return !read().users.some((u) => u.id !== exceptUserId && (u.username === n || u.previousUsernames.includes(n)))
  }
  async listEventTypes(ownerId: string) {
    return read().eventTypes.filter((e) => e.ownerId === ownerId).sort((a, b) => a.position - b.position)
  }
  async saveEventType(e: EventType) {
    this.mutate((db) => this.upsert(db.eventTypes, e))
  }
  async deleteEventType(id: string) {
    this.mutate((db) => {
      db.eventTypes = db.eventTypes.filter((e) => e.id !== id)
    })
  }
  async listSchedules(ownerId: string) {
    return read().schedules.filter((s) => s.ownerId === ownerId)
  }
  async saveSchedule(s: Schedule) {
    this.mutate((db) => this.upsert(db.schedules, s))
  }
  async deleteSchedule(id: string) {
    this.mutate((db) => {
      db.schedules = db.schedules.filter((s) => s.id !== id)
    })
  }
  async listBookings(ownerId: string) {
    return read().bookings.filter((b) => b.ownerId === ownerId || (b.coHostIds || []).includes(ownerId))
  }
  async getBooking(id: string) {
    return read().bookings.find((b) => b.id === id) ?? null
  }
  async saveBooking(b: Booking) {
    this.mutate((db) => this.upsert(db.bookings, b))
  }
  async listPolls(ownerId: string) {
    return read().polls.filter((p) => p.ownerId === ownerId)
  }
  async savePoll(p: Poll) {
    this.mutate((db) => this.upsert(db.polls, p))
  }
  async deletePoll(id: string) {
    this.mutate((db) => {
      db.polls = db.polls.filter((p) => p.id !== id)
    })
  }
  async listLinks(ownerId: string) {
    return read().links.filter((l) => l.ownerId === ownerId)
  }
  async saveLink(l: OneOffLink) {
    this.mutate((db) => this.upsert(db.links, l))
  }
  async deleteLink(id: string) {
    this.mutate((db) => {
      db.links = db.links.filter((l) => l.id !== id)
    })
  }
  async replaceBusy(ownerId: string, blocks: BusyBlock[]) {
    this.mutate((db) => {
      db.busy[ownerId] = blocks
    })
  }
  async listOutbox(ownerId: string) {
    return read().outbox.filter((m) => m.ownerId === ownerId).sort((a, b) => b.at.localeCompare(a.at))
  }
  async addOutbox(m: OutboxMessage) {
    this.mutate((db) => {
      this.upsert(db.outbox, m)
      db.outbox = db.outbox.slice(-500)
    })
  }
  async exportAll(ownerId: string): Promise<ExportBundle> {
    const db = read()
    return {
      version: 1,
      exportedAt: nowISO(),
      user: db.users.find((u) => u.id === ownerId)!,
      eventTypes: db.eventTypes.filter((x) => x.ownerId === ownerId),
      schedules: db.schedules.filter((x) => x.ownerId === ownerId),
      bookings: db.bookings.filter((x) => x.ownerId === ownerId),
      polls: db.polls.filter((x) => x.ownerId === ownerId),
      links: db.links.filter((x) => x.ownerId === ownerId),
    }
  }
  async importAll(ownerId: string, data: ExportBundle) {
    this.mutate((db) => {
      const keep = <T extends { ownerId: string }>(a: T[]) => a.filter((x) => x.ownerId !== ownerId)
      const own = <T extends { ownerId: string }>(a: T[]) => a.map((x) => ({ ...x, ownerId }))
      this.upsert(db.users, { ...data.user, id: ownerId })
      db.eventTypes = [...keep(db.eventTypes), ...own(data.eventTypes)]
      db.schedules = [...keep(db.schedules), ...own(data.schedules)]
      db.bookings = [...keep(db.bookings), ...own(data.bookings)]
      db.polls = [...keep(db.polls), ...own(data.polls)]
      db.links = [...keep(db.links), ...own(data.links)]
    })
  }
  async deleteAccount(ownerId: string) {
    this.mutate((db) => {
      const keep = <T extends { ownerId: string }>(a: T[]) => a.filter((x) => x.ownerId !== ownerId)
      db.users = db.users.filter((u) => u.id !== ownerId)
      db.eventTypes = keep(db.eventTypes)
      db.schedules = keep(db.schedules)
      db.bookings = keep(db.bookings)
      db.polls = keep(db.polls)
      db.links = keep(db.links)
      db.outbox = keep(db.outbox)
      delete db.busy[ownerId]
    })
  }

  // ---------- public ----------
  private profileFor(db: DB, user: User, redirectedFrom?: string, includeSlug?: string): PublicProfile {
    return {
      user: toPublicUser(user),
      eventTypes: db.eventTypes.filter((e) => e.ownerId === user.id && !e.teamId && (!e.hidden || e.slug === includeSlug)).sort((a, b) => a.position - b.position),
      schedules: db.schedules.filter((s) => s.ownerId === user.id),
      redirectedFrom,
    }
  }
  async getPublicEventType(username: string, slug: string) {
    const db = read()
    const n = username.toLowerCase()
    const u = db.users.find((x) => x.username === n) ?? db.users.find((x) => x.previousUsernames.includes(n))
    return u ? this.profileFor(db, u, u.username === n ? undefined : n, slug) : null
  }
  async getPublicProfile(username: string) {
    const db = read()
    const n = username.toLowerCase()
    const u = db.users.find((x) => x.username === n)
    if (u) return this.profileFor(db, u)
    const old = db.users.find((x) => x.previousUsernames.includes(n))
    return old ? this.profileFor(db, old, n) : null
  }
  async getPublicBusy(ownerId: string, from: string, to: string) {
    const db = read()
    const span = { start: from, end: to }
    return {
      bookings: db.bookings
        .filter((b) => (b.ownerId === ownerId || (b.coHostIds || []).includes(ownerId)) && ACTIVE.includes(b.status) && overlaps(b, span))
        .map((b) => ({ id: b.id, eventTypeId: b.eventTypeId, start: b.start, end: b.end })),
      busy: (db.busy[ownerId] || []).filter((b) => overlaps(b, span)),
    }
  }
  async createBooking(input: NewBookingInput): Promise<CreateResult> {
    const db = read()
    const user = db.users.find((u) => u.id === input.ownerId)
    const et = db.eventTypes.find((e) => e.id === input.eventTypeId)
    if (!user || !et) return { ok: false, error: 'not_found' }
    // team event types may be booked on any listed host
    if (et.ownerId !== user.id && !(et.hosts || []).some((h) => h.userId === user.id)) return { ok: false, error: 'not_found' }
    let link: OneOffLink | undefined
    if (input.linkToken) {
      link = db.links.find((l) => l.token === input.linkToken)
      if (!link) return { ok: false, error: 'not_found' }
      if (link.usedBookingId || (link.expiresAt && link.expiresAt < nowISO())) return { ok: false, error: 'used' }
    }
    const hosts = [user.id, ...(input.coHostIds || [])]
    const busy = hosts.flatMap((h) => db.busy[h] || [])
    const count = et.recurring && input.count && input.count > 1 ? Math.min(input.count, et.recurring.maxCount) : 1
    const occurrences = count > 1 ? seriesStarts(input.start, input.end, et.recurring!.freq, count, user.timezone) : [{ start: input.start, end: input.end }]
    const created: Booking[] = []
    const seriesId = count > 1 ? uid() : undefined
    for (const [i, occ] of occurrences.entries()) {
      const one = { ...input, ...occ }
      const err = checkCreate(one, { user, eventType: et, bookings: [...db.bookings, ...created], busy })
      if (err) return err
      if (!input.override && !slotOffered({ ...db, bookings: [...db.bookings, ...created] }, et, hosts, occ.start, occ.end)) return { ok: false, error: 'conflict' }
      const b = makeBooking(one, et)
      if (seriesId) {
        b.recurringId = seriesId
        b.recurringIndex = i
      }
      created.push(b)
    }
    db.bookings.push(...created)
    if (link) link.usedBookingId = created[0].id
    write(db)
    this.emit()
    return { ok: true, booking: created[0] }
  }
  async getBookingByToken(token: string) {
    const db = read()
    const booking = db.bookings.find((b) => b.token === token)
    if (!booking) return null
    const user = db.users.find((u) => u.id === booking.ownerId)
    if (!user) return null
    return { booking, eventType: db.eventTypes.find((e) => e.id === booking.eventTypeId) ?? null, user: toPublicUser(user) }
  }
  async cancelByToken(token: string, reason: string) {
    let out: Booking | null = null
    this.mutate((db) => {
      const b = db.bookings.find((x) => x.token === token)
      if (!b || !ACTIVE.includes(b.status)) return
      b.status = 'cancelled'
      b.cancelReason = reason
      b.history.push({ at: nowISO(), action: 'cancelled', by: 'invitee', note: reason })
      out = b
    })
    return out
  }
  async rescheduleByToken(token: string, start: string, end: string, reason: string): Promise<CreateResult> {
    const db = read()
    const old = db.bookings.find((x) => x.token === token)
    if (!old || !ACTIVE.includes(old.status)) return { ok: false, error: 'not_found' }
    const user = db.users.find((u) => u.id === old.ownerId)!
    const et = db.eventTypes.find((e) => e.id === old.eventTypeId)
    if (!et) return { ok: false, error: 'not_found' }
    const input: NewBookingInput = {
      ownerId: old.ownerId,
      eventTypeId: old.eventTypeId,
      start,
      end,
      attendee: old.attendee,
      guests: old.guests,
      notes: old.notes,
      answers: old.answers,
      location: old.location,
      utm: old.utm,
      source: old.source,
    }
    const err = checkCreate(input, { user, eventType: et, bookings: db.bookings, busy: db.busy[user.id] || [], ignoreId: old.id })
    if (err) return err
    if (!slotOffered(db, et, [user.id, ...(old.coHostIds || [])], start, end, old.id)) return { ok: false, error: 'conflict' }
    const nb = makeBooking(input, et)
    nb.rescheduledFromId = old.id
    nb.rescheduleReason = reason
    nb.history = [...old.history, { at: nowISO(), action: 'rescheduled', by: 'invitee', note: reason }]
    if (old.google?.eventId) nb.google = { ...old.google, syncedAt: undefined } // move the same Google event
    old.status = 'cancelled'
    old.rescheduledToId = nb.id
    old.google = old.google ? { ...old.google, eventId: undefined } : undefined
    old.history.push({ at: nowISO(), action: 'rescheduled_away', by: 'invitee', note: reason })
    db.bookings.push(nb)
    write(db)
    this.emit()
    return { ok: true, booking: nb }
  }
  async getPoll(id: string) {
    const db = read()
    const poll = db.polls.find((p) => p.id === id)
    const user = poll && db.users.find((u) => u.id === poll.ownerId)
    return poll && user ? { poll: publicPoll(poll), user: toPublicUser(user) } : null
  }
  /** Voters are matched only by their secret id (kept in their browser), never by email. */
  async votePoll(id: string, voter: Poll['voters'][number]) {
    if (!voter.id || voter.id.length < 12 || !voter.name.trim()) return null
    let out: Poll | null = null
    this.mutate((db) => {
      const p = db.polls.find((x) => x.id === id)
      if (!p || p.status !== 'open') return
      const clean = { ...voter, name: voter.name.trim().slice(0, 80), votes: p.options.map((_, i) => (voter.votes[i] === 'yes' || voter.votes[i] === 'maybe' ? voter.votes[i] : 'no')) }
      const i = p.voters.findIndex((v) => v.id === voter.id)
      if (i >= 0) p.voters[i] = clean
      else p.voters.push(clean)
      out = publicPoll(p)
    })
    return out
  }
  async getLink(token: string) {
    const db = read()
    const link = db.links.find((l) => l.token === token)
    const user = link && db.users.find((u) => u.id === link.ownerId)
    return link && user ? { link, profile: { ...this.profileFor(db, user), eventTypes: db.eventTypes.filter((e) => e.ownerId === user.id) } } : null
  }

  async confirmAttendance(token: string) {
    let out: Booking | null = null
    this.mutate((db) => {
      const b = db.bookings.find((x) => x.token === token)
      if (!b || b.status !== 'accepted' || b.end < nowISO()) return
      b.reconfirmedAt = nowISO()
      b.history.push({ at: nowISO(), action: 'reconfirmed', by: 'invitee' })
      out = b
    })
    return out
  }

  // ---------- generic collections ----------
  async listKind<K extends Kind>(kind: K, ownerId: string): Promise<KindMap[K][]> {
    return ((read().kinds[kind] || []) as KindMap[K][]).filter((x) => (x as { ownerId: string }).ownerId === ownerId)
  }
  async saveKind<K extends Kind>(kind: K, item: KindMap[K]) {
    this.mutate((db) => {
      const arr = ((db.kinds[kind] as KindMap[K][] | undefined) ?? []) as (KindMap[K] & { id: string })[]
      this.upsert(arr, item as KindMap[K] & { id: string })
      ;(db.kinds as Record<string, unknown>)[kind] = kind === 'webhook_delivery' ? arr.slice(-300) : arr
    })
  }
  async deleteKind(kind: Kind, id: string) {
    this.mutate((db) => {
      ;(db.kinds as Record<string, { id: string }[]>)[kind] = ((db.kinds as Record<string, { id: string }[]>)[kind] || []).filter((x) => x.id !== id)
    })
  }
  async listMyTeams(userId: string) {
    return ((read().kinds.team || []) as Team[]).filter((t) => t.ownerId === userId || t.members.some((m) => m.userId === userId))
  }
  async findUserByUsername(username: string) {
    const u = read().users.find((x) => x.username === username.toLowerCase())
    return u ? toPublicUser(u) : null
  }
  async getPersonalLink(username: string, slug: string) {
    const db = read()
    const u = db.users.find((x) => x.username === username.toLowerCase())
    if (!u) return null
    return (db.kinds.personal_link || []).find((l) => l.ownerId === u.id && l.slug === slug.toLowerCase()) ?? null
  }
  async getRoutingForm(username: string, slug: string) {
    const db = read()
    const u = db.users.find((x) => x.username === username.toLowerCase())
    if (!u) return null
    const f = (db.kinds.routing_form || []).find((x) => x.ownerId === u.id && x.slug === slug.toLowerCase())
    if (!f) return null
    const { responses: _r, ...form } = f
    void _r
    return { form, profile: this.profileFor(db, u) }
  }
  async submitRouting(formId: string, response: RoutingResponse) {
    this.mutate((db) => {
      const f = (db.kinds.routing_form || []).find((x) => x.id === formId)
      if (f) f.responses = [...f.responses, response].slice(-500)
    })
  }
  async getTeam(slug: string) {
    const db = read()
    const team = (db.kinds.team || []).find((t) => t.slug === slug.toLowerCase())
    if (!team) return null
    const memberIds = [team.ownerId, ...team.members.filter((m) => m.accepted).map((m) => m.userId)]
    const members = [...new Set(memberIds)]
      .map((id) => db.users.find((u) => u.id === id))
      .filter((u): u is User => !!u)
      .map((u) => this.profileFor(db, u))
    return { team, members, eventTypes: db.eventTypes.filter((e) => e.teamId === team.id) }
  }

}

export function localFindUserByEmail(email: string): User | null {
  return read().users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null
}
