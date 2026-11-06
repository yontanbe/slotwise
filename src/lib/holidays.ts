import { HDate, HebrewCalendar, Location, flags } from '@hebcal/core'
import { DateTime } from 'luxon'
import type { ISO, ShabbatSettings } from './types'

export interface City {
  key: string
  he: string
  en: string
  lat: number
  lng: number
  tz: string
  il: boolean
}

export const CITIES: City[] = [
  { key: 'Jerusalem', he: 'ירושלים', en: 'Jerusalem', lat: 31.7683, lng: 35.2137, tz: 'Asia/Jerusalem', il: true },
  { key: 'Tel Aviv', he: 'תל אביב', en: 'Tel Aviv', lat: 32.0853, lng: 34.7818, tz: 'Asia/Jerusalem', il: true },
  { key: 'Haifa', he: 'חיפה', en: 'Haifa', lat: 32.794, lng: 34.9896, tz: 'Asia/Jerusalem', il: true },
  { key: 'Beer Sheva', he: 'באר שבע', en: 'Beer Sheva', lat: 31.252, lng: 34.7915, tz: 'Asia/Jerusalem', il: true },
  { key: 'Petach Tikvah', he: 'פתח תקווה', en: 'Petah Tikva', lat: 32.0871, lng: 34.8875, tz: 'Asia/Jerusalem', il: true },
  { key: 'Netanya', he: 'נתניה', en: 'Netanya', lat: 32.3215, lng: 34.8532, tz: 'Asia/Jerusalem', il: true },
  { key: 'Raanana', he: 'רעננה', en: "Ra'anana", lat: 32.1848, lng: 34.8713, tz: 'Asia/Jerusalem', il: true },
  { key: 'Modiin', he: 'מודיעין', en: "Modi'in", lat: 31.8969, lng: 35.0095, tz: 'Asia/Jerusalem', il: true },
  { key: 'Ashdod', he: 'אשדוד', en: 'Ashdod', lat: 31.8044, lng: 34.6553, tz: 'Asia/Jerusalem', il: true },
  { key: 'Rishon LeZion', he: 'ראשון לציון', en: 'Rishon LeZion', lat: 31.973, lng: 34.7925, tz: 'Asia/Jerusalem', il: true },
  { key: 'Bnei Brak', he: 'בני ברק', en: 'Bnei Brak', lat: 32.0807, lng: 34.8338, tz: 'Asia/Jerusalem', il: true },
  { key: 'Eilat', he: 'אילת', en: 'Eilat', lat: 29.5577, lng: 34.9519, tz: 'Asia/Jerusalem', il: true },
  { key: 'Tiberias', he: 'טבריה', en: 'Tiberias', lat: 32.7959, lng: 35.531, tz: 'Asia/Jerusalem', il: true },
  { key: 'New York', he: 'ניו יורק', en: 'New York', lat: 40.7128, lng: -74.006, tz: 'America/New_York', il: false },
  { key: 'Los Angeles', he: 'לוס אנג׳לס', en: 'Los Angeles', lat: 34.0522, lng: -118.2437, tz: 'America/Los_Angeles', il: false },
  { key: 'London', he: 'לונדון', en: 'London', lat: 51.5074, lng: -0.1278, tz: 'Europe/London', il: false },
  { key: 'Paris', he: 'פריז', en: 'Paris', lat: 48.8566, lng: 2.3522, tz: 'Europe/Paris', il: false },
  { key: 'Berlin', he: 'ברלין', en: 'Berlin', lat: 52.52, lng: 13.405, tz: 'Europe/Berlin', il: false },
  { key: 'Toronto', he: 'טורונטו', en: 'Toronto', lat: 43.6532, lng: -79.3832, tz: 'America/Toronto', il: false },
]

export function cityLocation(key: string): Location {
  const c = CITIES.find((x) => x.key === key) ?? CITIES[0]
  if (c.key === 'Jerusalem') return Location.lookup('Jerusalem')!
  return new Location(c.lat, c.lng, c.il, c.tz, c.en, c.il ? 'IL' : undefined)
}

export interface BlockSpan {
  start: ISO
  end: ISO
  kind: 'shabbat' | 'holiday'
  label: string
}

/** Spans from candle lighting to havdalah within [from, to]. */
export function shabbatBlocks(settings: ShabbatSettings, from: ISO, to: ISO): BlockSpan[] {
  if (!settings.enabled && !settings.blockHolidays) return []
  const c = CITIES.find((x) => x.key === settings.city) ?? CITIES[0]
  const loc = cityLocation(settings.city)
  const start = DateTime.fromISO(from).minus({ days: 3 }).toJSDate()
  const end = DateTime.fromISO(to).plus({ days: 3 }).toJSDate()
  const events = HebrewCalendar.calendar({
    start,
    end,
    candlelighting: true,
    location: loc,
    il: c.il,
    noMinorFast: true,
    noModern: true,
    noRoshChodesh: true,
    noSpecialShabbat: true,
    sedrot: false,
  })
  const spans: BlockSpan[] = []
  let open: { at: Date; label: string } | null = null
  let pendingLabel = ''
  for (const ev of events) {
    const f = ev.getFlags()
    const desc = ev.getDesc()
    const time: Date | undefined = (ev as unknown as { eventTime?: Date }).eventTime
    if (desc !== 'Candle lighting' && desc !== 'Havdalah' && f & (flags.CHAG | flags.EREV)) {
      pendingLabel = ev.render('he')
    }
    if (desc === 'Candle lighting' && time) {
      if (!open) open = { at: time, label: pendingLabel }
    } else if (desc === 'Havdalah' && time && open) {
      const s = DateTime.fromJSDate(open.at)
      const e = DateTime.fromJSDate(time)
      let hasSaturday = false
      for (let d = s.startOf('day'); d <= e; d = d.plus({ days: 1 })) if (d.weekday === 6) hasSaturday = true
      const isHoliday = !!open.label || !hasSaturday
      const kind = hasSaturday && !isHoliday ? 'shabbat' : 'holiday'
      const allowed = (hasSaturday && settings.enabled) || (isHoliday && settings.blockHolidays)
      if (allowed) spans.push({ start: s.toUTC().toISO()!, end: e.toUTC().toISO()!, kind, label: open.label || 'שבת' })
      open = null
      pendingLabel = ''
    }
  }
  return spans.filter((s) => s.end > from && s.start < to)
}

export function hebrewDate(date: Date, locale: 'he' | 'en'): string {
  const hd = new HDate(date)
  return locale === 'he' ? hd.renderGematriya(true) : hd.render('en')
}
