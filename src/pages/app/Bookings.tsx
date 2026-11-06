import { DateTime } from 'luxon'
import { useEffect, useMemo, useState } from 'react'
import { isGoogleConnected } from '../../integrations/google'
import { listMyEvents, type CalendarEvent } from '../../integrations/googleIdentity'
import { useMe } from '../../auth/AuthProvider'
import { BookingDetails, BookingRow, NewBookingModal } from '../../components/BookingParts'
import PageHead from '../../components/PageHead'
import { Empty, Icon } from '../../components/ui'
import { useLoad, useStore } from '../../data/StoreProvider'
import { useI18n } from '../../i18n'
import type { Booking } from '../../lib/types'

type Tab = 'upcoming' | 'pending' | 'past' | 'cancelled' | 'calendar'

export default function Bookings() {
  const me = useMe()
  const store = useStore()
  const { L, intl, dir, fmtTime } = useI18n()
  const data = useLoad(async () => ({ bookings: await store.listBookings(me.id), ets: await store.listEventTypes(me.id) }), [me.id])
  const [tab, setTab] = useState<Tab>('upcoming')
  const [q, setQ] = useState('')
  const [etFilter, setEtFilter] = useState('')
  const [open, setOpen] = useState<Booking | null>(null)
  const [newOpen, setNewOpen] = useState(false)
  const [weekStart, setWeekStart] = useState<DateTime>(() => {
    const d = DateTime.now().setZone(me.timezone).startOf('day')
    return d.minus({ days: (d.weekday % 7 - me.weekStart + 7) % 7 })
  })
  const now = new Date().toISOString()
  const all = data.data?.bookings ?? []
  const ets = data.data?.ets ?? []

  const searched = useMemo(() => {
    const n = q.trim().toLowerCase()
    return all.filter((b) => {
      if (etFilter && b.eventTypeId !== etFilter) return false
      if (!n) return true
      const hay = [b.attendee.name, b.attendee.email, b.attendee.phone, b.title, b.notes, b.internalNotes, b.cancelReason, ...b.guests, ...Object.values(b.answers).map((v) => (Array.isArray(v) ? v.join(' ') : String(v)))]
        .join(' ')
        .toLowerCase()
      return hay.includes(n)
    })
  }, [all, q, etFilter])

  const lists: Record<Exclude<Tab, 'calendar'>, Booking[]> = {
    upcoming: searched.filter((b) => b.status === 'accepted' && b.end > now).sort((a, b) => a.start.localeCompare(b.start)),
    pending: searched.filter((b) => b.status === 'pending' && b.end > now).sort((a, b) => a.start.localeCompare(b.start)),
    past: searched.filter((b) => (b.status === 'accepted' || b.status === 'pending') && b.end <= now).sort((a, b) => b.start.localeCompare(a.start)),
    cancelled: searched.filter((b) => b.status === 'cancelled' || b.status === 'rejected').sort((a, b) => b.start.localeCompare(a.start)),
  }
  const tabs: [Tab, string][] = [
    ['upcoming', L('קרובות', 'Upcoming')],
    ['pending', L('ממתינות', 'Unconfirmed')],
    ['past', L('עברו', 'Past')],
    ['cancelled', L('בוטלו', 'Cancelled')],
    ['calendar', L('תצוגת שבוע', 'Week view')],
  ]

  const exportCsv = () => {
    const rows = [['start', 'end', 'status', 'event', 'name', 'email', 'phone', 'notes'], ...searched.map((b) => [b.start, b.end, b.status, b.title, b.attendee.name, b.attendee.email, b.attendee.phone, b.notes])]
    const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    a.download = 'slotwise-bookings.csv'
    a.click()
  }

  return (
    <div className="stack" style={{ ['--gap' as string]: '22px' }}>
      <PageHead
        title={L('פגישות', 'Bookings')}
        actions={
          <>
            <button className="btn btn-line" onClick={exportCsv}><Icon name="download" size={16} /> CSV</button>
            <button className="btn btn-accent" onClick={() => setNewOpen(true)} disabled={!ets.length}><Icon name="plus" size={16} /> {L('קביעה ידנית', 'New booking')}</button>
          </>
        }
      />
      <div className="row wrap" style={{ gap: 10 }}>
        <div className="input-group grow" style={{ minWidth: 240 }}>
          <span className="addon"><Icon name="search" size={16} /></span>
          <input aria-label={L('חיפוש פגישות', 'Search bookings')} className="input" placeholder={L('חיפוש לפי שם, מייל, טלפון, תשובה…', 'Search name, email, phone, any answer…')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select aria-label={L('סינון לפי סוג פגישה', 'Filter by event type')} className="select" style={{ width: 'auto', minWidth: 180 }} value={etFilter} onChange={(e) => setEtFilter(e.target.value)}>
          <option value="">{L('כל סוגי הפגישות', 'All event types')}</option>
          {ets.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
        </select>
      </div>
      <div className="tabs" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {label}
            {k !== 'calendar' && <span className="count">{lists[k].length}</span>}
          </button>
        ))}
      </div>

      {tab === 'calendar' ? (
        <WeekCalendar start={weekStart} onStart={setWeekStart} bookings={searched.filter((b) => b.status !== 'cancelled' && b.status !== 'rejected')} ets={ets} onOpen={setOpen} tz={me.timezone} intl={intl} dir={dir} L={L} fmtTime={fmtTime} gcals={me.google?.conflictCalendars ?? ['primary']} />
      ) : lists[tab].length === 0 ? (
        <Empty title={q ? L('לא נמצאו תוצאות', 'No results') : L('אין כאן כלום כרגע', 'Nothing here yet')} />
      ) : (
        <div className="timetable">
          {lists[tab].map((b) => (
            <BookingRow key={b.id} b={b} et={ets.find((e) => e.id === b.eventTypeId)} onOpen={() => setOpen(b)} showDate />
          ))}
        </div>
      )}
      {open && <BookingDetails key={open.id} b={all.find((x) => x.id === open.id) ?? open} et={ets.find((e) => e.id === open.eventTypeId)} onClose={() => setOpen(null)} />}
      {newOpen && <NewBookingModal open onClose={() => setNewOpen(false)} eventTypes={ets} />}
    </div>
  )
}

function WeekCalendar({ start, onStart, bookings, ets, onOpen, tz, intl, dir, L, fmtTime, gcals }: {
  start: DateTime; onStart: (d: DateTime) => void; bookings: Booking[]; ets: { id: string; color: string }[]; onOpen: (b: Booking) => void; tz: string; intl: string; dir: string; L: (a: string, b: string) => string; fmtTime: (i: string, tz: string) => string; gcals: string[]
}) {
  const days = Array.from({ length: 7 }, (_, i) => start.plus({ days: i }))
  const [gevents, setGevents] = useState<CalendarEvent[]>([])
  useEffect(() => {
    if (!isGoogleConnected()) return setGevents([])
    let alive = true
    const ids = new Set(bookings.map((b) => b.google?.eventId).filter(Boolean))
    listMyEvents(gcals, start.toUTC().toISO()!, start.plus({ days: 7 }).toUTC().toISO()!)
      .then((ev) => alive && setGevents(ev.filter((e) => !e.allDay && !ids.has(e.id))))
      .catch(() => {})
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start.toISO(), gcals.join(',')])
  const H0 = 7
  const H1 = 22
  const hourH = 44
  return (
    <div>
      <div className="row between" style={{ marginBottom: 12 }}>
        <div className="month-title">{days[0].setLocale(intl).toFormat('d LLL')} – {days[6].setLocale(intl).toFormat('d LLL yyyy')}</div>
        <div className="row" style={{ gap: 6 }}>
          {isGoogleConnected() && <span className="chip"><span className="dot" style={{ color: 'var(--sage)' }} /> Google</span>}
          <button className="btn btn-ghost btn-sm" onClick={() => onStart(DateTime.now().setZone(tz).startOf('day').minus({ days: DateTime.now().setZone(tz).weekday % 7 }))}>{L('היום', 'Today')}</button>
          <button className="icon-btn" onClick={() => onStart(start.minus({ days: 7 }))} aria-label={L('פתיחה', 'Open')}><Icon name={dir === 'rtl' ? 'chevR' : 'chevL'} /></button>
          <button className="icon-btn" onClick={() => onStart(start.plus({ days: 7 }))} aria-label={L('פתיחה', 'Open')}><Icon name={dir === 'rtl' ? 'chevL' : 'chevR'} /></button>
        </div>
      </div>
      <div className="wcal-scroll">
        <div className="wcal" style={{ ['--rows' as string]: H1 - H0, ['--hh' as string]: `${hourH}px` }}>
          <div className="wcal-hours">
            <div className="wcal-dh" />
            {Array.from({ length: H1 - H0 }, (_, i) => <div key={i} className="wcal-h mono">{String(H0 + i).padStart(2, '0')}:00</div>)}
          </div>
          {days.map((d) => {
            const list = bookings.filter((b) => DateTime.fromISO(b.start).setZone(tz).hasSame(d, 'day'))
            const isToday = d.hasSame(DateTime.now().setZone(tz), 'day')
            return (
              <div key={d.toISODate()} className={`wcal-day${isToday ? ' today' : ''}`}>
                <div className="wcal-dh">
                  <span className="tiny muted">{d.setLocale(intl).toFormat('ccc')}</span> <b className="mono">{d.day}</b>
                </div>
                <div className="wcal-body">
                  {gevents.filter((e) => DateTime.fromISO(e.start).setZone(tz).hasSame(d, 'day')).map((e) => {
                    const s = DateTime.fromISO(e.start).setZone(tz)
                    const top = ((s.hour + s.minute / 60) - H0) * hourH
                    const h = Math.max(20, ((Date.parse(e.end) - Date.parse(e.start)) / 3600000) * hourH - 2)
                    return (
                      <a key={e.id} className="wcal-gev" href={e.htmlLink} target="_blank" rel="noreferrer" style={{ top, height: h }} title={e.summary}>
                        <span className="mono tiny">{fmtTime(e.start, tz)}</span> {e.summary}
                      </a>
                    )
                  })}
                  {list.map((b) => {
                    const s = DateTime.fromISO(b.start).setZone(tz)
                    const top = ((s.hour + s.minute / 60) - H0) * hourH
                    const h = Math.max(22, ((Date.parse(b.end) - Date.parse(b.start)) / 3600000) * hourH - 2)
                    return (
                      <button key={b.id} className={`wcal-ev${b.status === 'pending' ? ' pending' : ''}`} style={{ top, height: h, ['--c' as string]: ets.find((e) => e.id === b.eventTypeId)?.color || 'var(--accent)' }} onClick={() => onOpen(b)}>
                        <span className="mono tiny">{fmtTime(b.start, tz)}</span> {b.attendee.name}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
