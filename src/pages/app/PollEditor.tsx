import { DateTime } from 'luxon'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMe } from '../../auth/AuthProvider'
import { Field, Icon, useCopy, useToast } from '../../components/ui'
import { useLoad, useStore } from '../../data/StoreProvider'
import { useI18n } from '../../i18n'
import { appUrl } from '../../lib/links'
import { LOCATION_TYPES, locationName } from '../../lib/locations'
import type { Poll } from '../../lib/types'
import { PollGrid, scorePoll } from '../public/PollVote'

export default function PollEditor() {
  const { id = '' } = useParams()
  const me = useMe()
  const store = useStore()
  const toast = useToast()
  const copy = useCopy()
  const nav = useNavigate()
  const { L, dir } = useI18n()
  const polls = useLoad(() => store.listPolls(me.id), [me.id])
  const ets = useLoad(() => store.listEventTypes(me.id), [me.id])
  const live = polls.data?.find((p) => p.id === id)
  const [p, setP] = useState<Poll | null>(null)
  const [when, setWhen] = useState(() => DateTime.now().setZone(me.timezone).plus({ days: 2 }).set({ hour: 10, minute: 0 }).toFormat("yyyy-MM-dd'T'HH:mm"))

  useEffect(() => {
    if (live && (!p || p.id !== live.id)) setP(live)
    else if (live && p && live.voters.length !== p.voters.length) setP({ ...p, voters: live.voters })
  }, [live, p])

  if (!p) return <div className="boot"><span className="boot-dot" /></div>
  const save = async (next = p) => {
    await store.savePoll(next)
    setP(next)
    toast(L('נשמר', 'Saved'))
  }
  const addOption = () => {
    const s = DateTime.fromISO(when, { zone: me.timezone })
    if (!s.isValid) return
    const o = { start: s.toUTC().toISO()!, end: s.plus({ minutes: p.duration }).toUTC().toISO()! }
    if (p.options.some((x) => x.start === o.start)) return
    const options = [...p.options, o].sort((a, b) => a.start.localeCompare(b.start))
    setP({ ...p, options, voters: p.voters.map((v) => ({ ...v, votes: options.map((op) => v.votes[p.options.findIndex((x) => x.start === op.start)] ?? 'no') })) })
    setWhen(s.plus({ hours: 2 }).toFormat("yyyy-MM-dd'T'HH:mm"))
  }
  const scores = scorePoll(p)

  const book = async (i: number) => {
    const o = p.options[i]
    const etList = ets.data ?? []
    const et = etList[0]
    const voters = p.voters.filter((v) => v.votes[i] !== 'no' && v.email)
    if (!et) return toast(L('צריך לפחות סוג פגישה אחד', 'Create an event type first'), true)
    let bookingId: string | undefined
    if (voters.length) {
      const res = await store.createBooking({
        ownerId: me.id,
        eventTypeId: et.id,
        start: o.start,
        end: o.end,
        attendee: { name: voters[0].name, email: voters[0].email, phone: '', timezone: me.timezone, locale: me.locale, whatsappOptIn: false },
        guests: voters.slice(1).map((v) => v.email),
        notes: p.description,
        answers: {},
        location: p.location,
        utm: {},
        source: 'poll',
        override: true,
      })
      if (res.ok) {
        bookingId = res.booking.id
        await store.saveBooking({ ...res.booking, title: p.title })
      }
    }
    await save({ ...p, status: 'closed', chosenIndex: i, bookingId })
    toast(voters.length ? L('נקבע ונשלחה הזמנה למשתתפים', 'Booked and invites sent') : L('נבחר. אין משתתפים עם מייל לשליחת הזמנה.', 'Chosen. No voters with email to invite.'))
  }

  return (
    <div className="stack" style={{ ['--gap' as string]: '22px' }}>
      <div className="row between wrap" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 10 }}>
          <Link to="/app/polls" className="icon-btn"><Icon name={dir === 'rtl' ? 'chevR' : 'chevL'} /></Link>
          <h1 className="page-title" style={{ fontSize: 34 }}>{p.title}</h1>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-line" onClick={() => copy(appUrl(`/p/${p.id}`))}><Icon name="copy" size={15} /> {L('קישור להצבעה', 'Voting link')}</button>
          <button className="btn btn-ghost" onClick={async () => { if (window.confirm(L('למחוק?', 'Delete?'))) { await store.deletePoll(p.id); nav('/app/polls') } }}><Icon name="trash" size={15} /></button>
          <button className="btn btn-accent" onClick={() => save()}>{L('שמירה', 'Save')}</button>
        </div>
      </div>
      <div className="avail-grid">
        <section className="card stack" style={{ ['--gap' as string]: '16px' }}>
          <Field label={L('כותרת', 'Title')}>
            <input className="input" value={p.title} onChange={(e) => setP({ ...p, title: e.target.value })} />
          </Field>
          <Field label={L('תיאור', 'Description')}>
            <textarea className="textarea" value={p.description} onChange={(e) => setP({ ...p, description: e.target.value })} />
          </Field>
          <div className="grid-2">
            <Field label={L('משך (דק׳)', 'Duration (min)')}>
              <input className="input" type="number" min={5} step={5} value={p.duration} onChange={(e) => { const d = Number(e.target.value); setP({ ...p, duration: d, options: p.options.map((o) => ({ ...o, end: DateTime.fromISO(o.start).plus({ minutes: d }).toUTC().toISO()! })) }) }} />
            </Field>
            <Field label={L('מיקום', 'Location')}>
              <select className="select" value={p.location.type} onChange={(e) => setP({ ...p, location: { type: e.target.value as Poll['location']['type'] } })}>
                {LOCATION_TYPES.map((t) => <option key={t} value={t}>{locationName(t, L)}</option>)}
              </select>
            </Field>
          </div>
          <label className="row" style={{ gap: 10 }}>
            <span className="small">{L('סטטוס:', 'Status:')}</span>
            <div className="seg">
              <button aria-pressed={p.status === 'open'} onClick={() => setP({ ...p, status: 'open' })}>{L('פתוח', 'Open')}</button>
              <button aria-pressed={p.status === 'closed'} onClick={() => setP({ ...p, status: 'closed' })}>{L('סגור', 'Closed')}</button>
            </div>
          </label>
        </section>
        <section className="card stack" style={{ ['--gap' as string]: '14px' }}>
          <h3>{L('מועדים מוצעים', 'Proposed times')}</h3>
          <div className="row" style={{ gap: 8 }}>
            <input className="input ltr" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            <button className="btn btn-line" onClick={addOption}><Icon name="plus" size={15} /></button>
          </div>
          <ul className="list-plain ov-list">
            {p.options.map((o, i) => (
              <li key={o.start}>
                <span className="mono small">{DateTime.fromISO(o.start).setZone(me.timezone).toFormat('ccc dd.MM HH:mm')}</span>
                <span className="small muted">{scores[i]} {L('נק׳', 'pts')}</span>
                <div className="row" style={{ gap: 4 }}>
                  {p.voters.length > 0 && p.chosenIndex === null && <button className="btn btn-sm btn-accent" onClick={() => book(i)}>{L('קביעה', 'Book')}</button>}
                  <button className="icon-btn" onClick={() => setP({ ...p, options: p.options.filter((_, j) => j !== i), voters: p.voters.map((v) => ({ ...v, votes: v.votes.filter((_, j) => j !== i) })) })}><Icon name="x" size={13} /></button>
                </div>
              </li>
            ))}
            {p.options.length === 0 && <li className="small muted">{L('הוסיפו לפחות שני מועדים.', 'Add at least two times.')}</li>}
          </ul>
        </section>
      </div>
      {p.options.length > 0 && (
        <section>
          <h2 style={{ fontSize: 24, marginBottom: 12 }}>{L('תוצאות', 'Results')}</h2>
          <PollGrid poll={p} tz={me.timezone} />
          {p.voters.length === 0 && <p className="small muted" style={{ marginTop: 8 }}>{L('עוד אין הצבעות. שלחו את הקישור.', 'No votes yet. Share the link.')} <span className="ltr mono tiny">{appUrl(`/p/${p.id}`)}</span></p>}
        </section>
      )}
    </div>
  )
}
