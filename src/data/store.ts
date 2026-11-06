import { DateTime } from 'luxon'
import type { BookingLite } from '../lib/availability'
import type {
  ApiKey,
  TeamMembership,
  PersonalLink,
  RoutingForm,
  RoutingResponse,
  Team,
  Webhook,
  WebhookDelivery,
  Workflow,
  Booking,
  BusyBlock,
  EventType,
  ISO,
  OneOffLink,
  OutboxMessage,
  Poll,
  PollVoter,
  Schedule,
  User,
} from '../lib/types'

export type PublicUser = Pick<
  User,
  | 'id'
  | 'name'
  | 'username'
  | 'bio'
  | 'avatarUrl'
  | 'timezone'
  | 'locale'
  | 'weekStart'
  | 'timeFormat'
  | 'brandColor'
  | 'shabbat'
  | 'phone'
  | 'email'
  | 'defaultScheduleId'
  | 'outOfOffice'
  | 'travel'
>

/** Generic owner-scoped collections for newer features. */
export interface KindMap {
  workflow: Workflow
  routing_form: RoutingForm
  personal_link: PersonalLink
  team: Team
  webhook: Webhook
  webhook_delivery: WebhookDelivery
  api_key: ApiKey
  team_member: TeamMembership
}
export type Kind = keyof KindMap

export interface TeamBundle {
  team: Team
  members: PublicProfile[]
  eventTypes: EventType[]
}

export type PublicRoutingForm = Omit<RoutingForm, 'responses'>

export interface PublicProfile {
  user: PublicUser
  eventTypes: EventType[]
  schedules: Schedule[]
  redirectedFrom?: string
}

export interface NewBookingInput {
  ownerId: string
  eventTypeId: string
  start: ISO
  end: ISO
  attendee: Booking['attendee']
  guests: string[]
  notes: string
  answers: Booking['answers']
  location: Booking['location']
  utm: Record<string, string>
  source: Booking['source']
  linkToken?: string
  /** host side only: skip conflict checks */
  override?: boolean
  coHostIds?: string[]
  teamId?: string
  personalLinkId?: string
  routingResponseId?: string
  /** recurring series: number of occurrences including the first */
  count?: number
  seriesFreq?: 'weekly' | 'biweekly' | 'monthly'
  /** host timezone so the series keeps the wall clock time across DST */
  seriesTz?: string
  hp?: string // honeypot
}

export type CreateResult =
  | { ok: true; booking: Booking }
  | { ok: false; error: 'conflict' | 'full' | 'blocked' | 'not_found' | 'used' | 'spam' | 'limit' }

export interface BookingBundle {
  booking: Booking
  eventType: EventType | null
  user: PublicUser
}

export interface ExportBundle {
  version: 1
  exportedAt: ISO
  user: User
  eventTypes: EventType[]
  schedules: Schedule[]
  bookings: Booking[]
  polls: Poll[]
  links: OneOffLink[]
}

export interface Store {
  readonly mode: 'local' | 'supabase'
  subscribe(cb: () => void): () => void

  // host side
  getUser(id: string): Promise<User | null>
  saveUser(u: User): Promise<void>
  isUsernameFree(username: string, exceptUserId: string): Promise<boolean>
  listEventTypes(ownerId: string): Promise<EventType[]>
  saveEventType(e: EventType): Promise<void>
  deleteEventType(id: string): Promise<void>
  listSchedules(ownerId: string): Promise<Schedule[]>
  saveSchedule(s: Schedule): Promise<void>
  deleteSchedule(id: string): Promise<void>
  listBookings(ownerId: string): Promise<Booking[]>
  getBooking(id: string): Promise<Booking | null>
  saveBooking(b: Booking): Promise<void>
  listPolls(ownerId: string): Promise<Poll[]>
  savePoll(p: Poll): Promise<void>
  deletePoll(id: string): Promise<void>
  listLinks(ownerId: string): Promise<OneOffLink[]>
  saveLink(l: OneOffLink): Promise<void>
  deleteLink(id: string): Promise<void>
  replaceBusy(ownerId: string, blocks: BusyBlock[]): Promise<void>
  listOutbox(ownerId: string): Promise<OutboxMessage[]>
  addOutbox(m: OutboxMessage): Promise<void>
  exportAll(ownerId: string): Promise<ExportBundle>
  importAll(ownerId: string, data: ExportBundle): Promise<void>
  deleteAccount(ownerId: string): Promise<void>
  listKind<K extends Kind>(kind: K, ownerId: string): Promise<KindMap[K][]>
  saveKind<K extends Kind>(kind: K, item: KindMap[K]): Promise<void>
  deleteKind(kind: Kind, id: string): Promise<void>
  listMyTeams(userId: string): Promise<Team[]>
  findUserByUsername(username: string): Promise<PublicUser | null>

  // public side (no login)
  getPublicProfile(username: string): Promise<PublicProfile | null>
  /** profile bundle that also contains the event type with this slug, even when hidden */
  getPublicEventType(username: string, slug: string): Promise<PublicProfile | null>
  getPublicBusy(ownerId: string, from: ISO, to: ISO): Promise<{ bookings: BookingLite[]; busy: BusyBlock[] }>
  createBooking(input: NewBookingInput): Promise<CreateResult>
  getBookingByToken(token: string): Promise<BookingBundle | null>
  cancelByToken(token: string, reason: string): Promise<Booking | null>
  rescheduleByToken(token: string, start: ISO, end: ISO, reason: string): Promise<CreateResult>
  getPoll(id: string): Promise<{ poll: Poll; user: PublicUser } | null>
  votePoll(id: string, voter: PollVoter): Promise<Poll | null>
  getLink(token: string): Promise<{ link: OneOffLink; profile: PublicProfile } | null>
  confirmAttendance(token: string): Promise<Booking | null>
  getPersonalLink(username: string, slug: string): Promise<PersonalLink | null>
  getRoutingForm(username: string, slug: string): Promise<{ form: PublicRoutingForm; profile: PublicProfile } | null>
  submitRouting(formId: string, response: RoutingResponse): Promise<void>
  getTeam(slug: string): Promise<TeamBundle | null>
}

export function toPublicUser(u: User): PublicUser {
  const { id, name, username, bio, avatarUrl, timezone, locale, weekStart, timeFormat, brandColor, shabbat, phone, email, defaultScheduleId, outOfOffice, travel } = u
  const show = !!u.showContact
  return { id, name, username, bio, avatarUrl, timezone, locale, weekStart, timeFormat, brandColor, shabbat, phone: show ? phone : '', email: show ? email : '', defaultScheduleId, outOfOffice: outOfOffice || [], travel: travel || [] }
}

/** Occurrence starts for a recurring series, stepping in the host timezone so DST keeps the wall clock time. */
export function seriesStarts(start: string, end: string, freq: 'weekly' | 'biweekly' | 'monthly', count: number, tz: string): { start: string; end: string }[] {
  const s0 = DateTime.fromISO(start).setZone(tz)
  const dur = Date.parse(end) - Date.parse(start)
  const out: { start: string; end: string }[] = []
  for (let i = 0; i < count; i++) {
    const d = freq === 'monthly' ? s0.plus({ months: i }) : s0.plus({ weeks: i * (freq === 'weekly' ? 1 : 2) })
    out.push({ start: d.toUTC().toISO()!, end: d.plus({ milliseconds: dur }).toUTC().toISO()! })
  }
  return out
}

export const ACTIVE: Booking['status'][] = ['accepted', 'pending']
