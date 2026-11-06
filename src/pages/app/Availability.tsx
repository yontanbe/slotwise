import { DateTime } from 'luxon'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth, useMe } from '../../auth/AuthProvider'
import PageHead from '../../components/PageHead'
import WeeklyEditor, { RangeEditor } from '../../components/WeeklyEditor'
import { Field, Icon, MonthCalendar, TimezoneSelect, useToast } from '../../components/ui'
import { newSchedule } from '../../data/defaults'
import { useLoad, useStore } from '../../data/StoreProvider'
import { useI18n } from '../../i18n'
import { shabbatBlocks } from '../../lib/holidays'
import type { Schedule, TimeRange } from '../../lib/types'

export default function Availability() {
  const { id } = useParams()
  const me = useMe()
  const { refresh } = useAuth()
  const store = useStore()
  const nav = useNavigate()
  const toast = useToast()
  const { L, intl } = useI18n()
  const data = useLoad(async () => ({ schedules: await store.listSchedules(me.id), ets: await store.listEventTypes(me.id) }), [me.id])
  const schedules = data.data?.schedules ?? []
  const current = schedules.find((s) => s.id === id) ?? schedules.find((s) => s.id === me.defaultScheduleId) ?? schedules[0]
  const [draft, setDraft] = useState<Schedule | null>(null)
  const [month, setMonth] = useState<DateTime>(() => DateTime.now().setZone(me.timezone))
  const [day, setDay] = useState<string | null>(null)

  useEffect(() => {
    if (current && draft?.id !== current.id) setDraft(structuredClone(current))
  }, [current, draft?.id])

  const blockedDays = useMemo(() => {
    const from = month.startOf('month').toUTC().toISO()!
    const to = month.endOf('month').toUTC().toISO()!
    const set = new Set<string>()
    for (const b of shabbatBlocks(me.shabbat, from, to)) {
      const s = DateTime.fromISO(b.start).setZone(me.timezone)
      const e = DateTime.fromISO(b.end).setZone(me.timezone)
      for (let d = s.startOf('day'); d <= e; d = d.plus({ days: 1 })) {
        const a = s > d ? s : d
        const z = e < d.endOf('day') ? e : d.endOf('day')
        if (z.diff(a, 'hours').hours > 12) set.add(d.toISODate()!)
      }
    }
    return set
  }, [month, me.shabbat, me.timezone])

  if (!draft) return <div className="boot"><span className="boot-dot" /></div>
  const dirty = JSON.stringify(draft) !== JSON.stringify(current)
  const usedBy = (data.data?.ets ?? []).filter((e) => e.scheduleId === draft.id)
  const ov = day ? draft.overrides.find((o) => o.date === day) : undefined
  const dayRanges: TimeRange[] = day ? ov?.ranges ?? draft.weekly[DateTime.fromISO(day).weekday % 7] : []

  const setOverride = (ranges: TimeRange[] | null) => {
    if (!day) return
    const rest = draft.overrides.filter((o) => o.date !== day)
    setDraft({ ...draft, overrides: ranges === null ? rest : [...rest, { date: day, ranges }].sort((a, b) => a.date.localeCompare(b.date)) })
  }

  const save = async () => {
    await store.saveSchedule(draft)
    try {
      localStorage.setItem('slotwise:hours:' + me.id, '1')
    } catch {
      /* ignore */
    }
    toast(L('נשמר', 'Saved'))
  }
  const create = async () => {
    const s = newSchedule(me.id, L('לוח חדש', 'New schedule'), me.timezone)
    await store.saveSchedule(s)
    nav(`/app/availability/${s.id}`)
  }
  const remove = async () => {
    if (schedules.length < 2) return toast(L('צריך לפחות לוח אחד', 'Keep at least one schedule'), true)
    if (usedBy.length) return toast(L(`בשימוש ב-${usedBy.length} סוגי פגישות`, `Used by ${usedBy.length} event types`), true)
    if (!window.confirm(L('למחוק את הלוח?', 'Delete this schedule?'))) return
    await store.deleteSchedule(draft.id)
    nav('/app/availability')
  }

  return (
    <div className="stack" style={{ ['--gap' as string]: '22px' }}>
      <PageHead
        title={L('זמינות', 'Availability')}
        sub={L('כמה לוחות זמנים, כל סוג פגישה בוחר אחד.', 'Multiple schedules. Each event type picks one.')}
        actions={<button className="btn btn-line" onClick={create}><Icon name="plus" size={15} /> {L('לוח חדש', 'New schedule')}</button>}
      />
      <div className="tabs">
        {schedules.map((s) => (
          <button key={s.id} aria-selected={s.id === draft.id} onClick={() => nav(`/app/availability/${s.id}`)}>
            {s.name}
            {s.id === me.defaultScheduleId && <span className="count">★</span>}
          </button>
        ))}
      </div>

      <div className="avail-grid">
        <section className="card stack" style={{ ['--gap' as string]: '18px' }}>
          <div className="grid-2">
            <Field label={L('שם', 'Name')}>
              <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <Field label={L('אזור זמן', 'Timezone')}>
              <TimezoneSelect value={draft.timezone} onChange={(tz) => setDraft({ ...draft, timezone: tz })} />
            </Field>
          </div>
          <h3>{L('שעות שבועיות', 'Weekly hours')}</h3>
          <WeeklyEditor weekly={draft.weekly} onChange={(w) => setDraft({ ...draft, weekly: w })} weekStart={me.weekStart} />
          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn btn-accent" disabled={!dirty} onClick={save}>{L('שמירה', 'Save')}</button>
            {draft.id !== me.defaultScheduleId && (
              <button className="btn btn-ghost" onClick={async () => { await store.saveUser({ ...me, defaultScheduleId: draft.id }); refresh() }}>
                {L('הגדרה כברירת מחדל', 'Make default')}
              </button>
            )}
            <button className="btn btn-ghost" onClick={remove}><Icon name="trash" size={15} /> {L('מחיקה', 'Delete')}</button>
          </div>
          {usedBy.length > 0 && <p className="tiny muted">{L('בשימוש ב:', 'Used by:')} {usedBy.map((e) => e.title).join(', ')}</p>}
        </section>

        <section className="card stack" style={{ ['--gap' as string]: '16px' }}>
          <div>
            <h3>{L('חריגות לפי תאריך', 'Date overrides')}</h3>
            <p className="small muted">{L('בחרו יום כדי לשנות שעות או לסמן חופש. ימים מסומנים בעיגול כתום.', 'Pick a day to change hours or mark it off. Overridden days are ringed.')}</p>
          </div>
          <MonthCalendar
            month={month}
            onMonth={setMonth}
            selected={day}
            onSelect={setDay}
            pickAny
            isMarked={(d) => draft.overrides.some((o) => o.date === d)}
            isBlocked={(d) => blockedDays.has(d)}
            weekStart={me.weekStart}
          />
          {me.shabbat.enabled && <p className="tiny muted"><span className="accent">—</span> {L('קו חוצה: שבת או חג חסומים אוטומטית', 'Strikethrough: Shabbat or holiday auto blocked')}</p>}
          {day && (
            <div className="override-box rise">
              <div className="row between">
                <b>{DateTime.fromISO(day).setLocale(intl).toLocaleString({ weekday: 'long', day: 'numeric', month: 'long' })}</b>
                {ov && <button className="link small" onClick={() => setOverride(null)}>{L('חזרה לשעות הרגילות', 'Reset to weekly')}</button>}
              </div>
              {dayRanges.length ? (
                <RangeEditor ranges={dayRanges} onChange={(r) => setOverride(r)} />
              ) : (
                <p className="small muted">{L('לא זמין ביום הזה', 'Unavailable this day')}</p>
              )}
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn-line btn-sm" onClick={() => setOverride([])}>{L('יום חופש', 'Day off')}</button>
                {!dayRanges.length && <button className="btn btn-line btn-sm" onClick={() => setOverride([{ start: '09:00', end: '17:00' }])}>{L('הוספת שעות', 'Add hours')}</button>}
              </div>
            </div>
          )}
          {draft.overrides.length > 0 && (
            <ul className="list-plain ov-list">
              {draft.overrides.filter((o) => o.date >= DateTime.now().toISODate()!).map((o) => (
                <li key={o.date}>
                  <span className="mono small">{DateTime.fromISO(o.date).toFormat('dd.MM.yy')}</span>
                  <span className="small">{o.ranges.length ? o.ranges.map((r) => `${r.start}–${r.end}`).join(', ') : L('חופש', 'Off')}</span>
                  <button className="icon-btn" onClick={() => setDraft({ ...draft, overrides: draft.overrides.filter((x) => x.date !== o.date) })}><Icon name="x" size={13} /></button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
