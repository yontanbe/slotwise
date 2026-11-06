import { DateTime } from 'luxon'
import { useMemo, useState } from 'react'
import { useMe } from '../../auth/AuthProvider'
import PageHead from '../../components/PageHead'
import { useLoad, useStore } from '../../data/StoreProvider'
import { useI18n } from '../../i18n'

export default function Insights() {
  const me = useMe()
  const store = useStore()
  const { L, weekdayShort } = useI18n()
  const data = useLoad(async () => ({ bookings: await store.listBookings(me.id), ets: await store.listEventTypes(me.id) }), [me.id])
  const [range, setRange] = useState<30 | 90 | 365>(90)

  const s = useMemo(() => {
    const from = DateTime.now().minus({ days: range }).toUTC().toISO()!
    const now = new Date().toISOString()
    const all = (data.data?.bookings ?? []).filter((b) => b.createdAt >= from || b.start >= from)
    const completed = all.filter((b) => b.status === 'accepted' && b.end < now)
    const byDay = Array(7).fill(0)
    const byHour = Array(24).fill(0)
    for (const b of all.filter((x) => x.status !== 'cancelled' && x.status !== 'rejected')) {
      const d = DateTime.fromISO(b.start).setZone(me.timezone)
      byDay[d.weekday % 7]++
      byHour[d.hour]++
    }
    const byType = (data.data?.ets ?? []).map((e) => ({ e, n: all.filter((b) => b.eventTypeId === e.id && b.status !== 'cancelled').length })).sort((a, b) => b.n - a.n)
    return {
      created: all.length,
      completed: completed.length,
      cancelled: all.filter((b) => b.status === 'cancelled' && !b.rescheduledToId).length,
      rescheduled: all.filter((b) => b.rescheduledFromId).length,
      noShowRate: completed.length ? Math.round((completed.filter((b) => b.noShow).length / completed.length) * 100) : 0,
      byDay,
      byHour,
      byType,
    }
  }, [data.data, range, me.timezone])

  const maxDay = Math.max(1, ...s.byDay)
  const hours = s.byHour.slice(7, 22)
  const maxHour = Math.max(1, ...hours)

  return (
    <div className="stack" style={{ ['--gap' as string]: '28px' }}>
      <PageHead
        title={L('נתונים', 'Insights')}
        actions={
          <div className="seg">
            {([30, 90, 365] as const).map((r) => (
              <button key={r} aria-pressed={range === r} onClick={() => setRange(r)}>{r === 365 ? L('שנה', 'Year') : `${r} ${L('יום', 'days')}`}</button>
            ))}
          </div>
        }
      />
      <section className="stats">
        {[
          [s.created, L('נוצרו', 'Created')],
          [s.completed, L('התקיימו', 'Completed')],
          [s.cancelled, L('בוטלו', 'Cancelled')],
          [s.rescheduled, L('שונו', 'Rescheduled')],
          [`${s.noShowRate}%`, L('לא הגיעו', 'No show rate')],
        ].map(([n, l]) => (
          <div key={String(l)}>
            <div className="numeral">{n}</div>
            <div className="muted small">{l}</div>
          </div>
        ))}
      </section>
      <div className="grid-2">
        <section className="card">
          <h3 style={{ marginBottom: 16 }}>{L('ימים פופולריים', 'Popular days')}</h3>
          <div className="bars">
            {s.byDay.map((v, i) => (
              <div key={i} className="bar-col">
                <div className="bar" style={{ height: `${(v / maxDay) * 100}%` }} title={String(v)}><span className="mono tiny">{v || ''}</span></div>
                <span className="tiny muted">{weekdayShort(i)}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="card">
          <h3 style={{ marginBottom: 16 }}>{L('שעות פופולריות', 'Popular hours')}</h3>
          <div className="bars">
            {hours.map((v, i) => (
              <div key={i} className="bar-col">
                <div className="bar sage" style={{ height: `${(v / maxHour) * 100}%` }} title={String(v)} />
                <span className="tiny muted mono">{7 + i}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
      <section>
        <h3 style={{ marginBottom: 10 }}>{L('לפי סוג פגישה', 'By event type')}</h3>
        <div className="timetable">
          {s.byType.map(({ e, n }) => (
            <div key={e.id} className="tt-row">
              <div className="tt-time"><b>{n}</b></div>
              <div className="row" style={{ gap: 10 }}>
                <span className="dot" style={{ color: e.color }} />
                {e.title}
              </div>
              <div className="meter"><span style={{ width: `${(n / Math.max(1, s.byType[0]?.n || 1)) * 100}%`, background: e.color }} /></div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
