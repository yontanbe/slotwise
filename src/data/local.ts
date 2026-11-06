import { nowISO, token as newToken, uid } from '../lib/id'
import type { Booking, BusyBlock, EventType, OneOffLink, OutboxMessage, Poll, Schedule, User } from '../lib/types'
import { buildSeed } from './defaults'
import { ACTIVE, toPublicUser, type CreateResult, type ExportBundle, type NewBookingInput, type PublicProfile, type Store } from './store'

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
}

const KEY = 'slotwise:db'
const empty = (): DB => ({ version: 1, users: [], eventTypes: [], schedules: [], bookings: [], polls: [], links: [], busy: {}, outbox: [] })

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
  if (!force && db.users.some((u) => u.id === 'demo-host')) return
  const s = buildSeed()
  const others = (arr: { ownerId: string }[]) => arr.filter((x) => x.ownerId !== s.user.id)
  write({
    ...db,
    users: [...db.users.filter((u) => u.id !== s.user.id), s.user],
    schedules: [...(others(db.schedules) as Schedule[]), ...s.schedules],
    eventTypes: [...(others(db.eventTypes) as EventType[]), ...s.eventTypes],
    bookings: [...(others(db.bookings) as Booking[]), ...s.bookings],
    polls: [...(others(db.polls) as Poll[]), ...s.polls],
    busy: { ...db.busy, [s.user.id]: [] },
  })
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
  const active = bookings.filter((b) => b.ownerId === user.id && ACTIVE.includes(b.status) && b.id !== ctx.ignoreId)
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
    return read().bookings.filter((b) => b.ownerId === ownerId)
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
  private profileFor(db: DB, user: User, redirectedFrom?: string): PublicProfile {
    return {
      user: toPublicUser(user),
      eventTypes: db.eventTypes.filter((e) => e.ownerId === user.id).sort((a, b) => a.position - b.position),
      schedules: db.schedules.filter((s) => s.ownerId === user.id),
      redirectedFrom,
    }
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
        .filter((b) => b.ownerId === ownerId && ACTIVE.includes(b.status) && overlaps(b, span))
        .map((b) => ({ id: b.id, eventTypeId: b.eventTypeId, start: b.start, end: b.end })),
      busy: (db.busy[ownerId] || []).filter((b) => overlaps(b, span)),
    }
  }
  async createBooking(input: NewBookingInput): Promise<CreateResult> {
    const db = read()
    const user = db.users.find((u) => u.id === input.ownerId)
    const et = db.eventTypes.find((e) => e.id === input.eventTypeId)
    if (!user || !et) return { ok: false, error: 'not_found' }
    let link: OneOffLink | undefined
    if (input.linkToken) {
      link = db.links.find((l) => l.token === input.linkToken)
      if (!link) return { ok: false, error: 'not_found' }
      if (link.usedBookingId || (link.expiresAt && link.expiresAt < nowISO())) return { ok: false, error: 'used' }
    }
    const err = checkCreate(input, { user, eventType: et, bookings: db.bookings, busy: db.busy[user.id] || [] })
    if (err) return err
    const booking = makeBooking(input, et)
    db.bookings.push(booking)
    if (link) link.usedBookingId = booking.id
    write(db)
    this.emit()
    return { ok: true, booking }
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
    return poll && user ? { poll, user: toPublicUser(user) } : null
  }
  async votePoll(id: string, voter: Poll['voters'][number]) {
    let out: Poll | null = null
    this.mutate((db) => {
      const p = db.polls.find((x) => x.id === id)
      if (!p || p.status !== 'open') return
      const i = p.voters.findIndex((v) => v.id === voter.id || (voter.email && v.email.toLowerCase() === voter.email.toLowerCase()))
      if (i >= 0) p.voters[i] = { ...voter, id: p.voters[i].id }
      else p.voters.push(voter)
      out = p
    })
    return out
  }
  async getLink(token: string) {
    const db = read()
    const link = db.links.find((l) => l.token === token)
    const user = link && db.users.find((u) => u.id === link.ownerId)
    return link && user ? { link, profile: this.profileFor(db, user) } : null
  }
}

export function localFindUserByEmail(email: string): User | null {
  return read().users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null
}
