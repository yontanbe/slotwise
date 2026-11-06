/**
 * Server-side copy of the record shapes stored in `records.data`.
 * Snapshot of src/lib/types.ts (Edge Functions cannot import from src/ at deploy time).
 * Keep in sync when src/lib/types.ts changes; server-only shapes are at the bottom.
 */
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
  outOfOffice?: OutOfOffice[]
  travel?: TravelPeriod[]
  whatsapp?: WhatsAppSettings
  /** when true, workflows and webhooks run in the Edge Functions and the browser skips them */
  automationOnServer?: boolean
  createdAt: ISO
}

export interface OutOfOffice {
  id: string
  start: DateStr
  end: DateStr // inclusive
  note: string
  redirectUsername?: string
}

export interface TravelPeriod {
  id: string
  start: DateStr
  end: DateStr // inclusive
  timezone: string
}

export interface WhatsAppSettings {
  /** 'link' = click to chat (static). 'cloud' = Meta Cloud API via edge function */
  mode: 'link' | 'cloud'
  phoneNumberId?: string
  defaultOptIn: boolean
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
  /** P1 extras, all optional for backwards compatibility */
  recurring?: { freq: 'weekly' | 'biweekly' | 'monthly'; maxCount: number } | null
  price?: EventPrice | null
  autoDeclineHours?: number | null
  reconfirmHours?: number | null
  perInviteeLimit?: { count: number; days: number } | null
  teamId?: string | null
  schedulingType?: 'round_robin' | 'collective' | null
  hosts?: TeamHost[]
}

export interface EventPrice {
  amount: number // in major units
  currency: 'ILS' | 'USD' | 'EUR'
  mode: 'full' | 'deposit'
  depositAmount?: number
  /** Stripe Payment Link (works without a server) */
  paymentLink?: string
  noShowFee?: number
  refundHours?: number // full refund if cancelled at least N hours before
}

export interface TeamHost {
  userId: string
  priority: number // 0 low .. 3 urgent
  weight: number // 1..100
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
  recurringId?: string
  recurringIndex?: number
  coHostIds?: string[]
  teamId?: string
  payment?: BookingPayment
  reconfirmedAt?: ISO
  workflowDone?: string[] // `${workflowId}:${stepId}`
  personalLinkId?: string
  routingResponseId?: string
  webhooksSent?: string[]
}

export interface BookingPayment {
  status: 'unpaid' | 'paid' | 'refunded' | 'waived'
  amount: number
  currency: string
  link?: string
  paidAt?: ISO
  ref?: string
  /** server only: the Stripe Checkout Session opened for this booking and what it must charge */
  checkout?: { sessionId: string; amountMinor: number; currency: string; createdAt: ISO }
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
  source: 'google' | 'booking' | 'shabbat' | 'ooo'
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

/* ---------------- workflows ---------------- */
export type WorkflowTrigger =
  | 'booked'
  | 'requested'
  | 'confirmed'
  | 'cancelled'
  | 'rescheduled'
  | 'before_start'
  | 'after_end'
  | 'no_show'
  | 'paid'

export type WorkflowAction = 'email_attendee' | 'email_host' | 'email_custom' | 'whatsapp_attendee' | 'whatsapp_host' | 'sms_attendee' | 'webhook'

export interface WorkflowStep {
  id: string
  action: WorkflowAction
  to?: string
  subject: string
  body: string
}

export interface Workflow {
  id: string
  ownerId: string
  name: string
  active: boolean
  trigger: WorkflowTrigger
  offsetMins: number // for before_start / after_end
  eventTypeIds: string[] // empty = all
  steps: WorkflowStep[]
  createdAt: ISO
}

/* ---------------- routing forms ---------------- */
export type RouteTarget =
  | { type: 'event'; eventTypeId: string; teamSlug?: string }
  | { type: 'url'; url: string }
  | { type: 'message'; text: string }

export interface RoutingCondition {
  fieldId: string
  op: 'equals' | 'not_equals' | 'contains' | 'gt' | 'lt'
  value: string
}

export interface RoutingRule {
  id: string
  match: 'all' | 'any'
  conditions: RoutingCondition[]
  target: RouteTarget
}

export interface RoutingForm {
  id: string
  ownerId: string
  title: string
  description: string
  slug: string
  fields: Question[]
  rules: RoutingRule[]
  fallback: RouteTarget
  responses: RoutingResponse[]
  createdAt: ISO
}

export interface RoutingResponse {
  id: string
  answers: Record<string, string | string[] | boolean>
  routedTo: string
  at: ISO
}

/* ---------------- personal links ---------------- */
export interface PersonalLink {
  id: string
  ownerId: string
  slug: string // /username/<slug>
  eventTypeId: string
  name: string
  email: string
  greeting: string
  createdAt: ISO
}

/* ---------------- teams ---------------- */
export interface TeamMember {
  userId: string
  role: 'owner' | 'admin' | 'member'
  accepted: boolean
}

export interface Team {
  id: string
  ownerId: string
  name: string
  slug: string
  bio: string
  members: TeamMember[]
  createdAt: ISO
}

/* ---------------- developer ---------------- */
export type WebhookEvent = 'booking.created' | 'booking.cancelled' | 'booking.rescheduled' | 'booking.confirmed' | 'booking.rejected' | 'booking.paid' | 'poll.voted' | 'routing.submitted'

export interface Webhook {
  id: string
  ownerId: string
  url: string
  secret: string
  events: WebhookEvent[]
  active: boolean
  createdAt: ISO
}

export interface WebhookDelivery {
  id: string
  ownerId: string
  webhookId: string
  event: WebhookEvent
  status: 'ok' | 'failed' | 'sent_opaque'
  code?: number
  attempts: number
  at: ISO
  payload: unknown
}

export interface ApiKey {
  id: string
  ownerId: string
  name: string
  prefix: string // first 8 chars, shown in UI
  hash: string // sha-256 hex of the full key
  scopes: ('read' | 'write')[]
  createdAt: ISO
  lastUsedAt?: ISO
}

/* ---------------- server only ---------------- */
export type RecordKind =
  | 'profile' | 'event_type' | 'schedule' | 'booking' | 'poll' | 'link' | 'busy' | 'outbox' | 'workflow'
  | 'routing_form' | 'personal_link' | 'team' | 'team_member' | 'webhook' | 'webhook_delivery' | 'api_key' | 'audit' | 'idempotency'

/** A member's consent to host a team's event types. Row id `${teamId}:${userId}`, owned by userId. */
export interface TeamMemberConsent {
  teamId: string
  userId: string
  accepted: boolean
  at?: ISO
}

export interface AuditEntry {
  id: string
  ownerId: string
  at: ISO
  actor: 'api' | 'mcp' | 'system'
  client: string
  action: string
  target: string
  apiKeyId?: string
}

export interface IdempotencyEntry {
  id: string
  ownerId: string
  key: string
  requestHash: string
  status: 'pending' | 'done'
  result?: unknown
  createdAt: ISO
}

/** WebhookDelivery as written by the server (superset of the UI shape). */
export interface ServerWebhookDelivery extends Omit<WebhookDelivery, 'status'> {
  status: 'ok' | 'failed' | 'retrying' | 'sent_opaque'
  url: string
  nextAttemptAt?: ISO
  lastError?: string
  deadAt?: ISO
}
