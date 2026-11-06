import type { SupabaseClient } from '@supabase/supabase-js'
import { nowISO } from '../lib/id'
import type { Booking, BusyBlock, EventType, OneOffLink, OutboxMessage, PersonalLink, Poll, RoutingResponse, Schedule, Team, User } from '../lib/types'
import { makeBooking } from './local'
import {
  seriesStarts,
  type BookingBundle,
  type CreateResult,
  type ExportBundle,
  type Kind as ExtraKind,
  type KindMap,
  type NewBookingInput,
  type PublicProfile,
  type PublicRoutingForm,
  type PublicUser,
  type Store,
  type TeamBundle,
} from './store'

type Kind = 'profile' | 'event_type' | 'schedule' | 'booking' | 'poll' | 'link' | 'busy' | 'outbox' | ExtraKind

export class SupabaseStore implements Store {
  readonly mode = 'supabase' as const
  private listeners = new Set<() => void>()
  constructor(private sb: SupabaseClient) {}

  subscribe(cb: () => void) {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }
  private emit() {
    this.listeners.forEach((l) => l())
  }

  /** Realtime updates for the signed-in host (requires Realtime enabled on `records`). */
  watchOwner(ownerId: string) {
    const ch = this.sb
      .channel('records-' + ownerId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'records', filter: `owner_id=eq.${ownerId}` }, () => this.emit())
      .subscribe()
    return () => {
      this.sb.removeChannel(ch)
    }
  }

  private async list<T>(kind: Kind, ownerId: string): Promise<T[]> {
    const { data, error } = await this.sb.from('records').select('data').eq('kind', kind).eq('owner_id', ownerId)
    if (error) throw error
    return (data || []).map((r) => r.data as T)
  }
  private async put(kind: Kind, ownerId: string, id: string, data: unknown) {
    const { error } = await this.sb.from('records').upsert({ id, owner_id: ownerId, kind, data, updated_at: nowISO() })
    if (error) throw error
    this.emit()
  }
  private async del(id: string) {
    const { error } = await this.sb.from('records').delete().eq('id', id)
    if (error) throw error
    this.emit()
  }
  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.sb.rpc(fn, args)
    if (error) throw error
    return data as T
  }

  async getUser(id: string) {
    const { data } = await this.sb.from('records').select('data').eq('kind', 'profile').eq('id', id).maybeSingle()
    return (data?.data as User) ?? null
  }
  saveUser(u: User) {
    return this.put('profile', u.id, u.id, u)
  }
  async isUsernameFree(username: string, exceptUserId: string) {
    const p = await this.rpc<PublicProfile | null>('public_profile', { p_username: username })
    return !p || p.user.id === exceptUserId
  }
  async listEventTypes(ownerId: string) {
    return (await this.list<EventType>('event_type', ownerId)).sort((a, b) => a.position - b.position)
  }
  saveEventType(e: EventType) {
    return this.put('event_type', e.ownerId, e.id, e)
  }
  deleteEventType(id: string) {
    return this.del(id)
  }
  listSchedules(ownerId: string) {
    return this.list<Schedule>('schedule', ownerId)
  }
  saveSchedule(s: Schedule) {
    return this.put('schedule', s.ownerId, s.id, s)
  }
  deleteSchedule(id: string) {
    return this.del(id)
  }
  listBookings(ownerId: string) {
    return this.list<Booking>('booking', ownerId)
  }
  async getBooking(id: string) {
    const { data } = await this.sb.from('records').select('data').eq('kind', 'booking').eq('id', id).maybeSingle()
    return (data?.data as Booking) ?? null
  }
  saveBooking(b: Booking) {
    return this.put('booking', b.ownerId, b.id, b)
  }
  listPolls(ownerId: string) {
    return this.list<Poll>('poll', ownerId)
  }
  savePoll(p: Poll) {
    return this.put('poll', p.ownerId, p.id, p)
  }
  deletePoll(id: string) {
    return this.del(id)
  }
  listLinks(ownerId: string) {
    return this.list<OneOffLink>('link', ownerId)
  }
  saveLink(l: OneOffLink) {
    return this.put('link', l.ownerId, l.id, l)
  }
  deleteLink(id: string) {
    return this.del(id)
  }
  replaceBusy(ownerId: string, blocks: BusyBlock[]) {
    return this.put('busy', ownerId, 'busy-' + ownerId, { blocks })
  }
  async listOutbox(ownerId: string) {
    return (await this.list<OutboxMessage>('outbox', ownerId)).sort((a, b) => b.at.localeCompare(a.at))
  }
  addOutbox(m: OutboxMessage) {
    return this.put('outbox', m.ownerId, m.id, m)
  }
  async exportAll(ownerId: string): Promise<ExportBundle> {
    return {
      version: 1,
      exportedAt: nowISO(),
      user: (await this.getUser(ownerId))!,
      eventTypes: await this.listEventTypes(ownerId),
      schedules: await this.listSchedules(ownerId),
      bookings: await this.listBookings(ownerId),
      polls: await this.listPolls(ownerId),
      links: await this.listLinks(ownerId),
    }
  }
  async importAll(ownerId: string, d: ExportBundle) {
    const rows = [
      { id: ownerId, kind: 'profile', data: { ...d.user, id: ownerId } },
      ...d.eventTypes.map((x) => ({ id: x.id, kind: 'event_type', data: { ...x, ownerId } })),
      ...d.schedules.map((x) => ({ id: x.id, kind: 'schedule', data: { ...x, ownerId } })),
      ...d.bookings.map((x) => ({ id: x.id, kind: 'booking', data: { ...x, ownerId } })),
      ...d.polls.map((x) => ({ id: x.id, kind: 'poll', data: { ...x, ownerId } })),
      ...d.links.map((x) => ({ id: x.id, kind: 'link', data: { ...x, ownerId } })),
    ].map((r) => ({ ...r, owner_id: ownerId, updated_at: nowISO() }))
    const { error } = await this.sb.from('records').upsert(rows)
    if (error) throw error
    this.emit()
  }
  async deleteAccount(ownerId: string) {
    const { error } = await this.sb.from('records').delete().eq('owner_id', ownerId)
    if (error) throw error
    this.emit()
  }

  // ---------- public ----------
  getPublicProfile(username: string) {
    return this.rpc<PublicProfile | null>('public_profile', { p_username: username })
  }
  getPublicBusy(ownerId: string, from: string, to: string) {
    return this.rpc<{ bookings: { id: string; eventTypeId: string; start: string; end: string }[]; busy: BusyBlock[] }>('public_busy', {
      p_owner: ownerId,
      p_from: from,
      p_to: to,
    })
  }
  async createBooking(input: NewBookingInput): Promise<CreateResult> {
    if (input.override) {
      // host side manual booking, written directly under RLS
      const et = (await this.listEventTypes(input.ownerId)).find((e) => e.id === input.eventTypeId)
      if (!et) return { ok: false, error: 'not_found' }
      const b = makeBooking(input, et)
      await this.saveBooking(b)
      return { ok: true, booking: b }
    }
    const series =
      input.count && input.count > 1 && input.seriesFreq
        ? seriesStarts(input.start, input.end, input.seriesFreq, input.count, input.seriesTz || 'UTC')
        : null
    const res = await this.rpc<CreateResult>('public_create_booking', {
      p_booking: {
        ownerId: input.ownerId,
        eventTypeId: input.eventTypeId,
        start: input.start,
        end: input.end,
        attendee: input.attendee,
        guests: input.guests,
        notes: input.notes,
        answers: input.answers,
        location: input.location,
        utm: input.utm,
        source: input.source,
        coHostIds: input.coHostIds,
        personalLinkId: input.personalLinkId,
        routingResponseId: input.routingResponseId,
        hp: input.hp || '',
      },
      p_link_token: input.linkToken ?? null,
      p_series: series,
    })
    this.emit()
    return res
  }
  getBookingByToken(token: string) {
    return this.rpc<BookingBundle | null>('public_booking', { p_token: token })
  }
  async cancelByToken(token: string, reason: string) {
    const b = await this.rpc<Booking | null>('public_cancel_booking', { p_token: token, p_reason: reason })
    this.emit()
    return b
  }
  async rescheduleByToken(token: string, start: string, end: string, reason: string): Promise<CreateResult> {
    const res = await this.rpc<CreateResult>('public_reschedule_booking', { p_token: token, p_new: { start, end }, p_reason: reason })
    this.emit()
    return res
  }
  getPoll(id: string) {
    return this.rpc<{ poll: Poll; user: PublicProfile['user'] } | null>('public_poll', { p_id: id })
  }
  async votePoll(id: string, voter: Poll['voters'][number]) {
    const p = await this.rpc<Poll | null>('public_vote_poll', { p_id: id, p_voter: voter })
    this.emit()
    return p
  }
  getLink(token: string) {
    return this.rpc<{ link: OneOffLink; profile: PublicProfile } | null>('public_link', { p_token: token })
  }

  async confirmAttendance(token: string) {
    const b = await this.rpc<Booking | null>('public_reconfirm', { p_token: token })
    this.emit()
    return b
  }

  // ---------- generic collections ----------
  listKind<K extends ExtraKind>(kind: K, ownerId: string) {
    return this.list<KindMap[K]>(kind, ownerId)
  }
  saveKind<K extends ExtraKind>(kind: K, item: KindMap[K]) {
    const it = item as unknown as { id: string; ownerId: string }
    return this.put(kind, it.ownerId, it.id, item)
  }
  deleteKind(_kind: ExtraKind, id: string) {
    return this.del(id)
  }
  listMyTeams(_userId: string) {
    return this.rpc<Team[]>('my_teams', {})
  }
  findUserByUsername(username: string) {
    return this.rpc<PublicUser | null>('find_user', { p_username: username })
  }
  getPersonalLink(username: string, slug: string) {
    return this.rpc<PersonalLink | null>('public_personal_link', { p_username: username, p_slug: slug })
  }
  getRoutingForm(username: string, slug: string) {
    return this.rpc<{ form: PublicRoutingForm; profile: PublicProfile } | null>('public_routing_form', { p_username: username, p_slug: slug })
  }
  async submitRouting(formId: string, response: RoutingResponse) {
    await this.rpc('public_submit_routing', { p_form_id: formId, p_response: response })
  }
  getTeam(slug: string) {
    return this.rpc<TeamBundle | null>('public_team', { p_slug: slug })
  }
}
