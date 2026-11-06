import { DateTime } from 'luxon'
import { nowISO, slugify, token, uid } from '../lib/id'
import type { Booking, EventType, PersonalLink, Poll, RoutingForm, Schedule, Team, User, Workflow } from '../lib/types'
import { WORKFLOW_PRESETS } from '../../supabase/functions/_shared/workflows'

export const BRAND_COLORS = ['#E4572E', '#14213D', '#7FA087', '#D9A441', '#5B6CA8', '#B5536B', '#2F7F7A']

export function guessTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jerusalem'
  } catch {
    return 'Asia/Jerusalem'
  }
}

export function newUser(id: string, email: string, name = ''): User {
  const base = (email.split('@')[0] || 'me').toLowerCase().replace(/[^a-z0-9]/g, '') || 'me'
  return {
    id,
    email,
    name: name || base,
    username: base,
    previousUsernames: [],
    bio: '',
    avatarUrl: '',
    timezone: guessTimezone(),
    locale: 'he',
    weekStart: 0,
    timeFormat: '24h',
    theme: 'system',
    brandColor: '#E4572E',
    phone: '',
    shabbat: { enabled: true, city: 'Jerusalem', blockHolidays: true, showHebrewDate: true },
    defaultScheduleId: '',
    blockedEmails: [],
    onboarded: false,
    createdAt: nowISO(),
  }
}

const r = (start: string, end: string) => ({ start, end })

export function newSchedule(ownerId: string, name = 'שעות עבודה', timezone = guessTimezone()): Schedule {
  // Israel default: Sunday to Thursday, Friday half day
  return {
    id: uid(),
    ownerId,
    name,
    timezone,
    weekly: [
      [r('09:00', '17:00')],
      [r('09:00', '17:00')],
      [r('09:00', '17:00')],
      [r('09:00', '17:00')],
      [r('09:00', '17:00')],
      [r('09:00', '12:00')],
      [],
    ],
    overrides: [],
  }
}

export function newEventType(ownerId: string, scheduleId: string, title = 'פגישה', duration = 30): EventType {
  return {
    id: uid(),
    ownerId,
    title,
    slug: slugify(title),
    description: '',
    color: '#E4572E',
    hidden: false,
    durations: [duration],
    defaultDuration: duration,
    locations: [{ type: 'meet' }],
    scheduleId,
    bufferBefore: 0,
    bufferAfter: 0,
    minNoticeMins: 120,
    window: { type: 'rolling', days: 60 },
    slotInterval: null,
    limits: {},
    firstSlotOnly: false,
    seats: null,
    showAttendees: false,
    requiresConfirmation: false,
    questions: [],
    redirectUrl: '',
    lockTimezone: false,
    preferred: [],
    position: 0,
    createdAt: nowISO(),
  }
}

export interface SeedData {
  user: User
  users: User[]
  kinds: { workflow: Workflow[]; routing_form: RoutingForm[]; personal_link: PersonalLink[]; team: Team[] }
  schedules: Schedule[]
  eventTypes: EventType[]
  bookings: Booking[]
  polls: Poll[]
}

export const DEMO_USER_ID = 'demo-host'

export function buildSeed(): SeedData {
  const user = newUser(DEMO_USER_ID, 'yonatan@example.com', 'יונתן בן דוד')
  user.username = 'yonatan'
  user.bio = 'מלווה צוותי מוצר וסטארטאפים. קבעו שיחה ונמצא יחד את הצעד הבא.'
  user.timezone = 'Asia/Jerusalem'
  user.phone = '0521234567'
  user.onboarded = true

  const work = newSchedule(user.id, 'שעות עבודה', 'Asia/Jerusalem')
  const evenings = newSchedule(user.id, 'ערבים', 'Asia/Jerusalem')
  evenings.weekly = [[r('19:00', '22:00')], [r('19:00', '22:00')], [], [r('19:00', '22:00')], [], [], []]
  user.defaultScheduleId = work.id

  const intro = newEventType(user.id, work.id, 'שיחת היכרות', 20)
  intro.slug = 'intro'
  intro.description = 'עשרים דקות להכיר, להבין מה אתם צריכים ולראות אם יש התאמה.'
  intro.durations = [15, 20, 30]
  intro.defaultDuration = 20
  intro.color = '#E4572E'
  intro.locations = [{ type: 'meet' }, { type: 'phone_host' }, { type: 'whatsapp' }]
  intro.preferred = [0, 1, 2, 3].map((d) => ({ day: d, start: '10:00', end: '12:00' }))
  intro.position = 0

  const consult = newEventType(user.id, work.id, 'פגישת ייעוץ', 60)
  consult.slug = 'consult'
  consult.description = 'שעה עבודה ממוקדת על אתגר אחד. נשלח סיכום ומשימות אחרי הפגישה.'
  consult.color = '#14213D'
  consult.bufferAfter = 15
  consult.requiresConfirmation = true
  consult.limits = { perDay: 3 }
  consult.locations = [{ type: 'meet' }, { type: 'in_person', value: 'רוטשילד 22, תל אביב' }]
  consult.questions = [
    { id: 'q1', type: 'select', label: 'מה הנושא העיקרי?', required: true, options: ['אסטרטגיית מוצר', 'גיוס', 'תמחור', 'אחר'] },
    { id: 'q2', type: 'textarea', label: 'ספרו בקצרה על האתגר', required: false, showIf: { questionId: 'q1', equals: 'אחר' } },
    { id: 'q3', type: 'url', label: 'אתר החברה', required: false },
  ]
  consult.position = 1

  const workshop = newEventType(user.id, evenings.id, 'סדנת ערב קבוצתית', 90)
  workshop.slug = 'workshop'
  workshop.description = 'סדנה קבוצתית בזום, עד 8 משתתפים.'
  workshop.color = '#7FA087'
  workshop.seats = 8
  workshop.showAttendees = false
  workshop.locations = [{ type: 'zoom', value: 'https://zoom.us/j/0000000000' }]
  workshop.position = 2

  const secret = newEventType(user.id, work.id, 'פגישת לקוח קיים', 45)
  secret.slug = 'clients'
  secret.hidden = true
  secret.color = '#D9A441'
  secret.position = 3

  const now = DateTime.now().setZone('Asia/Jerusalem')
  const at = (days: number, hh: number, mm = 0) => now.plus({ days }).set({ hour: hh, minute: mm, second: 0, millisecond: 0 })
  const nextWorkday = (d: number) => {
    let x = at(d, 10)
    while (x.weekday === 5 || x.weekday === 6) x = x.plus({ days: 1 })
    return Math.round(x.diff(now.startOf('day'), 'days').days)
  }
  const mk = (et: EventType, d: number, hh: number, mm: number, name: string, email: string, status: Booking['status'], extra: Partial<Booking> = {}): Booking => {
    const s = at(nextWorkday(d), hh, mm)
    return {
      id: uid(),
      token: token(),
      ownerId: user.id,
      eventTypeId: et.id,
      title: et.title,
      start: s.toUTC().toISO()!,
      end: s.plus({ minutes: et.defaultDuration }).toUTC().toISO()!,
      status,
      attendee: { name, email, phone: '0541112233', timezone: 'Asia/Jerusalem', locale: 'he', whatsappOptIn: true },
      guests: [],
      notes: '',
      answers: {},
      location: et.locations[0],
      noShow: false,
      internalNotes: '',
      history: [{ at: nowISO(), action: 'created', by: 'invitee' }],
      source: 'web',
      utm: {},
      emailsSent: ['booked'],
      createdAt: nowISO(),
      ...extra,
    }
  }
  const bookings = [
    mk(intro, 1, 10, 0, 'דנה לוי', 'dana@example.com', 'accepted'),
    mk(consult, 1, 14, 0, 'Michael Green', 'michael@example.com', 'accepted', { attendee: { name: 'Michael Green', email: 'michael@example.com', phone: '', timezone: 'Europe/London', locale: 'en', whatsappOptIn: false }, answers: { q1: 'תמחור', q3: 'https://acme.io' } }),
    mk(consult, 2, 11, 0, 'רוני כהן', 'roni@example.com', 'pending', { answers: { q1: 'גיוס' }, emailsSent: ['requested'] }),
    mk(intro, 3, 16, 0, 'אביגיל שרון', 'avigail@example.com', 'accepted'),
    mk(intro, -2, 10, 30, 'יואב מזרחי', 'yoav@example.com', 'accepted'),
    mk(consult, -5, 13, 0, 'נועה ברק', 'noa@example.com', 'accepted', { noShow: true }),
    mk(intro, -1, 15, 0, 'עומר פרץ', 'omer@example.com', 'cancelled', { cancelReason: 'התנגשות עם פגישה אחרת', emailsSent: ['booked', 'cancelled'] }),
    mk(intro, -8, 9, 30, 'דנה לוי', 'dana@example.com', 'accepted'),
  ]

  const pollStart = at(nextWorkday(4), 10)
  const poll: Poll = {
    id: uid(),
    ownerId: user.id,
    title: 'סנכרון רבעוני עם צוות השיווק',
    description: 'בחרו את כל המועדים שמתאימים לכם.',
    duration: 45,
    location: { type: 'meet' },
    options: [0, 1, 2, 3].map((i) => {
      const s = pollStart.plus({ days: Math.floor(i / 2), hours: (i % 2) * 4 })
      return { start: s.toUTC().toISO()!, end: s.plus({ minutes: 45 }).toUTC().toISO()! }
    }),
    voters: [
      { id: uid(), name: 'מיכל', email: 'michal@example.com', votes: ['yes', 'no', 'yes', 'maybe'], at: nowISO() },
      { id: uid(), name: 'אלון', email: 'alon@example.com', votes: ['yes', 'yes', 'maybe', 'no'], at: nowISO() },
    ],
    status: 'open',
    chosenIndex: null,
    createdAt: nowISO(),
  }

  intro.recurring = null
  consult.price = { amount: 450, currency: 'ILS', mode: 'deposit', depositAmount: 150, paymentLink: '', refundHours: 24 }
  consult.autoDeclineHours = 48
  workshop.recurring = { freq: 'weekly', maxCount: 6 }

  // second host + a team for round robin / collective demos
  const noa = newUser('demo-noa', 'noa@example.com', 'נועה שגיא')
  noa.username = 'noa'
  noa.bio = 'מעצבת מוצר. אוהבת שיחות קצרות וממוקדות.'
  noa.timezone = 'Asia/Jerusalem'
  noa.onboarded = true
  noa.brandColor = '#7FA087'
  const noaWork = newSchedule(noa.id, 'שעות עבודה', 'Asia/Jerusalem')
  noaWork.weekly = [[r('10:00', '18:00')], [r('10:00', '18:00')], [r('12:00', '18:00')], [r('10:00', '18:00')], [r('10:00', '14:00')], [], []]
  noa.defaultScheduleId = noaWork.id
  const noaIntro = newEventType(noa.id, noaWork.id, 'שיחת עיצוב', 30)
  noaIntro.slug = 'design'
  noaIntro.color = '#7FA087'

  const team: Team = {
    id: 'team-studio',
    ownerId: user.id,
    name: 'סטודיו מוצר',
    slug: 'studio',
    bio: 'צוות ייעוץ מוצר ועיצוב. קובעים עם מי שפנוי.',
    members: [
      { userId: user.id, role: 'owner', accepted: true },
      { userId: noa.id, role: 'member', accepted: true },
    ],
    createdAt: nowISO(),
  }
  const rr = newEventType(user.id, work.id, 'שיחת אבחון מוצר', 30)
  rr.slug = 'discovery'
  rr.teamId = team.id
  rr.schedulingType = 'round_robin'
  rr.hosts = [
    { userId: user.id, priority: 2, weight: 50 },
    { userId: noa.id, priority: 2, weight: 50 },
  ]
  rr.color = '#5B6CA8'
  rr.description = 'נשבץ אתכם עם מי שפנוי מהצוות.'
  rr.position = 10
  const collective = newEventType(user.id, work.id, 'פגישת צוות משותפת', 45)
  collective.slug = 'together'
  collective.teamId = team.id
  collective.schedulingType = 'collective'
  collective.hosts = rr.hosts.map((h) => ({ ...h }))
  collective.color = '#B5536B'
  collective.description = 'שנינו בפגישה. מוצגים רק זמנים ששנינו פנויים.'
  collective.position = 11

  const preset = WORKFLOW_PRESETS[0].he
  const workflow: Workflow = { id: uid(), ownerId: user.id, active: true, eventTypeIds: [], createdAt: nowISO(), ...preset, steps: preset.steps.map((x) => ({ ...x })) }
  const form: RoutingForm = {
    id: uid(),
    ownerId: user.id,
    title: 'במה נוכל לעזור?',
    description: 'שתי שאלות ונכוון אתכם לפגישה הנכונה.',
    slug: 'start',
    fields: [
      { id: 'name', type: 'text', label: 'שם', required: true },
      { id: 'email', type: 'email', label: 'מייל', required: true },
      { id: 'need', type: 'select', label: 'מה אתם צריכים?', required: true, options: ['ייעוץ אסטרטגי', 'היכרות ראשונה', 'עיצוב', 'סתם שאלה'] },
    ],
    rules: [
      { id: uid(), match: 'all', conditions: [{ fieldId: 'need', op: 'equals', value: 'ייעוץ אסטרטגי' }], target: { type: 'event', eventTypeId: consult.id } },
      { id: uid(), match: 'all', conditions: [{ fieldId: 'need', op: 'equals', value: 'עיצוב' }], target: { type: 'event', eventTypeId: rr.id, teamSlug: 'studio' } },
      { id: uid(), match: 'all', conditions: [{ fieldId: 'need', op: 'equals', value: 'סתם שאלה' }], target: { type: 'message', text: 'מעולה, כתבו לנו ל-hello@example.com ונחזור אליכם.' } },
    ],
    fallback: { type: 'event', eventTypeId: intro.id },
    responses: [],
    createdAt: nowISO(),
  }
  const personal: PersonalLink = { id: uid(), ownerId: user.id, slug: 'dana', eventTypeId: intro.id, name: 'דנה לוי', email: 'dana@example.com', greeting: 'היי דנה, שמח שנדבר. בחרי זמן שנוח לך.', createdAt: nowISO() }

  return {
    user,
    users: [user, noa],
    kinds: { workflow: [workflow], routing_form: [form], personal_link: [personal], team: [team] },
    schedules: [work, evenings, noaWork],
    eventTypes: [intro, consult, workshop, secret, noaIntro, rr, collective],
    bookings,
    polls: [poll],
  }
}
