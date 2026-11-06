import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import { computeSlots, groupByDate, type SlotQuery } from './availability'

const weekly9to17 = [0, 1, 2, 3, 4].map(() => [{ start: '09:00', end: '17:00' }])
const week = [...weekly9to17, [], []] // Sun-Thu work, Fri+Sat off

function base(over: Partial<SlotQuery> = {}): SlotQuery {
  return {
    eventType: {
      id: 'e1',
      bufferBefore: 0,
      bufferAfter: 0,
      minNoticeMins: 0,
      window: { type: 'unlimited' },
      slotInterval: null,
      limits: {},
      firstSlotOnly: false,
      seats: null,
      preferred: [],
      ...(over.eventType as object),
    },
    schedule: { timezone: 'Asia/Jerusalem', weekly: week, overrides: [], ...(over.schedule as object) },
    duration: 30,
    // Sunday 2026-11-08 in Israel (UTC+2)
    from: '2026-11-07T22:00:00.000Z',
    to: '2026-11-08T22:00:00.000Z',
    now: '2026-11-01T00:00:00.000Z',
    busy: [],
    bookings: [],
    blocked: [],
    ...over,
    ...(over.eventType ? { eventType: { ...baseEt(), ...over.eventType } } : {}),
  } as SlotQuery
}
function baseEt() {
  return {
    id: 'e1',
    bufferBefore: 0,
    bufferAfter: 0,
    minNoticeMins: 0,
    window: { type: 'unlimited' as const },
    slotInterval: null,
    limits: {},
    firstSlotOnly: false,
    seats: null,
    preferred: [],
  }
}
const local = (iso: string, tz = 'Asia/Jerusalem') => DateTime.fromISO(iso).setZone(tz).toFormat('HH:mm')

describe('computeSlots', () => {
  it('generates slots inside working hours', () => {
    const s = computeSlots(base())
    expect(s.length).toBe(16)
    expect(local(s[0].start)).toBe('09:00')
    expect(local(s[s.length - 1].start)).toBe('16:30')
  })

  it('respects slot interval', () => {
    const s = computeSlots(base({ eventType: { ...baseEt(), slotInterval: 60 } }))
    expect(s.length).toBe(8)
  })

  it('returns nothing on a day off and honours overrides', () => {
    const fri = base({ from: '2026-11-12T22:00:00.000Z', to: '2026-11-13T22:00:00.000Z' })
    expect(computeSlots(fri)).toHaveLength(0)
    const withOv = base({
      from: '2026-11-12T22:00:00.000Z',
      to: '2026-11-13T22:00:00.000Z',
      schedule: { timezone: 'Asia/Jerusalem', weekly: week, overrides: [{ date: '2026-11-13', ranges: [{ start: '10:00', end: '11:00' }] }] },
    })
    expect(computeSlots(withOv).map((x) => local(x.start))).toEqual(['10:00', '10:30'])
    const off = base({ schedule: { timezone: 'Asia/Jerusalem', weekly: week, overrides: [{ date: '2026-11-08', ranges: [] }] } })
    expect(computeSlots(off)).toHaveLength(0)
  })

  it('applies minimum notice', () => {
    const s = computeSlots(base({ now: '2026-11-08T08:00:00.000Z', eventType: { ...baseEt(), minNoticeMins: 60 } }))
    // now = 10:00 local, +60 = 11:00
    expect(local(s[0].start)).toBe('11:00')
  })

  it('blocks busy times with buffers', () => {
    const s = computeSlots(
      base({
        busy: [{ start: '2026-11-08T08:00:00.000Z', end: '2026-11-08T09:00:00.000Z', source: 'google' }],
        eventType: { ...baseEt(), bufferAfter: 15, bufferBefore: 15 },
      }),
    )
    const times = s.map((x) => local(x.start))
    expect(times).not.toContain('09:30')
    expect(times).not.toContain('10:00')
    expect(times).not.toContain('10:30') // buffer before overlaps 11:00 end
    expect(times).toContain('09:00')
    expect(times).toContain('11:30')
  })

  it('handles seats', () => {
    const bookings = [
      { id: 'b1', eventTypeId: 'e1', start: '2026-11-08T07:00:00.000Z', end: '2026-11-08T07:30:00.000Z' },
      { id: 'b2', eventTypeId: 'e1', start: '2026-11-08T07:00:00.000Z', end: '2026-11-08T07:30:00.000Z' },
    ]
    const s3 = computeSlots(base({ bookings, eventType: { ...baseEt(), seats: 3 } }))
    expect(s3.find((x) => local(x.start) === '09:00')?.seatsLeft).toBe(1)
    const s2 = computeSlots(base({ bookings, eventType: { ...baseEt(), seats: 2 } }))
    expect(s2.find((x) => local(x.start) === '09:00')).toBeUndefined()
  })

  it('ignores the booking being rescheduled', () => {
    const bookings = [{ id: 'b1', eventTypeId: 'e1', start: '2026-11-08T07:00:00.000Z', end: '2026-11-08T07:30:00.000Z' }]
    expect(computeSlots(base({ bookings })).map((x) => local(x.start))).not.toContain('09:00')
    expect(computeSlots(base({ bookings, ignoreBookingId: 'b1' })).map((x) => local(x.start))).toContain('09:00')
  })

  it('enforces per day limit and first slot only', () => {
    const bookings = [{ id: 'b1', eventTypeId: 'e1', start: '2026-11-08T07:00:00.000Z', end: '2026-11-08T07:30:00.000Z' }]
    expect(computeSlots(base({ bookings, eventType: { ...baseEt(), limits: { perDay: 1 } } }))).toHaveLength(0)
    expect(computeSlots(base({ eventType: { ...baseEt(), firstSlotOnly: true } }))).toHaveLength(1)
  })

  it('respects hard blocks such as Shabbat', () => {
    const s = computeSlots(base({ blocked: [{ start: '2026-11-08T07:00:00.000Z', end: '2026-11-08T15:00:00.000Z' }] }))
    expect(s).toHaveLength(0)
  })

  it('handles rolling booking window', () => {
    const s = computeSlots(
      base({
        now: '2026-11-08T05:00:00.000Z',
        from: '2026-11-08T00:00:00.000Z',
        to: '2026-11-20T00:00:00.000Z',
        eventType: { ...baseEt(), window: { type: 'rolling', days: 1 } },
      }),
    )
    const days = new Set(s.map((x) => DateTime.fromISO(x.start).setZone('Asia/Jerusalem').toISODate()))
    expect([...days]).toEqual(['2026-11-08', '2026-11-09'])
  })

  it('marks preferred slots', () => {
    const s = computeSlots(base({ eventType: { ...baseEt(), preferred: [{ day: 0, start: '10:00', end: '11:00' }] } }))
    expect(s.filter((x) => x.preferred).map((x) => local(x.start))).toEqual(['10:00', '10:30'])
  })

  it('survives the Israel DST change (2026-10-25)', () => {
    // Sunday 2026-10-25 Israel falls back from UTC+3 to UTC+2 at 02:00
    const s = computeSlots(base({ from: '2026-10-24T21:00:00.000Z', to: '2026-10-25T22:00:00.000Z', now: '2026-10-01T00:00:00.000Z' }))
    expect(local(s[0].start)).toBe('09:00')
    expect(s[0].start).toBe('2026-10-25T07:00:00.000Z')
  })

  it('groups by invitee date across midnight', () => {
    const s = computeSlots(base())
    const ny = groupByDate(s, 'America/New_York')
    // 09:00 Israel = 02:00 New York, same date; 16:30 Israel = 09:30 New York
    expect([...ny.keys()]).toEqual(['2026-11-08'])
    const tokyo = groupByDate(s, 'Asia/Tokyo')
    // 09:00 IL = 16:00 Tokyo, 16:30 IL = 23:30 Tokyo, all on 11-08
    expect([...tokyo.keys()]).toEqual(['2026-11-08'])
    const auckland = groupByDate(s, 'Pacific/Auckland') // UTC+13: 09:00 IL = 20:00, 11:00 IL = 00:00 next day
    expect([...auckland.keys()]).toEqual(['2026-11-08', '2026-11-09'])
  })

  it('supports 45 minute offset zones for grouping', () => {
    const s = computeSlots(base())
    const g = groupByDate(s, 'Asia/Kathmandu')
    expect(g.size).toBeGreaterThan(0)
  })
})
