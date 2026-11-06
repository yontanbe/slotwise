import type { BookingLite } from '../lib/availability'
import type {
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
  'id' | 'name' | 'username' | 'bio' | 'avatarUrl' | 'timezone' | 'locale' | 'weekStart' | 'timeFormat' | 'brandColor' | 'shabbat' | 'phone' | 'email'
>

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
  hp?: string // honeypot
}

export type CreateResult =
  | { ok: true; booking: Booking }
  | { ok: false; error: 'conflict' | 'full' | 'blocked' | 'not_found' | 'used' | 'spam' }

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

  // public side (no login)
  getPublicProfile(username: string): Promise<PublicProfile | null>
  getPublicBusy(ownerId: string, from: ISO, to: ISO): Promise<{ bookings: BookingLite[]; busy: BusyBlock[] }>
  createBooking(input: NewBookingInput): Promise<CreateResult>
  getBookingByToken(token: string): Promise<BookingBundle | null>
  cancelByToken(token: string, reason: string): Promise<Booking | null>
  rescheduleByToken(token: string, start: ISO, end: ISO, reason: string): Promise<CreateResult>
  getPoll(id: string): Promise<{ poll: Poll; user: PublicUser } | null>
  votePoll(id: string, voter: PollVoter): Promise<Poll | null>
  getLink(token: string): Promise<{ link: OneOffLink; profile: PublicProfile } | null>
}

export function toPublicUser(u: User): PublicUser {
  const { id, name, username, bio, avatarUrl, timezone, locale, weekStart, timeFormat, brandColor, shabbat, phone, email } = u
  return { id, name, username, bio, avatarUrl, timezone, locale, weekStart, timeFormat, brandColor, shabbat, phone, email }
}

export const ACTIVE: Booking['status'][] = ['accepted', 'pending']
