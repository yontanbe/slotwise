export type ISO = string // UTC ISO timestamp
export type DateStr = string // yyyy-MM-dd
export type HHMM = string // "09:30"

export type Locale = 'he' | 'en'

export interface TimeRange {
  start: HHMM
  end: HHMM
}

export interface ShabbatSettings {
  enabled: boolean
  city: string // hebcal classic city name, e.g. "Jerusalem"
  blockHolidays: boolean
  showHebrewDate: boolean
}

export interface User {
  id: string
  email: string
  name: string
  username: string
  previousUsernames: string[]
  bio: string
  avatarUrl: string
  timezone: string
  locale: Locale
  weekStart: 0 | 1 | 6
  timeFormat: '24h' | '12h'
  theme: 'light' | 'dark' | 'system'
  brandColor: string
  phone: string
  shabbat: ShabbatSettings
  defaultScheduleId: string
  blockedEmails: string[]
  onboarded: boolean
  google?: GoogleSettings
  createdAt: ISO
}

export interface GoogleSettings {
  email?: string
  conflictCalendars: string[] // calendar ids checked for busy
  destinationCalendar: string // 'primary' by default
  sendWithGmail: boolean
  lastSyncAt?: ISO
}

export interface DateOverride {
  date: DateStr
  ranges: TimeRange[] // empty = unavailable all day
}

export interface Schedule {
  id: string
  ownerId: string
  name: string
  timezone: string
  weekly: TimeRange[][] // index 0 = Sunday ... 6 = Saturday
  overrides: DateOverride[]
}

export type LocationType =
  | 'meet'
  | 'zoom'
  | 'teams'
  | 'phone_host'
  | 'phone_invitee'
  | 'whatsapp'
  | 'in_person'
  | 'link'

export interface EventLocation {
  type: LocationType
  value?: string
}

export type QuestionType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'email'
  | 'phone'
  | 'select'
  | 'multiselect'
  | 'radio'
  | 'checkbox'
  | 'boolean'
  | 'url'
  | 'address'

export interface Question {
  id: string
  type: QuestionType
  label: string
  required: boolean
  options?: string[]
  placeholder?: string
  showIf?: { questionId: string; equals: string }
}

export interface PreferredWindow {
  day: number // 0..6
  start: HHMM
  end: HHMM
}

export type BookingWindow =
  | { type: 'rolling'; days: number }
  | { type: 'range'; start: DateStr; end: DateStr }
  | { type: 'unlimited' }

export interface EventLimits {
  perDay?: number | null
  perWeek?: number | null
  perMonth?: number | null
  durationPerDay?: number | null // minutes
}

export interface EventType {
  id: string
  ownerId: string
  title: string
  slug: string
  description: string
  color: string
  hidden: boolean
  durations: number[]
  defaultDuration: number
  locations: EventLocation[]
  scheduleId: string
  bufferBefore: number
  bufferAfter: number
  minNoticeMins: number
  window: BookingWindow
  slotInterval: number | null
  limits: EventLimits
  firstSlotOnly: boolean
  seats: number | null
  showAttendees: boolean
  requiresConfirmation: boolean
  questions: Question[]
  redirectUrl: string
  lockTimezone: boolean
  preferred: PreferredWindow[]
  position: number
  createdAt: ISO
}

export type BookingStatus = 'accepted' | 'pending' | 'cancelled' | 'rejected'

export interface Attendee {
  name: string
  email: string
  phone: string
  timezone: string
  locale: Locale
  whatsappOptIn: boolean
}

export interface BookingHistoryItem {
  at: ISO
  action: string
  by: 'host' | 'invitee' | 'system'
  note?: string
}

export interface Booking {
  id: string
  token: string
  ownerId: string
  eventTypeId: string
  title: string
  start: ISO
  end: ISO
  status: BookingStatus
  attendee: Attendee
  guests: string[]
  notes: string
  answers: Record<string, string | string[] | boolean>
  location: EventLocation
  cancelReason?: string
  rescheduleReason?: string
  rescheduledFromId?: string
  rescheduledToId?: string
  noShow: boolean
  internalNotes: string
  history: BookingHistoryItem[]
  source: 'web' | 'manual' | 'poll' | 'link'
  utm: Record<string, string>
  google?: { eventId?: string; meetUrl?: string; syncedAt?: ISO; error?: string }
  emailsSent?: string[]
  createdAt: ISO
}

export interface PollOption {
  start: ISO
  end: ISO
}

export type Vote = 'yes' | 'maybe' | 'no'

export interface PollVoter {
  id: string
  name: string
  email: string
  votes: Vote[] // index aligned with options
  at: ISO
}

export interface Poll {
  id: string
  ownerId: string
  title: string
  description: string
  duration: number
  location: EventLocation
  options: PollOption[]
  voters: PollVoter[]
  status: 'open' | 'closed'
  chosenIndex: number | null
  bookingId?: string
  createdAt: ISO
}

export interface OneOffLink {
  id: string
  token: string
  ownerId: string
  eventTypeId: string
  label: string
  usedBookingId?: string
  expiresAt?: ISO
  createdAt: ISO
}

export interface BusyBlock {
  start: ISO
  end: ISO
  source: 'google' | 'booking'
  eventTypeId?: string
}

export interface OutboxMessage {
  id: string
  ownerId: string
  channel: 'email' | 'whatsapp'
  to: string
  subject: string
  body: string
  bookingId?: string
  status: 'logged' | 'sent' | 'failed'
  via: 'outbox' | 'gmail'
  at: ISO
}
