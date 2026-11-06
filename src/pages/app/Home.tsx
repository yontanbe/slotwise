import { DateTime } from 'luxon'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMe } from '../../auth/AuthProvider'
import { BookingDetails, BookingRow } from '../../components/BookingParts'
import PageHead from '../../components/PageHead'
import { markShared, SetupChecklist } from '../../components/Onboarding'
import { Empty, Icon, useCopy } from '../../components/ui'
import { useLoad, useStore } from '../../data/StoreProvider'
import { useI18n } from '../../i18n'
import { appUrl } from '../../lib/links'
import type { Booking } from '../../lib/types'

export default function Home() {
  const me = useMe()
  const store = useStore()
  const copy = useCopy()
  const { L, intl, dir } = useI18n()
  const data = useLoad(async () => ({ bookings: await store.listBookings(me.id), ets: await store.listEventTypes(me.id), outbox: await store.listOutbox(me.id) }), [me.id])
  const [open, setOpen] = useState<Booking | null>(null)
  const now = DateTime.now().setZone(me.timezone)
  const hour = now.hour
  const greet = hour < 12 ? L('בוקר טוב', 'Good morning') : hour < 17 ? L('צהריים טובים', 'Good afternoon') : L('ערב טוב', 'Good evening')
  const first = me.name.split(' ')[0]

  const bookings = data.data?.bookings ?? []
  const ets = data.data?.ets ?? []
  const nowIso = now.toUTC().toISO()!
  const upcoming = bookings.filter((b) => (b.status === 'accepted' || b.status === 'pending') && b.end > nowIso).sort((a, b) => a.start.localeCompare(b.start))
  const pending = upcoming.filter((b) => b.status === 'pending')
  const weekEnd = now.plus({ days: 7 }).toUTC().toISO()!
  const thisWeek = upcoming.filter((b) => b.start < weekEnd)
  const minutesWeek = thisWeek.reduce((s, b) => s + (Date.parse(b.end) - Date.parse(b.start)) / 60000, 0)
  const past = bookings.filter((b) => b.status === 'accepted' && b.end < nowIso)
  const noShowRate = past.length ? Math.round((past.filter((b) => b.noShow).length / past.length) * 100) : 0

  // group upcoming by day (next 14 days, max 12 rows)
  const groups = new Map<string, Booking[]>()
  upcoming.slice(0, 12).forEach((b) => {
    const k = DateTime.fromISO(b.start).setZone(me.timezone).toISODate()!
    groups.set(k, [...(groups.get(k) || []), b])
  })
  const dayLabel = (d: string) => {
    const dt = DateTime.fromISO(d, { zone: me.timezone })
    if (dt.hasSame(now, 'day')) return L('היום', 'Today')
    if (dt.hasSame(now.plus({ days: 1 }), 'day')) return L('מחר', 'Tomorrow')
    return dt.setLocale(intl).toFormat('cccc')
  }

  return (
    <div className="stack" style={{ ['--gap' as string]: '34px' }}>
      <PageHead
        eyebrow={now.setLocale(intl).toLocaleString({ weekday: 'long', day: 'numeric', month: 'long' })}
        title={<>{greet}, {first}.<br /><span className="muted-title">{L('זה הלוח שלך.', 'Here is your schedule.')}</span></>}
        actions={
          <button className="btn btn-accent" onClick={() => { copy(appUrl(`/${me.username}`)); markShared(me.id) }}>
            <Icon name="link" size={16} /> {L('העתקת הקישור שלי', 'Copy my link')}
          </button>
        }
      />

      <SetupChecklist />

      <section className="stats rise">
        <div>
          <div className="numeral">{thisWeek.length}</div>
          <div className="muted small">{L('פגישות ב-7 הימים הקרובים', 'meetings in the next 7 days')}</div>
        </div>
        <div>
          <div className="numeral">{Math.round(minutesWeek / 60 * 10) / 10}</div>
          <div className="muted small">{L('שעות מתוזמנות', 'hours booked')}</div>
        </div>
        <div>
          <div className={`numeral${pending.length ? ' accent' : ''}`}>{pending.length}</div>
          <div className="muted small">{L('ממתינות לאישור', 'awaiting approval')}</div>
        </div>
        <div>
          <div className="numeral">{noShowRate}<span style={{ fontSize: '0.5em' }}>%</span></div>
          <div className="muted small">{L('לא הגיעו', 'no show rate')}</div>
        </div>
      </section>

      <div className="home-grid">
        <section>
          <div className="row between" style={{ marginBottom: 8 }}>
            <h2 style={{ fontSize: 26 }}>{L('הפגישות הבאות', 'Upcoming')}</h2>
            <Link to="/app/bookings" className="link small">{L('כל הפגישות', 'All bookings')}</Link>
          </div>
          {upcoming.length === 0 ? (
            <Empty title={L('הלוח פנוי', 'Nothing booked yet')} text={L('שתפו את הקישור שלכם והפגישות יופיעו כאן.', 'Share your link and bookings will show up here.')} />
          ) : (
            <div className="timetable">
              {[...groups.entries()].map(([d, list]) => (
                <div key={d}>
                  <div className="tt-day">
                    {dayLabel(d)} <span className="mono">{DateTime.fromISO(d).toFormat('dd.MM')}</span>
                  </div>
                  {list.map((b) => (
                    <BookingRow key={b.id} b={b} et={ets.find((e) => e.id === b.eventTypeId)} onOpen={() => setOpen(b)} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>

        <aside className="stack" style={{ ['--gap' as string]: '22px' }}>
          <div>
            <h3 style={{ marginBottom: 6 }}>{L('קישורים לשיתוף', 'Share links')}</h3>
            <div className="share-list">
              {ets.filter((e) => !e.hidden && !e.teamId).slice(0, 5).map((e) => (
                <div key={e.id} className="share-item" style={{ ['--c' as string]: e.color }}>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{e.title}</div>
                    <div className="tiny muted ltr ellipsis">/{me.username}/{e.slug}</div>
                  </div>
                  <button className="icon-btn" onClick={() => { copy(appUrl(`/${me.username}/${e.slug}`)); markShared(me.id) }} aria-label={L('העתקה', 'Copy')}>
                    <Icon name="copy" size={15} />
                  </button>
                  <a className="icon-btn" href={appUrl(`/${me.username}/${e.slug}`)} target="_blank" rel="noreferrer" aria-label={L('פתיחה', 'Open')}>
                    <Icon name={dir === 'rtl' ? 'chevL' : 'chevR'} size={15} />
                  </a>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="row between">
              <h3>{L('דואר יוצא', 'Outbox')}</h3>
              <Link to="/app/integrations" className="link tiny">{L('הגדרות שליחה', 'Sending setup')}</Link>
            </div>
            <ul className="list-plain outbox">
              {(data.data?.outbox ?? []).slice(0, 5).map((m) => (
                <li key={m.id}>
                  <span className={`dot ${m.status}`} />
                  <div style={{ minWidth: 0 }}>
                    <div className="small ellipsis">{m.subject}</div>
                    <div className="tiny muted ltr ellipsis">{m.to} · {m.via}</div>
                  </div>
                </li>
              ))}
              {(data.data?.outbox ?? []).length === 0 && <li className="tiny muted">{L('עדיין לא נשלחו הודעות.', 'No messages yet.')}</li>}
            </ul>
          </div>
        </aside>
      </div>
      {open && <BookingDetails key={open.id} b={bookings.find((x) => x.id === open.id) ?? open} et={ets.find((e) => e.id === open.eventTypeId)} onClose={() => setOpen(null)} />}
    </div>
  )
}
