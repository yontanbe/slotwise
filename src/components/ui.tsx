import { cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { DateTime } from 'luxon'
import { useI18n } from '../i18n'
import type { BookingStatus } from '../lib/types'

/* ---------- logo ---------- */
export function Logo({ size = 22, mono = false }: { size?: number; mono?: boolean }) {
  return (
    <span className="row" style={{ gap: 8, direction: 'ltr' }}>
      <svg width={size * 1.3} height={size} viewBox="0 0 52 40" aria-hidden>
        <path
          d="M4 6h44v8a6 6 0 0 0 0 12v8H4v-8a6 6 0 0 0 0-12z"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <path d="M18 9v22" stroke="currentColor" strokeWidth="2.2" strokeDasharray="3 3" />
        <circle cx="33" cy="20" r="6" fill={mono ? 'currentColor' : 'var(--accent)'} />
      </svg>
      <span style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: size, letterSpacing: '-0.02em' }}>Slotwise</span>
    </span>
  )
}

/* ---------- icons (line, 1.6 stroke) ---------- */
const paths: Record<string, string> = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  cards: 'M4 7h16v12H4zM7 4h10',
  clock: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  poll: 'M5 20V10M12 20V4M19 20v-7',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M17 3a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3',
  chart: 'M4 20h16M7 16v-5M12 16V7M17 16v-8',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.6 15H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9.7 4.3V4a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z',
  plug: 'M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12l5 5L20 7',
  chevL: 'M15 6l-6 6 6 6',
  chevR: 'M9 6l6 6-6 6',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.2 3.6M6.6 6.6A17 17 0 0 0 2 12s4 7 10 7a9.6 9.6 0 0 0 4.4-1',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  phone: 'M5 4h4l2 5-3 2a12 12 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 6a2 2 0 0 1 2-2z',
  video: 'M3 7h12v10H3zM15 10l6-3v10l-6-3',
  pin: 'M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
  upload: 'M12 21V9M7 14l5-5 5 5M4 3h16',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  whatsapp: 'M4 20l1.3-4A8 8 0 1 1 8 18.7zM9 9c0 3 3 6 6 6l1-1.5-2-1-1 1c-1 0-2.5-1.5-2.5-2.5l1-1-1-2z',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  inbox: 'M3 13h5l1 3h6l1-3h5M3 13l3-8h12l3 8v6H3z',
  arrow: 'M5 12h14M13 6l6 6-6 6',
}
export function Icon({ name, size = 18, stroke = 1.6 }: { name: keyof typeof paths | string; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flex: 'none' }}>
      <path d={paths[name] || ''} />
    </svg>
  )
}

/* ---------- basics ---------- */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="toggle" onClick={() => onChange(!checked)} />
}

const LABELABLE = new Set(['input', 'select', 'textarea'])
/** Label + control. A single native control child gets an id so the label is programmatically tied to it. */
export function Field({ label, hint, required, children, htmlFor }: { label: ReactNode; hint?: ReactNode; required?: boolean; children: ReactNode; htmlFor?: string }) {
  const auto = useId()
  let target = htmlFor
  let content = children
  if (!htmlFor && isValidElement(children) && typeof children.type === 'string' && LABELABLE.has(children.type)) {
    const props = children.props as { id?: string }
    target = props.id ?? auto
    content = cloneElement(children as ReactElement<{ id?: string }>, { id: target })
  }
  return (
    <div className="field" role={target ? undefined : 'group'} aria-label={target || typeof label !== 'string' ? undefined : label}>
      <label className="label" htmlFor={target}>
        {label}
        {required && <span className="req">*</span>}
      </label>
      {content}
      {hint && <span className="hint">{hint}</span>}
    </div>
  )
}

export function Avatar({ name, src, size = 44 }: { name: string; src?: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
  if (src) return <img className="avatar" src={src} alt="" style={{ ['--s' as string]: `${size}px` }} />
  return (
    <span className="avatar" style={{ ['--s' as string]: `${size}px` }} aria-hidden>
      {initials}
    </span>
  )
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

/** Keeps keyboard focus inside a container, focuses the first control and restores focus on close. */
export function useFocusTrap(ref: React.RefObject<HTMLElement>, active: boolean, initial?: string) {
  useEffect(() => {
    if (!active || !ref.current) return
    const root = ref.current
    const opener = document.activeElement as HTMLElement | null
    const first = (initial && (root.querySelector(initial) as HTMLElement | null)) || (root.querySelector(FOCUSABLE) as HTMLElement | null)
    ;(first ?? root).focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.offsetParent !== null)
      if (!items.length) return
      const a = items[0]
      const z = items[items.length - 1]
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault()
        z.focus()
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault()
        a.focus()
      } else if (!root.contains(document.activeElement)) {
        e.preventDefault()
        a.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
}

export function Modal({ open, onClose, children, wide }: { open: boolean; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [labelId, setLabelId] = useState<string | undefined>()
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, onClose])
  useFocusTrap(ref, open)
  useEffect(() => {
    // name the dialog after its first heading
    const h = ref.current?.querySelector('h1,h2,h3')
    if (h) {
      if (!h.id) h.id = 'dlg-' + Math.random().toString(36).slice(2, 8)
      setLabelId(h.id)
    }
  }, [open, children])
  if (!open) return null
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={labelId}>
        {children}
      </div>
    </div>
  )
}

export function Empty({ img = 'empty', title, text, action }: { img?: string; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty rise">
      <div className="illus-frame">
        <img className="illus" src={`./illustrations/${img}.webp`} alt="" loading="lazy" />
      </div>
      <h3>{title}</h3>
      {text && <p className="muted" style={{ maxWidth: 380 }}>{text}</p>}
      {action}
    </div>
  )
}

export function StatusStamp({ status, noShow }: { status: BookingStatus; noShow?: boolean }) {
  const { L } = useI18n()
  if (noShow) return <span className="stamp bad">{L('לא הגיע', 'No show')}</span>
  const map: Record<BookingStatus, [string, string]> = {
    accepted: ['ok', L('מאושר', 'Booked')],
    pending: ['wait', L('ממתין', 'Pending')],
    cancelled: ['mute', L('בוטל', 'Cancelled')],
    rejected: ['bad', L('נדחה', 'Declined')],
  }
  const [cls, txt] = map[status]
  return <span className={`stamp ${cls}`}>{txt}</span>
}

/* ---------- toast ---------- */
interface ToastItem {
  id: number
  text: string
  err?: boolean
}
const ToastCtx = createContext<(text: string, err?: boolean) => void>(() => {})
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const push = useCallback((text: string, err?: boolean) => {
    const id = Date.now() + Math.random()
    setItems((x) => [...x, { id, text, err }])
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 2800)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast${t.err ? ' err' : ''}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
export const useToast = () => useContext(ToastCtx)

export function useCopy() {
  const toast = useToast()
  const { L } = useI18n()
  return useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text)
        toast(L('הועתק', 'Copied'))
      } catch {
        window.prompt(L('העתיקו את הקישור', 'Copy the link'), text)
      }
    },
    [toast, L],
  )
}

/* ---------- month calendar ---------- */
export function MonthCalendar({
  month,
  onMonth,
  selected,
  onSelect,
  isAvailable,
  isMarked,
  isBlocked,
  pickAny,
  weekStart = 0,
  minMonth,
}: {
  month: DateTime // any day in month (in display tz)
  onMonth: (m: DateTime) => void
  selected?: string | null
  onSelect: (iso: string) => void
  isAvailable?: (iso: string) => boolean
  isMarked?: (iso: string) => boolean
  isBlocked?: (iso: string) => boolean
  pickAny?: boolean
  weekStart?: number
  minMonth?: DateTime
}) {
  const { L, intl, weekdayShort, dir } = useI18n()
  const first = month.startOf('month')
  const pad = (first.weekday % 7 - weekStart + 7) % 7
  const days = first.daysInMonth ?? 30
  const today = DateTime.now().setZone(month.zone).toISODate()
  const cells = useMemo(() => {
    const arr: (string | null)[] = Array(pad).fill(null)
    for (let i = 0; i < days; i++) arr.push(first.plus({ days: i }).toISODate())
    return arr
  }, [first, pad, days])
  const canPrev = !minMonth || first > minMonth.startOf('month')
  return (
    <div className="month">
      <div className="month-head">
        <div className="month-title">{first.setLocale(intl).toFormat('LLLL yyyy')}</div>
        <div className="row" style={{ gap: 6 }}>
          <button className="icon-btn" disabled={!canPrev} onClick={() => onMonth(first.minus({ months: 1 }))} aria-label={L('חודש קודם', 'Previous month')}>
            <Icon name={dir === 'rtl' ? 'chevR' : 'chevL'} />
          </button>
          <button className="icon-btn" onClick={() => onMonth(first.plus({ months: 1 }))} aria-label={L('חודש הבא', 'Next month')}>
            <Icon name={dir === 'rtl' ? 'chevL' : 'chevR'} />
          </button>
        </div>
      </div>
      <div className="month-grid">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="month-dow">
            {weekdayShort((i + weekStart) % 7)}
          </div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={'p' + i} className="month-day pad" />
          const avail = isAvailable?.(d)
          const cls = ['month-day', avail && 'avail', pickAny && 'pickable', selected === d && 'selected', d === today && 'today', isMarked?.(d) && 'marked', isBlocked?.(d) && 'blocked']
            .filter(Boolean)
            .join(' ')
          const clickable = avail || pickAny
          return (
            <button
              key={d}
              data-date={d}
              className={cls}
              disabled={!clickable}
              onClick={() => clickable && onSelect(d)}
              aria-pressed={selected === d}
              aria-label={DateTime.fromISO(d).setLocale(intl).toLocaleString({ weekday: 'long', day: 'numeric', month: 'long' }) + (avail ? '' : clickable ? '' : ` · ${L('לא זמין', 'unavailable')}`)}
            >
              {Number(d.slice(8))}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ---------- timezone picker ---------- */
const COMMON_TZ = [
  'Asia/Jerusalem',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'America/Sao_Paulo',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Kathmandu',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC',
]
export function allTimezones(): string[] {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone')
    if (list?.length) return Array.from(new Set([...COMMON_TZ, ...list]))
  } catch {
    /* ignore */
  }
  return COMMON_TZ
}
export function tzLabel(tz: string) {
  const off = DateTime.now().setZone(tz).toFormat('ZZ')
  return `${tz.replace(/_/g, ' ')} (GMT${off})`
}
export function TimezoneSelect({ value, onChange, className = 'select', label }: { value: string; onChange: (tz: string) => void; className?: string; label?: string }) {
  const list = useMemo(allTimezones, [])
  const { L } = useI18n()
  return (
    <select className={className} dir="ltr" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label ?? L('אזור זמן', 'Timezone')}>
      {!list.includes(value) && <option value={value}>{tzLabel(value)}</option>}
      {list.map((tz) => (
        <option key={tz} value={tz}>
          {tzLabel(tz)}
        </option>
      ))}
    </select>
  )
}
