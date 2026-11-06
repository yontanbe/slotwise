import { DateTime, Interval } from 'luxon'

// Structural types so this file runs unchanged in the browser and in Deno (Edge Functions).
type ISO = string
type DateStr = string
type HHMM = string
export interface TimeRange {
  start: HHMM
  end: HHMM
}
interface BusyBlock {
  start: ISO
  end: ISO
  source?: string
  eventTypeId?: string
}
interface Schedule {
  timezone: string
  weekly: TimeRange[][]
  overrides: { date: DateStr; ranges: TimeRange[] }[]
}
interface EventType {
  id: string
  bufferBefore: number
  bufferAfter: number
  minNoticeMins: number
  window: { type: 'rolling'; days: number } | { type: 'range'; start: DateStr; end: DateStr } | { type: 'unlimited' }
  slotInterval: number | null
  limits: { perDay?: number | null; perWeek?: number | null; perMonth?: number | null; durationPerDay?: number | null }
  firstSlotOnly: boolean
  seats: number | null
  preferred: { day: number; start: HHMM; end: HHMM }[]
}

export interface Slot {
  start: ISO
  end: ISO
  preferred: boolean
  seatsLeft?: number
}

export interface BookingLite {
  id: string
  eventTypeId: string
  start: ISO
  end: ISO
}

export interface SlotQuery {
  eventType: Pick<
    EventType,
    | 'id'
    | 'bufferBefore'
    | 'bufferAfter'
    | 'minNoticeMins'
    | 'window'
    | 'slotInterval'
    | 'limits'
    | 'firstSlotOnly'
    | 'seats'
    | 'preferred'
  >
  schedule: Pick<Schedule, 'timezone' | 'weekly' | 'overrides'>
  duration: number
  from: ISO
  to: ISO
  now: ISO
  /** external busy blocks (Google) */
  busy: BusyBlock[]
  /** all active (accepted / pending) bookings of the host */
  bookings: BookingLite[]
  /** hard blocked spans, e.g. Shabbat and holidays */
  blocked: { start: ISO; end: ISO }[]
  /** booking being rescheduled, ignored for conflicts */
  ignoreBookingId?: string
  weekStart?: 0 | 1 | 6
  /** travel periods: on these dates (inclusive) the weekly hours apply in another timezone */
  travel?: { start: DateStr; end: DateStr; timezone: string }[]
}

/** luxon weekday (1 Mon..7 Sun) to our index (0 Sun..6 Sat) */
export const dayIndex = (dt: DateTime) => dt.weekday % 7

export function parseHHMM(day: DateTime, hhmm: HHMM): DateTime {
  if (hhmm === '24:00') return day.plus({ days: 1 }).startOf('day')
  const [h, m] = hhmm.split(':').map(Number)
  return day.set({ hour: h, minute: m, second: 0, millisecond: 0 })
}

export function rangesForDate(schedule: SlotQuery['schedule'], day: DateTime): TimeRange[] {
  const date = day.toISODate()
  const ov = schedule.overrides.find((o) => o.date === date)
  if (ov) return ov.ranges
  return schedule.weekly[dayIndex(day)] ?? []
}

function startOfWeek(dt: DateTime, weekStart: number): DateTime {
  const d = dt.startOf('day')
  const diff = (dayIndex(d) - weekStart + 7) % 7
  return d.minus({ days: diff })
}

function windowEnd(q: SlotQuery, now: DateTime): DateTime | null {
  const w = q.eventType.window
  const tz = q.schedule.timezone
  if (w.type === 'rolling') return now.setZone(tz).startOf('day').plus({ days: w.days + 1 })
  if (w.type === 'range') return DateTime.fromISO(w.end, { zone: tz }).plus({ days: 1 }).startOf('day')
  return null
}

function windowStart(q: SlotQuery): DateTime | null {
  const w = q.eventType.window
  if (w.type === 'range') return DateTime.fromISO(w.start, { zone: q.schedule.timezone }).startOf('day')
  return null
}

export function computeSlots(q: SlotQuery): Slot[] {
  const tz = q.schedule.timezone
  const et = q.eventType
  const now = DateTime.fromISO(q.now, { zone: 'utc' })
  const from = DateTime.fromISO(q.from, { zone: 'utc' })
  const to = DateTime.fromISO(q.to, { zone: 'utc' })
  if (!from.isValid || !to.isValid || to <= from || q.duration <= 0) return []

  const earliest = now.plus({ minutes: et.minNoticeMins })
  const wEnd = windowEnd(q, now)
  const wStart = windowStart(q)
  const step = Math.max(5, et.slotInterval || q.duration)
  const weekStart = q.weekStart ?? 0

  const bookings = q.bookings.filter((b) => b.id !== q.ignoreBookingId)
  const ms = (iso: ISO) => DateTime.fromISO(iso).toMillis()

  // Conflict intervals, as millis, expanded by this event's buffers on the candidate side
  const external = q.busy.map((b) => [ms(b.start), ms(b.end)] as const)
  const blocked = q.blocked.map((b) => [ms(b.start), ms(b.end)] as const)
  const bookingSpans = bookings.map((b) => ({ s: ms(b.start), e: ms(b.end), b }))

  // per host-day stats for limits, only for this event type
  const sameType = bookings.filter((b) => b.eventTypeId === et.id)
  const hostDay = (iso: ISO) => DateTime.fromISO(iso).setZone(tz).toISODate()!
  const perDay = new Map<string, { count: number; minutes: number }>()
  for (const b of sameType) {
    const key = hostDay(b.start)
    const cur = perDay.get(key) ?? { count: 0, minutes: 0 }
    cur.count += 1
    cur.minutes += (ms(b.end) - ms(b.start)) / 60000
    perDay.set(key, cur)
  }
  const countIn = (start: DateTime, end: DateTime) =>
    sameType.filter((b) => {
      const t = ms(b.start)
      return t >= start.toMillis() && t < end.toMillis()
    }).length

  const out: Slot[] = []
  let day = from.setZone(tz).startOf('day').minus({ days: 1 })
  const lastDay = to.setZone(tz).startOf('day').plus({ days: 1 })

  while (day <= lastDay) {
    const dateKey = day.toISODate()!
    const ranges = rangesForDate(q.schedule, day)
    const daySlots: Slot[] = []
    const stats = perDay.get(dateKey) ?? { count: 0, minutes: 0 }
    const lim = et.limits || {}
    let dayAllowed = true
    if (lim.perDay && stats.count >= lim.perDay) dayAllowed = false
    if (dayAllowed && lim.perWeek) {
      const ws = startOfWeek(day, weekStart)
      if (countIn(ws, ws.plus({ days: 7 })) >= lim.perWeek) dayAllowed = false
    }
    if (dayAllowed && lim.perMonth) {
      const ms0 = day.startOf('month')
      if (countIn(ms0, ms0.plus({ months: 1 })) >= lim.perMonth) dayAllowed = false
    }
    if (dayAllowed && lim.durationPerDay && stats.minutes + q.duration > lim.durationPerDay) dayAllowed = false

    const trip = (q.travel || []).find((t) => dateKey >= t.start && dateKey <= t.end)
    const localDay = trip ? DateTime.fromISO(dateKey, { zone: trip.timezone }).startOf('day') : day
    if (dayAllowed) {
      for (const r of ranges) {
        const rs = parseHHMM(localDay, r.start)
        const re = parseHHMM(localDay, r.end)
        if (!rs.isValid || !re.isValid || re <= rs) continue
        for (let s = rs; s.plus({ minutes: q.duration }) <= re; s = s.plus({ minutes: step })) {
          const e = s.plus({ minutes: q.duration })
          const sMs = s.toMillis()
          const eMs = e.toMillis()
          if (sMs < from.toMillis() || sMs >= to.toMillis()) continue
          if (s < earliest) continue
          if (wEnd && e > wEnd) continue
          if (wStart && s < wStart) continue
          const bs = sMs - et.bufferBefore * 60000
          const be = eMs + et.bufferAfter * 60000
          if (blocked.some(([a, b]) => sMs < b && eMs > a)) continue
          if (external.some(([a, b]) => bs < b && be > a)) continue

          let seatsLeft: number | undefined
          let conflict = false
          if (et.seats && et.seats > 0) {
            const taken = bookingSpans.filter((x) => x.b.eventTypeId === et.id && x.s === sMs).length
            if (taken >= et.seats) continue
            seatsLeft = et.seats - taken
            conflict = bookingSpans.some(
              (x) => !(x.b.eventTypeId === et.id && x.s === sMs) && bs < x.e && be > x.s,
            )
          } else {
            conflict = bookingSpans.some((x) => bs < x.e && be > x.s)
          }
          if (conflict) continue
          if (lim.durationPerDay && stats.minutes + q.duration > lim.durationPerDay) continue

          const di = dayIndex(s)
          const minutes = s.hour * 60 + s.minute
          const preferred = (et.preferred || []).some((p) => {
            if (p.day !== di) return false
            const [ph, pm] = p.start.split(':').map(Number)
            const [eh, em] = p.end.split(':').map(Number)
            return minutes >= ph * 60 + pm && minutes < eh * 60 + em
          })
          daySlots.push({ start: s.toUTC().toISO()!, end: e.toUTC().toISO()!, preferred, seatsLeft })
        }
      }
    }
    daySlots.sort((a, b) => a.start.localeCompare(b.start))
    out.push(...(et.firstSlotOnly ? daySlots.slice(0, 1) : daySlots))
    day = day.plus({ days: 1 })
  }

  // de-duplicate (overlapping ranges) and sort
  const seen = new Set<string>()
  return out
    .filter((s) => (seen.has(s.start) ? false : (seen.add(s.start), true)))
    .sort((a, b) => a.start.localeCompare(b.start))
}

export function groupByDate(slots: Slot[], tz: string): Map<DateStr, Slot[]> {
  const m = new Map<DateStr, Slot[]>()
  for (const s of slots) {
    const k = DateTime.fromISO(s.start).setZone(tz).toISODate()!
    const arr = m.get(k) ?? []
    arr.push(s)
    m.set(k, arr)
  }
  return m
}

export function overlaps(a: { start: ISO; end: ISO }, b: { start: ISO; end: ISO }) {
  const ia = Interval.fromDateTimes(DateTime.fromISO(a.start), DateTime.fromISO(a.end))
  const ib = Interval.fromDateTimes(DateTime.fromISO(b.start), DateTime.fromISO(b.end))
  return ia.overlaps(ib)
}
