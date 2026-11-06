/**
 * Workflow engine shared by the browser (src/) and Supabase Edge Functions (Deno).
 * Dependency free on purpose: no imports, structural types only.
 */

export interface WfBooking {
  id: string
  token: string
  eventTypeId: string
  title: string
  start: string
  end: string
  status: 'accepted' | 'pending' | 'cancelled' | 'rejected'
  attendee: { name: string; email: string; phone: string; timezone: string; locale: 'he' | 'en' }
  notes: string
  location: { type: string; value?: string }
  noShow: boolean
  history: { at: string; action: string }[]
  rescheduledFromId?: string
  rescheduledToId?: string
  cancelReason?: string
  google?: { meetUrl?: string }
  payment?: { status: string }
  workflowDone?: string[]
  createdAt: string
}

export interface WfHost {
  name: string
  email: string
  phone: string
  timezone: string
  locale: 'he' | 'en'
}

export interface WfStep {
  id: string
  action: 'email_attendee' | 'email_host' | 'email_custom' | 'whatsapp_attendee' | 'whatsapp_host' | 'sms_attendee' | 'webhook'
  to?: string
  subject: string
  body: string
}

export interface WfWorkflow {
  id: string
  name: string
  active: boolean
  trigger: 'booked' | 'requested' | 'confirmed' | 'cancelled' | 'rescheduled' | 'before_start' | 'after_end' | 'no_show' | 'paid'
  offsetMins: number
  eventTypeIds: string[]
  steps: WfStep[]
  createdAt: string
}

export interface DueStep {
  key: string
  workflow: WfWorkflow
  step: WfStep
}

/** Time-based steps older than this are skipped instead of sent late. */
export const LATE_LIMIT_MS = 6 * 60 * 60 * 1000

export const TEMPLATE_VARS = [
  'invitee_name',
  'invitee_first_name',
  'invitee_email',
  'invitee_phone',
  'event_name',
  'event_date',
  'event_time',
  'event_end_time',
  'timezone',
  'location',
  'meeting_url',
  'host_name',
  'host_email',
  'manage_url',
  'cancel_url',
  'reschedule_url',
  'confirm_url',
  'notes',
  'cancel_reason',
] as const

export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{([a-z_]+)\}/g, (m, k: string) => (k in vars ? vars[k] : m))
}

function fmt(iso: string, tz: string, locale: string, opts: Intl.DateTimeFormatOptions) {
  try {
    return new Intl.DateTimeFormat(locale === 'he' ? 'he-IL' : 'en-US', { timeZone: tz, ...opts }).format(new Date(iso))
  } catch {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(new Date(iso))
  }
}

export function bookingVars(b: WfBooking, host: WfHost, appBase: string, forHost = false): Record<string, string> {
  const tz = forHost ? host.timezone : b.attendee.timezone || host.timezone
  const loc = forHost ? host.locale : b.attendee.locale || host.locale
  const manage = `${appBase}#/b/${b.token}`
  const meeting = b.google?.meetUrl || (b.location.value && /^https?:/.test(b.location.value) ? b.location.value : '')
  return {
    invitee_name: b.attendee.name,
    invitee_first_name: b.attendee.name.split(/\s+/)[0] || b.attendee.name,
    invitee_email: b.attendee.email,
    invitee_phone: b.attendee.phone || '',
    event_name: b.title,
    event_date: fmt(b.start, tz, loc, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    event_time: fmt(b.start, tz, loc, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
    event_end_time: fmt(b.end, tz, loc, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
    timezone: tz,
    location: b.location.value || b.location.type,
    meeting_url: meeting,
    host_name: host.name,
    host_email: host.email,
    manage_url: manage,
    cancel_url: manage + '?action=cancel',
    reschedule_url: manage + '?action=reschedule',
    confirm_url: manage + '?action=confirm',
    notes: b.notes || '',
    cancel_reason: b.cancelReason || '',
  }
}

const active = (b: WfBooking) => b.status === 'accepted' || b.status === 'pending'
const hasAction = (b: WfBooking, a: string) => b.history.some((h) => h.action === a)

/** Returns the steps that should run now for this booking. Pure: does not mutate. */
export function dueSteps(b: WfBooking, workflows: WfWorkflow[], nowIso: string): DueStep[] {
  const now = Date.parse(nowIso)
  const done = new Set(b.workflowDone || [])
  const out: DueStep[] = []
  for (const w of workflows) {
    if (!w.active) continue
    if (w.eventTypeIds.length && !w.eventTypeIds.includes(b.eventTypeId)) continue
    const created = Date.parse(w.createdAt)
    const bookedAfterWf = Date.parse(b.createdAt) >= created
    let fire = false
    switch (w.trigger) {
      case 'booked':
        fire = bookedAfterWf && b.status === 'accepted' && !b.rescheduledFromId
        break
      case 'requested':
        fire = bookedAfterWf && !b.rescheduledFromId && (b.status === 'pending' || hasAction(b, 'confirmed') || hasAction(b, 'rejected'))
        break
      case 'confirmed':
        fire = b.status === 'accepted' && hasAction(b, 'confirmed') && lastActionAt(b, 'confirmed') >= created
        break
      case 'cancelled':
        fire = b.status === 'cancelled' && !b.rescheduledToId && lastActionAt(b, 'cancelled') >= created
        break
      case 'rescheduled':
        fire = bookedAfterWf && active(b) && !!b.rescheduledFromId
        break
      case 'no_show':
        fire = b.noShow && lastActionAt(b, 'no_show') >= created
        break
      case 'paid':
        fire = b.payment?.status === 'paid' && bookedAfterWf
        break
      case 'before_start': {
        const due = Date.parse(b.start) - w.offsetMins * 60000
        fire = b.status === 'accepted' && now >= due && now < Date.parse(b.start) && now - due < LATE_LIMIT_MS && due >= created
        break
      }
      case 'after_end': {
        const due = Date.parse(b.end) + w.offsetMins * 60000
        fire = b.status === 'accepted' && !b.noShow && now >= due && now - due < LATE_LIMIT_MS && due >= created
        break
      }
    }
    if (!fire) continue
    for (const step of w.steps) {
      const key = `${w.id}:${step.id}`
      if (!done.has(key)) out.push({ key, workflow: w, step })
    }
  }
  return out
}

function lastActionAt(b: WfBooking, action: string): number {
  let t = -Infinity
  for (const h of b.history) if (h.action === action) t = Math.max(t, Date.parse(h.at))
  return t
}

/** Resolves the recipient for a step: email address, phone number or URL. */
export function stepRecipient(step: WfStep, b: WfBooking, host: WfHost): string {
  switch (step.action) {
    case 'email_attendee':
      return b.attendee.email
    case 'email_host':
      return host.email
    case 'whatsapp_attendee':
    case 'sms_attendee':
      return b.attendee.phone
    case 'whatsapp_host':
      return host.phone
    default:
      return step.to || ''
  }
}

/** Default template set offered in the UI. */
export const WORKFLOW_PRESETS: { key: string; he: Omit<WfWorkflow, 'id' | 'createdAt' | 'eventTypeIds' | 'active'>; en: Omit<WfWorkflow, 'id' | 'createdAt' | 'eventTypeIds' | 'active'> }[] = [
  {
    key: 'reminder_24h',
    he: {
      name: 'תזכורת 24 שעות לפני',
      trigger: 'before_start',
      offsetMins: 1440,
      steps: [{ id: 's1', action: 'whatsapp_attendee', subject: '', body: 'היי {invitee_first_name}, תזכורת: {event_name} עם {host_name} מחר ב-{event_time}. לשינוי: {reschedule_url}' }],
    },
    en: {
      name: '24h reminder',
      trigger: 'before_start',
      offsetMins: 1440,
      steps: [{ id: 's1', action: 'whatsapp_attendee', subject: '', body: 'Hi {invitee_first_name}, reminder: {event_name} with {host_name} tomorrow at {event_time}. Reschedule: {reschedule_url}' }],
    },
  },
  {
    key: 'reminder_1h_email',
    he: {
      name: 'מייל שעה לפני',
      trigger: 'before_start',
      offsetMins: 60,
      steps: [{ id: 's1', action: 'email_attendee', subject: 'בעוד שעה: {event_name}', body: 'היי {invitee_first_name},\n{event_name} מתחיל ב-{event_time}.\n{meeting_url}\n\nלשינוי או ביטול: {manage_url}' }],
    },
    en: {
      name: 'Email 1h before',
      trigger: 'before_start',
      offsetMins: 60,
      steps: [{ id: 's1', action: 'email_attendee', subject: 'In one hour: {event_name}', body: 'Hi {invitee_first_name},\n{event_name} starts at {event_time}.\n{meeting_url}\n\nManage: {manage_url}' }],
    },
  },
  {
    key: 'thank_you',
    he: {
      name: 'תודה אחרי הפגישה',
      trigger: 'after_end',
      offsetMins: 60,
      steps: [{ id: 's1', action: 'email_attendee', subject: 'תודה על הפגישה, {invitee_first_name}', body: 'היי {invitee_first_name},\nתודה שנפגשנו היום. אם תרצו להמשיך, אפשר לקבוע שוב כאן: {reschedule_url}\n\n{host_name}' }],
    },
    en: {
      name: 'Thank you after meeting',
      trigger: 'after_end',
      offsetMins: 60,
      steps: [{ id: 's1', action: 'email_attendee', subject: 'Thanks for meeting, {invitee_first_name}', body: 'Hi {invitee_first_name},\nThanks for today. Book a follow up any time.\n\n{host_name}' }],
    },
  },
  {
    key: 'host_whatsapp',
    he: {
      name: 'התראה למארח ב-WhatsApp',
      trigger: 'booked',
      offsetMins: 0,
      steps: [{ id: 's1', action: 'whatsapp_host', subject: '', body: 'פגישה חדשה: {invitee_name} · {event_name} · {event_date} {event_time}' }],
    },
    en: {
      name: 'Notify host on WhatsApp',
      trigger: 'booked',
      offsetMins: 0,
      steps: [{ id: 's1', action: 'whatsapp_host', subject: '', body: 'New booking: {invitee_name} · {event_name} · {event_date} {event_time}' }],
    },
  },
]
