import { DateTime } from 'luxon'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { PublicProfile } from '../data/store'
import { useLoad, useStore } from '../data/StoreProvider'
import { useI18n } from '../i18n'
import { runSync } from '../integrations/sync'
import { computeSlots, groupByDate, type Slot } from '../lib/availability'
import { hebrewDate, shabbatBlocks } from '../lib/holidays'
import { isValidPhone } from '../lib/links'
import { LOCATION_GLYPH, locationDetail, locationName } from '../lib/locations'
import type { Booking, EventLocation, EventType, Question } from '../lib/types'
import { Avatar, Field, Icon, MonthCalendar, TimezoneSelect, useToast } from './ui'

interface Props {
  profile: PublicProfile
  eventType: EventType
  reschedule?: Booking
  linkToken?: string
  embedded?: boolean
}

function guessTz() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return 'Asia/Jerusalem'
  }
}

export default function Booker({ profile, eventType: et, reschedule, linkToken }: Props) {
  const { L, locale, fmtTime, fmtDate, intl, dir, hour12, setHour12 } = useI18n()
  const store = useStore()
  const toast = useToast()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const host = profile.user
  const schedule = profile.schedules.find((s) => s.id === et.scheduleId) ?? profile.schedules[0]

  const [tz, setTz] = useState(() => (et.lockTimezone ? schedule?.timezone || host.timezone : guessTz()))
  const [duration, setDuration] = useState(() => {
    const d = Number(params.get('duration'))
    return reschedule ? Math.round((Date.parse(reschedule.end) - Date.parse(reschedule.start)) / 60000) : et.durations.includes(d) ? d : et.defaultDuration
  })
  const [month, setMonth] = useState<DateTime>(() => DateTime.now().setZone(tz).startOf('month'))
  const [date, setDate] = useState<string | null>(params.get('date'))
  const [slot, setSlot] = useState<Slot | null>(null)
  const [view, setView] = useState<'month' | 'week'>('month')
  const [weekStartDay, setWeekStartDay] = useState<DateTime>(() => DateTime.now().setZone(tz).startOf('day'))
  const [step, setStep] = useState<'pick' | 'form'>('pick')

  useEffect(() => {
    setHour12(host.timeFormat === '12h')
  }, [host.timeFormat, setHour12])

  // range to compute: visible month (or week) in invitee tz, padded
  const range = useMemo(() => {
    if (view === 'week') return { from: weekStartDay.toUTC().toISO()!, to: weekStartDay.plus({ days: 7 }).toUTC().toISO()! }
    const m = month.setZone(tz, { keepLocalTime: true }).startOf('month')
    return { from: m.toUTC().toISO()!, to: m.plus({ months: 1 }).toUTC().toISO()! }
  }, [month, tz, view, weekStartDay])

  const busy = useLoad(() => store.getPublicBusy(host.id, range.from, range.to), [host.id, range.from, range.to])

  const slots = useMemo(() => {
    if (!schedule || !busy.data) return []
    const blocked = host.shabbat ? shabbatBlocks(host.shabbat, range.from, range.to) : []
    return computeSlots({
      eventType: et,
      schedule,
      duration,
      from: range.from,
      to: range.to,
      now: new Date().toISOString(),
      busy: busy.data.busy,
      bookings: busy.data.bookings,
      blocked,
      ignoreBookingId: reschedule?.id,
      weekStart: host.weekStart,
    })
  }, [schedule, busy.data, host.shabbat, host.weekStart, range, et, duration, reschedule?.id])

  const byDate = useMemo(() => groupByDate(slots, tz), [slots, tz])

  // auto select first available date in month
  useEffect(() => {
    if (view !== 'month' || busy.loading) return
    if (date && byDate.has(date)) return
    const first = [...byDate.keys()].sort()[0]
    setDate(first ?? null)
    setSlot(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byDate, view, busy.loading])

  const daySlots = date ? byDate.get(date) ?? [] : []
  const hasPreferred = slots.some((s) => s.preferred)

  if (!schedule) return <div className="card">{L('אין לוח זמינות לסוג אירוע זה.', 'No schedule for this event type.')}</div>

  return (
    <div className="booker rise">
      <aside className="booker-host sheet">
        <div className="row" style={{ gap: 12 }}>
          <Avatar name={host.name} src={host.avatarUrl} size={52} />
          <div>
            <div className="eyebrow">{L('נפגשים עם', 'Meeting with')}</div>
            <div style={{ fontWeight: 600 }}>{host.name}</div>
          </div>
        </div>
        <hr className="rule" />
        <h2 className="booker-title">{et.title}</h2>
        {et.description && <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{et.description}</p>}
        <ul className="list-plain booker-facts">
          <li>
            <Icon name="clock" />
            {et.durations.length > 1 && !reschedule ? (
              <div className="seg" role="group">
                {et.durations.map((d) => (
                  <button key={d} aria-pressed={d === duration} onClick={() => { setDuration(d); setSlot(null) }}>
                    {d} {L('דק׳', 'min')}
                  </button>
                ))}
              </div>
            ) : (
              <span>
                {duration} {L('דקות', 'minutes')}
              </span>
            )}
          </li>
          <li>
            <Icon name="pin" />
            <span>{et.locations.map((l) => locationName(l.type, L)).join(' · ')}</span>
          </li>
          {et.seats ? (
            <li>
              <Icon name="users" />
              <span>{L(`עד ${et.seats} משתתפים`, `Up to ${et.seats} attendees`)}</span>
            </li>
          ) : null}
          {et.requiresConfirmation && (
            <li>
              <Icon name="check" />
              <span>{L('דורש אישור של המארח', 'Requires host approval')}</span>
            </li>
          )}
          <li>
            <Icon name="globe" />
            {et.lockTimezone ? <span>{tz}</span> : <TimezoneSelect value={tz} onChange={(v) => { setTz(v); setSlot(null) }} className="select input-sm" />}
          </li>
        </ul>
        {reschedule && (
          <div className="notice accent small">
            <Icon name="refresh" />
            <div>
              {L('שינוי מועד לפגישה שנקבעה ל', 'Rescheduling the meeting set for ')}
              <b>{fmtDate(reschedule.start, tz, { day: 'numeric', month: 'short' })} {fmtTime(reschedule.start, tz)}</b>
            </div>
          </div>
        )}
      </aside>

      {step === 'pick' ? (
        <>
          <section className="booker-cal">
            <div className="row between" style={{ marginBottom: 10 }}>
              <div className="seg">
                <button aria-pressed={view === 'month'} onClick={() => setView('month')}>
                  {L('חודש', 'Month')}
                </button>
                <button aria-pressed={view === 'week'} onClick={() => setView('week')}>
                  {L('שבוע', 'Week')}
                </button>
              </div>
              <div className="seg">
                <button aria-pressed={!hour12} onClick={() => setHour12(false)}>24h</button>
                <button aria-pressed={hour12} onClick={() => setHour12(true)}>12h</button>
              </div>
            </div>
            {view === 'month' ? (
              <MonthCalendar
                month={month.setZone(tz, { keepLocalTime: true })}
                onMonth={(m) => setMonth(m)}
                minMonth={DateTime.now().setZone(tz)}
                selected={date}
                onSelect={(d) => { setDate(d); setSlot(null) }}
                isAvailable={(d) => byDate.has(d)}
                weekStart={host.weekStart}
              />
            ) : (
              <WeekView
                start={weekStartDay}
                onStart={setWeekStartDay}
                byDate={byDate}
                tz={tz}
                selected={slot}
                onPick={(s) => { setSlot(s); setDate(DateTime.fromISO(s.start).setZone(tz).toISODate()) }}
              />
            )}
            {busy.loading && <p className="muted small" style={{ marginTop: 12 }}>{L('טוען זמינות…', 'Loading availability…')}</p>}
            {!busy.loading && slots.length === 0 && (
              <p className="muted small" style={{ marginTop: 12 }}>{L('אין זמנים פנויים בטווח הזה. נסו חודש אחר.', 'No open times in this range. Try another month.')}</p>
            )}
            {hasPreferred && (
              <p className="tiny muted" style={{ marginTop: 10 }}>
                <span className="accent">★</span> {L('זמנים מועדפים על המארח', 'Times the host prefers')}
              </p>
            )}
          </section>

          {view === 'month' && (
            <section className="booker-times">
              {date ? (
                <>
                  <div className="booker-times-head">
                    <div className="display" style={{ fontSize: 20 }}>{DateTime.fromISO(date, { zone: tz }).setLocale(intl).toLocaleString({ weekday: 'long', day: 'numeric', month: 'long' })}</div>
                    {host.shabbat?.showHebrewDate && <div className="tiny muted">{hebrewDate(DateTime.fromISO(date).toJSDate(), locale)}</div>}
                  </div>
                  <div className="ticket-list">
                    {daySlots.map((s) => (
                      <TicketRow key={s.start} s={s} tz={tz} selected={slot?.start === s.start} onPick={() => setSlot(s)} onNext={() => setStep('form')} />
                    ))}
                  </div>
                </>
              ) : (
                <p className="muted">{L('בחרו יום', 'Pick a day')}</p>
              )}
            </section>
          )}
          {view === 'week' && slot && (
            <div className="booker-weeknext">
              <button className="btn btn-accent btn-lg" onClick={() => setStep('form')}>
                {fmtDate(slot.start, tz, { weekday: 'short', day: 'numeric', month: 'short' })} · {fmtTime(slot.start, tz)} <Icon name={dir === 'rtl' ? 'chevL' : 'chevR'} />
              </button>
            </div>
          )}
        </>
      ) : (
        slot && (
          <BookingForm
            profile={profile}
            et={et}
            slot={slot}
            tz={tz}
            reschedule={reschedule}
            linkToken={linkToken}
            onBack={() => setStep('pick')}
            onConflict={() => {
              toast(L('מישהו תפס את המועד הזה רגע לפני. בחרו מועד אחר.', 'Someone just took that time. Please pick another.'), true)
              setSlot(null)
              setStep('pick')
              busy.reload()
            }}
            onDone={async (b) => {
              if (store.mode === 'local') {
                const full = await store.getUser(host.id)
                if (full) runSync(store, full, { pullBusy: false }).catch(() => {})
              }
              if (et.redirectUrl && !reschedule) {
                try {
                  const u = new URL(et.redirectUrl)
                  u.searchParams.set('name', b.attendee.name)
                  u.searchParams.set('email', b.attendee.email)
                  u.searchParams.set('start', b.start)
                  u.searchParams.set('event', et.slug)
                  window.location.href = u.toString()
                  return
                } catch {
                  /* fall through to confirmation */
                }
              }
              nav(`/b/${b.token}?new=1`)
            }}
          />
        )
      )}
    </div>
  )
}

function TicketRow({ s, tz, selected, onPick, onNext }: { s: Slot; tz: string; selected: boolean; onPick: () => void; onNext: () => void }) {
  const { L, fmtTime } = useI18n()
  return (
    <div className={`ticket-row${selected ? ' open' : ''}`}>
      <button className={`ticket${s.preferred ? ' preferred' : ''}`} aria-pressed={selected} onClick={onPick}>
        <span className="ltr">{fmtTime(s.start, tz)}</span>
        {s.seatsLeft !== undefined && <span className="seats">{L(`${s.seatsLeft} מקומות`, `${s.seatsLeft} seats`)}</span>}
      </button>
      {selected && (
        <button className="btn btn-accent" onClick={onNext}>
          {L('המשך', 'Next')}
        </button>
      )}
    </div>
  )
}

function WeekView({ start, onStart, byDate, tz, selected, onPick }: { start: DateTime; onStart: (d: DateTime) => void; byDate: Map<string, Slot[]>; tz: string; selected: Slot | null; onPick: (s: Slot) => void }) {
  const { L, fmtTime, intl, dir } = useI18n()
  const days = Array.from({ length: 7 }, (_, i) => start.plus({ days: i }))
  const canPrev = start > DateTime.now().setZone(tz).startOf('day')
  return (
    <div>
      <div className="month-head">
        <div className="month-title">
          {days[0].setLocale(intl).toFormat('d LLL')} – {days[6].setLocale(intl).toFormat('d LLL')}
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className="icon-btn" disabled={!canPrev} onClick={() => onStart(start.minus({ days: 7 }))} aria-label={L('שבוע קודם', 'Previous week')}>
            <Icon name={dir === 'rtl' ? 'chevR' : 'chevL'} />
          </button>
          <button className="icon-btn" onClick={() => onStart(start.plus({ days: 7 }))} aria-label={L('שבוע הבא', 'Next week')}>
            <Icon name={dir === 'rtl' ? 'chevL' : 'chevR'} />
          </button>
        </div>
      </div>
      <div className="week-grid">
        {days.map((d) => {
          const key = d.toISODate()!
          const list = byDate.get(key) ?? []
          return (
            <div key={key} className="week-col">
              <div className="week-col-head">
                <span>{d.setLocale(intl).toFormat('ccc')}</span>
                <b className="mono">{d.day}</b>
              </div>
              {list.length === 0 && <div className="week-none">—</div>}
              {list.map((s) => (
                <button key={s.start} className={`week-slot${s.preferred ? ' preferred' : ''}`} aria-pressed={selected?.start === s.start} onClick={() => onPick(s)}>
                  {fmtTime(s.start, tz)}
                </button>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function visible(q: Question, answers: Record<string, unknown>) {
  if (!q.showIf) return true
  const v = answers[q.showIf.questionId]
  return Array.isArray(v) ? v.includes(q.showIf.equals) : String(v ?? '') === q.showIf.equals
}

function BookingForm({
  profile,
  et,
  slot,
  tz,
  reschedule,
  linkToken,
  onBack,
  onDone,
  onConflict,
}: {
  profile: PublicProfile
  et: EventType
  slot: Slot
  tz: string
  reschedule?: Booking
  linkToken?: string
  onBack: () => void
  onDone: (b: Booking) => void
  onConflict: () => void
}) {
  const { L, locale, fmtDate, fmtRange, dir } = useI18n()
  const store = useStore()
  const toast = useToast()
  const [params] = useSearchParams()
  const p = (k: string) => params.get(k) || ''
  const [name, setName] = useState(reschedule?.attendee.name || p('name'))
  const [email, setEmail] = useState(reschedule?.attendee.email || p('email'))
  const [phone, setPhone] = useState(reschedule?.attendee.phone || p('phone'))
  const [waOptIn, setWaOptIn] = useState(reschedule?.attendee.whatsappOptIn ?? true)
  const [notes, setNotes] = useState(reschedule?.notes || p('notes'))
  const [guests, setGuests] = useState<string[]>(reschedule?.guests || [])
  const [guestDraft, setGuestDraft] = useState('')
  const [loc, setLoc] = useState<EventLocation>(reschedule?.location || et.locations[0] || { type: 'meet' })
  const [answers, setAnswers] = useState<Record<string, string | string[] | boolean>>(() => {
    const a: Record<string, string | string[] | boolean> = { ...(reschedule?.answers || {}) }
    et.questions.forEach((q) => {
      const v = params.get(q.id) ?? params.get('q_' + q.id)
      if (v != null) a[q.id] = q.type === 'multiselect' ? v.split(',') : q.type === 'boolean' || q.type === 'checkbox' ? v === 'true' : v
    })
    return a
  })
  const [reason, setReason] = useState('')
  const [hp, setHp] = useState('')
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const phoneRequired = loc.type === 'phone_host' || loc.type === 'whatsapp'

  const validate = () => {
    const e: Record<string, string> = {}
    if (!name.trim()) e.name = L('נא למלא שם', 'Name is required')
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) e.email = L('כתובת מייל לא תקינה', 'Invalid email')
    if ((phoneRequired || phone) && !isValidPhone(phone)) e.phone = L('מספר טלפון לא תקין', 'Invalid phone number')
    et.questions.forEach((q) => {
      if (!visible(q, answers) || !q.required) return
      const v = answers[q.id]
      if (v === undefined || v === '' || v === false || (Array.isArray(v) && v.length === 0)) e[q.id] = L('שדה חובה', 'Required')
    })
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!validate()) return
    setBusy(true)
    try {
      const attendee = { name: name.trim(), email: email.trim(), phone: phone.trim(), timezone: tz, locale, whatsappOptIn: waOptIn && !!phone }
      const res = reschedule
        ? await store.rescheduleByToken(reschedule.token, slot.start, slot.end, reason)
        : await store.createBooking({
            ownerId: profile.user.id,
            eventTypeId: et.id,
            start: slot.start,
            end: slot.end,
            attendee,
            guests,
            notes,
            answers: Object.fromEntries(Object.entries(answers).filter(([k]) => visible(et.questions.find((q) => q.id === k)!, answers))),
            location: loc,
            utm: Object.fromEntries([...params.entries()].filter(([k]) => k.startsWith('utm_'))),
            source: linkToken ? 'link' : 'web',
            linkToken,
            hp,
          })
      if (res.ok) onDone(res.booking)
      else if (res.error === 'conflict' || res.error === 'full') onConflict()
      else if (res.error === 'used') toast(L('הקישור הזה כבר נוצל', 'This link was already used'), true)
      else if (res.error === 'blocked') toast(L('לא ניתן להזמין עם כתובת זו', 'Booking with this email is not allowed'), true)
      else toast(L('משהו השתבש, נסו שוב', 'Something went wrong, try again'), true)
    } catch (e) {
      toast(String((e as Error).message || e), true)
    } finally {
      setBusy(false)
    }
  }

  const setA = (id: string, v: string | string[] | boolean) => setAnswers((a) => ({ ...a, [id]: v }))

  return (
    <form className="booker-form" onSubmit={submit} noValidate>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onBack} style={{ alignSelf: 'flex-start' }}>
        <Icon name={dir === 'rtl' ? 'chevR' : 'chevL'} /> {L('חזרה', 'Back')}
      </button>
      <div className="stub">
        <div>
          <div className="eyebrow">{L('המועד שבחרת', 'Your time')}</div>
          <div className="display" style={{ fontSize: 22 }}>{fmtDate(slot.start, tz)}</div>
        </div>
        <div className="stub-time mono ltr">{fmtRange(slot.start, slot.end, tz)}</div>
      </div>

      {!reschedule && (
        <>
          <div className="grid-2">
            <Field label={L('שם מלא', 'Full name')} required hint={errors.name}>
              <input className={`input${errors.name ? ' err' : ''}`} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </Field>
            <Field label={L('מייל', 'Email')} required hint={errors.email}>
              <input className={`input ltr${errors.email ? ' err' : ''}`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </Field>
          </div>
          <Field label={L('טלפון / WhatsApp', 'Phone / WhatsApp')} required={phoneRequired} hint={errors.phone}>
            <input className={`input ltr${errors.phone ? ' err' : ''}`} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="050-0000000" />
          </Field>
          {phone && (
            <label className="check small">
              <input type="checkbox" checked={waOptIn} onChange={(e) => setWaOptIn(e.target.checked)} />
              {L('אשמח לקבל אישור ותזכורת ב-WhatsApp', 'Send me confirmation and reminders on WhatsApp')}
            </label>
          )}

          {et.locations.length > 1 && (
            <Field label={L('איך נפגשים?', 'How do we meet?')}>
              <div className="loc-pick">
                {et.locations.map((l, i) => (
                  <button type="button" key={i} className="loc-opt" aria-pressed={l.type === loc.type && l.value === loc.value} onClick={() => setLoc(l)}>
                    <span className="loc-glyph">{LOCATION_GLYPH[l.type]}</span>
                    <span>
                      <b>{locationName(l.type, L)}</b>
                      {locationDetail(l, L) && <span className="tiny muted" style={{ display: 'block' }}>{locationDetail(l, L)}</span>}
                    </span>
                  </button>
                ))}
              </div>
            </Field>
          )}

          {et.questions.filter((q) => visible(q, answers)).map((q) => (
            <QuestionField key={q.id} q={q} value={answers[q.id]} onChange={(v) => setA(q.id, v)} error={errors[q.id]} />
          ))}

          <Field label={L('משהו שכדאי שנדע?', 'Anything to share?')}>
            <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>

          <Field label={L('אורחים נוספים', 'Additional guests')}>
            <div className="row wrap" style={{ gap: 6 }}>
              {guests.map((g) => (
                <span key={g} className="chip">
                  <span className="ltr">{g}</span>
                  <button type="button" className="link" aria-label="remove" onClick={() => setGuests(guests.filter((x) => x !== g))}>
                    <Icon name="x" size={12} />
                  </button>
                </span>
              ))}
              <input
                className="input input-sm ltr"
                style={{ flex: 1, minWidth: 180 }}
                placeholder="guest@email.com"
                value={guestDraft}
                onChange={(e) => setGuestDraft(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ',') && /^\S+@\S+\.\S+$/.test(guestDraft.trim())) {
                    e.preventDefault()
                    setGuests([...guests, guestDraft.trim()])
                    setGuestDraft('')
                  }
                }}
              />
            </div>
          </Field>
        </>
      )}

      {reschedule && (
        <Field label={L('סיבת השינוי (לא חובה)', 'Reason for change (optional)')}>
          <textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      )}

      <input className="sr-only" tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} aria-hidden name="website" />

      <button className="btn btn-accent btn-lg btn-block" disabled={busy}>
        {busy ? L('קובע…', 'Booking…') : reschedule ? L('אישור המועד החדש', 'Confirm new time') : et.requiresConfirmation ? L('שליחת בקשה', 'Send request') : L('קביעת הפגישה', 'Confirm booking')}
      </button>
      <p className="tiny muted" style={{ textAlign: 'center' }}>
        {L('בלחיצה אתם מאשרים קבלת הודעות לגבי הפגישה הזו בלבד.', 'By booking you agree to receive messages about this meeting only.')}
      </p>
    </form>
  )
}

function QuestionField({ q, value, onChange, error }: { q: Question; value: unknown; onChange: (v: string | string[] | boolean) => void; error?: string }) {
  const { L } = useI18n()
  const v = value as string
  const common = { className: `input${error ? ' err' : ''}`, value: v ?? '', placeholder: q.placeholder, onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value) }
  let input: React.ReactNode
  switch (q.type) {
    case 'textarea':
      input = <textarea className="textarea" value={v ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={q.placeholder} />
      break
    case 'number':
      input = <input type="number" {...common} />
      break
    case 'email':
      input = <input type="email" {...common} className={common.className + ' ltr'} />
      break
    case 'phone':
      input = <input type="tel" {...common} className={common.className + ' ltr'} />
      break
    case 'url':
      input = <input type="url" {...common} className={common.className + ' ltr'} placeholder="https://" />
      break
    case 'select':
      input = (
        <select className="select" value={v ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">{L('בחרו…', 'Choose…')}</option>
          {q.options?.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      )
      break
    case 'radio':
      input = (
        <div className="stack" style={{ ['--gap' as string]: '6px' }}>
          {q.options?.map((o) => (
            <label key={o} className="check">
              <input type="radio" name={q.id} checked={v === o} onChange={() => onChange(o)} /> {o}
            </label>
          ))}
        </div>
      )
      break
    case 'multiselect':
    case 'checkbox':
      if (q.options?.length) {
        const arr = Array.isArray(value) ? (value as string[]) : []
        input = (
          <div className="stack" style={{ ['--gap' as string]: '6px' }}>
            {q.options.map((o) => (
              <label key={o} className="check">
                <input type="checkbox" checked={arr.includes(o)} onChange={(e) => onChange(e.target.checked ? [...arr, o] : arr.filter((x) => x !== o))} /> {o}
              </label>
            ))}
          </div>
        )
      } else {
        input = (
          <label className="check">
            <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} /> {q.placeholder || L('כן', 'Yes')}
          </label>
        )
      }
      break
    case 'boolean':
      input = (
        <div className="seg">
          <button type="button" aria-pressed={value === true} onClick={() => onChange(true)}>{L('כן', 'Yes')}</button>
          <button type="button" aria-pressed={value === false} onClick={() => onChange(false)}>{L('לא', 'No')}</button>
        </div>
      )
      break
    case 'address':
      input = <input {...common} autoComplete="street-address" />
      break
    default:
      input = <input {...common} />
  }
  return (
    <Field label={q.label} required={q.required} hint={error}>
      {input}
    </Field>
  )
}
