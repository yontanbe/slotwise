import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { DateTime } from 'luxon'
import type { Locale } from '../lib/types'

interface I18n {
  locale: Locale
  dir: 'rtl' | 'ltr'
  setLocale: (l: Locale) => void
  /** bilingual inline string */
  L: (he: string, en: string) => string
  hour12: boolean
  setHour12: (v: boolean) => void
  fmtTime: (iso: string, tz: string) => string
  fmtDate: (iso: string, tz: string, opts?: Intl.DateTimeFormatOptions) => string
  fmtRange: (start: string, end: string, tz: string) => string
  weekdayShort: (i: number) => string
  intl: string
}

const Ctx = createContext<I18n | null>(null)
const LS = 'slotwise:locale'

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(LS)
    if (saved === 'he' || saved === 'en') return saved
  } catch {
    /* ignore */
  }
  const q = new URLSearchParams(window.location.hash.split('?')[1] || '').get('lang')
  if (q === 'en' || q === 'he') return q
  return 'he'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale)
  const [hour12, setHour12] = useState(false)
  const dir = locale === 'he' ? 'rtl' : 'ltr'
  const intl = locale === 'he' ? 'he-IL' : 'en-US'

  useEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dir = dir
  }, [locale, dir])

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
    try {
      localStorage.setItem(LS, l)
    } catch {
      /* ignore */
    }
  }, [])

  const value = useMemo<I18n>(() => {
    const L = (he: string, en: string) => (locale === 'he' ? he : en)
    const fmtTime = (iso: string, tz: string) =>
      DateTime.fromISO(iso).setZone(tz).setLocale(intl).toLocaleString({ hour: '2-digit', minute: '2-digit', hourCycle: hour12 ? 'h12' : 'h23' })
    const fmtDate = (iso: string, tz: string, opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' }) =>
      DateTime.fromISO(iso).setZone(tz).setLocale(intl).toLocaleString(opts)
    const fmtRange = (s: string, e: string, tz: string) => `${fmtTime(s, tz)} – ${fmtTime(e, tz)}`
    const weekdayShort = (i: number) =>
      DateTime.fromISO('2026-11-01').plus({ days: i }).setLocale(intl).toFormat(locale === 'he' ? 'ccc' : 'ccc')
    return { locale, dir, setLocale, L, hour12, setHour12, fmtTime, fmtDate, fmtRange, weekdayShort, intl }
  }, [locale, dir, setLocale, hour12, intl])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useI18n() {
  const v = useContext(Ctx)
  if (!v) throw new Error('I18nProvider missing')
  return v
}
