import { DateTime } from 'luxon'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { seriesStarts, type PublicProfile, type PublicUser } from '../data/store'
import { useLoad, useStore } from '../data/StoreProvider'
import { useI18n } from '../i18n'
import { getInviteeBusy, isGoogleConfigured, SINGLE_EMAIL } from '../integrations/google'
import { runSync } from '../integrations/sync'
import { computeSlots, groupByDate, type Slot } from '../lib/availability'
import { hebrewDate, shabbatBlocks } from '../lib/holidays'
import { isValidPhone } from '../lib/links'
import { LOCATION_GLYPH, locationDetail, locationName } from '../lib/locations'
import type { Booking, EventLocation, EventType, PersonalLink, Question } from '../lib/types'
import { Avatar, Field, Icon, MonthCalendar, TimezoneSelect, useToast } from './ui'

interface Props {
  profile: PublicProfile
  eventType: EventType
  reschedule?: Booking
  linkToken?: string
  /** personalized link: greeting + prefill */
  personal?: PersonalLink
  /** team or dynamic group: all hosts, including the event type owner */
  team?: { mode: 'round_robin' | 'collective'; members: PublicProfile[] }
  routingResponseId?: string
  prefill?: Record<string, string>
}

export interface HostSlot extends Slot {
  hostIds: string[]
}

function guessTz() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return 'Asia/Jerusalem'
  }
}

export function formatMoney(n: number, cur: string, intl: string) {
  try {
    return new Intl.NumberFormat(intl, { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n)
  } catch {
    return `${n} ${cur}`
  }
}

export const isEmbedded = () => new URLSearchParams(window.location.hash.split('?')[1] || '').get('embed') === '1'
export function postToParent(type: string, data: Record<string, unknown> = {}) {
  if (window.parent !== window) window.parent.postMessage({ source: 'slotwise', type, ...data }, '*')
}

function oooSpans(u: PublicUser) {
  return (u.outOfOffice || []).map((o) => ({
    start: DateTime.fromISO(o.start, { zone: u.timezone }).startOf('day').toUTC().toISO()!,
    end: DateTime.fromISO(o.end, { zone: u.timezone }).plus({ days: 1 }).startOf('day').toUTC().toISO()!,
  }))
}

/** Round robin pick: highest priority, then fewest recent bookings relative to weight. */
export function pickHost(candidates: string[], et: EventType, recentCounts: Record<string, number>): string {
  const meta = (id: string) => et.hosts?.find((h) => h.userId === id) ?? { userId: id, priority: 2, weight: 50 }
  return [...candidates].sort((a, b) => {
    const pa = meta(a).priority
    const pb = meta(b).priority
    if (pa !== pb) return pb - pa
    const la = (recentCounts[a] || 0) / Math.max(1, meta(a).weight)
    const lb = (recentCounts[b] || 0) / Math.max(1, meta(b).weight)
    return la - lb || a.localeCompare(b)
  })[0]
}

export default function Booker({ profile, eventType: et, reschedule, linkToken, personal, team, routingResponseId, prefill }: Props) {
  const { L, locale, fmtTime, fmtDate, intl, dir, hour12, setHour12 } = useI18n()
  const store = useStore()
  const toast = useToast()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const host = profile.user
  const members = team?.members ?? [profile]
  const schedule = profile.schedules.find((s) => s.id === et.scheduleId) ?? profile.schedules[0]
  const embedded = isEmbedded()

  const [tz, setTz] = useState(() => (et.lockTimezone ? schedule?.timezone || host.timezone : guessTz()))
  const [duration, setDuration] = useState(() => {
    const d = Number(params.get('duration'))
    return reschedule ? Math.round((Date.parse(reschedule.end) - Date.parse(reschedule.start)) / 60000) : et.durations.includes(d) ? d : et.defaultDuration
  })
  const [month, setMonth] = useState<DateTime>(() => DateTime.now().setZone(tz).startOf('month'))
  const [date, setDate] = useState<string | null>(params.get('date'))
  const [slot, setSlot] = useState<HostSlot | null>(null)
  const [view, setView] = useState<'month' | 'week'>('month')
  const [weekStartDay, setWeekStartDay] = useState<DateTime>(() => DateTime.now().setZone(tz).startOf('day'))
  const [step, setStep] = useState<'pick' | 'form'>('pick')
  const [count, setCount] = useState(1)
  const [mine, setMine] = useState<{ start: string; end: string }[] | null>(null)

  useEffect(() => {
    setHour12(host.timeFormat === '12h')
  }, [host.timeFormat, setHour12])

  // range to compute: visible month (or week) in invitee tz
  const range = useMemo(() => {
    if (view === 'week') return { from: weekStartDay.toUTC().toISO()!, to: weekStartDay.plus({ days: 7 }).toUTC().toISO()! }
    const m = month.setZone(tz, { keepLocalTime: true }).startOf('month')
    return { from: m.toUTC().toISO()!, to: m.plus({ months: 1 }).toUTC().toISO()! }
  }, [month, tz, view, weekStartDay])
  // bookings are fetched for a wider window so weekly / monthly limits see the whole host week and month
  const padded = useMemo(
    () => ({ from: DateTime.fromISO(range.from).minus({ days: 38 }).toUTC().toISO()!, to: DateTime.fromISO(range.to).plus({ days: 38 }).toUTC().toISO()! }),
    [range],
  )
  const memberIds = members.map((m) => m.user.id).join(',')
  const busy = useLoad(
    () => Promise.all(members.map((m) => store.getPublicBusy(m.user.id, padded.from, padded.to))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [memberIds, padded.from, padded.to],
  )

  const slots: HostSlot[] = useMemo(() => {
    if (!busy.data) return []
    const perHost = members.map((m, i) => {
      const u = m.user
      const sched = u.id === et.ownerId ? schedule : m.schedules.find((s) => s.id === u.defaultScheduleId) ?? m.schedules[0]
      if (!sched) return { id: u.id, slots: [] as Slot[] }
      const data = busy.data![i]
      return {
        id: u.id,
        slots: computeSlots({
          eventType: et,
          schedule: sched,
          duration,
          from: range.from,
          to: range.to,
          now: new Date().toISOString(),
          busy: data.busy,
          bookings: data.bookings,
          blocked: [...(u.shabbat ? shabbatBlocks(u.shabbat, range.from, range.to) : []), ...oooSpans(u)],
          ignoreBookingId: reschedule?.id,
          weekStart: u.weekStart,
          travel: u.travel,
        }),
      }
    })
    const map = new Map<string, HostSlot>()
    for (const h of perHost)
      for (const sl of h.slots) {
        const cur = map.get(sl.start)
        if (cur) {
          cur.hostIds.push(h.id)
          cur.preferred = cur.preferred || sl.preferred
        } else map.set(sl.start, { ...sl, hostIds: [h.id] })
      }
    let list = [...map.values()]
    if (team?.mode === 'collective' || (!team && members.length > 1)) list = list.filter((x) => x.hostIds.length === members.length)
    return list.sort((a, b) => a.start.localeCompare(b.start))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy.data, range, et, duration, reschedule?.id, memberIds, schedule, team?.mode])

  const byDate = useMemo(() => groupByDate(slots, tz) as Map<string, HostSlot[]>, [slots, tz])

  // invitee calendar overlay: busy times from their own Google calendar (read only, never stored)
  useEffect(() => {
    if (!mine) return
    getInviteeBusy(range.from, range.to).then(setMine).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to])
  const clashes = (sl: Slot) => !!mine?.some((m) => m.start < sl.end && m.end > sl.start)

  // auto select first available date in month
  useEffect(() => {
    if (view !== 'month' || busy.loading) return
    if (date && byDate.has(date)) return
    const first = [...byDate.keys()].sort()[0]
    setDate(first ?? null)
    setSlot(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byDate, view, busy.loading])

  useEffect(() => {
    if (!embedded) return
    const send = () => postToParent('height', { height: document.documentElement.scrollHeight })
    send()
    const ro = new ResizeObserver(send)
    ro.observe(document.body)
    return () => ro.disconnect()
  }, [embedded])

  const daySlots = date ? byDate.get(date) ?? [] : []
  const hasPreferred = slots.some((s) => s.preferred)
  const ooo = date ? (host.outOfOffice || []).find((o) => date >= o.start && date <= o.end) : undefined
  const recurring = !reschedule && et.recurring && et.recurring.maxCount > 1 ? et.recurring : null
  const occurrences = slot && recurring && count > 1 ? seriesStarts(slot.start, slot.end, recurring.freq, count, schedule?.timezone || host.timezone) : []

  /** Who hosts the chosen slot: round robin picks one, collective books everyone. */
  const assign = (sl: HostSlot): { ownerId: string; coHostIds: string[] } => {
    if (!team) return { ownerId: host.id, coHostIds: [] }
    if (team.mode === 'collective') {
      const owner = members.some((m) => m.user.id === et.ownerId) ? et.ownerId : members[0].user.id
      return { ownerId: owner, coHostIds: members.map((m) => m.user.id).filter((id) => id !== owner) }
    }
    const counts: Record<string, number> = {}
    members.forEach((m, i) => (counts[m.user.id] = busy.data?.[i]?.bookings.length ?? 0))
    return { ownerId: pickHost(sl.hostIds, et, counts), coHostIds: [] }
  }

  if (!schedule) return <div className="card">{L('אין לוח זמינות לסוג אירוע זה.', 'No schedule for this event type.')}</div>

  return (
    <div className="booker rise">
      <aside className="booker-host sheet">
        {team ? (
          <div className="row" style={{ gap: 12 }}>
            <div className="avatar-stack">
              {members.slice(0, 4).map((m) => (
                <Avatar key={m.user.id} name={m.user.name} src={m.user.avatarUrl} size={40} />
              ))}
            </div>
            <div>
              <div className="eyebrow">{team.mode === 'collective' ? L('נפגשים עם כולם', 'Meeting with everyone') : L('נפגשים עם מי שפנוי', 'Meeting whoever is free')}</div>
              <div style={{ fontWeight: 600 }}>{members.map((m) => m.user.name.split(' ')[0]).join(', ')}</div>
            </div>
          </div>
        ) : (
          <div className="row" style={{ gap: 12 }}>
            <Avatar name={host.name} src={host.avatarUrl} size={52} />
            <div>
              <div className="eyebrow">{L('נפגשים עם', 'Meeting with')}</div>
              <div style={{ fontWeight: 600 }}>{host.name}</div>
            </div>
          </div>
        )}
        {personal?.greeting && <p className="greeting display">{personal.greeting}</p>}
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
          {et.price && et.price.amount > 0 && (
            <li>
              <span className="fact-glyph">₪</span>
              <span>
                {formatMoney(et.price.amount, et.price.currency, intl)}
                {et.price.mode === 'deposit' && et.price.depositAmount ? ` · ${L('מקדמה', 'deposit')} ${formatMoney(et.price.depositAmount, et.price.currency, intl)}` : ''}
                {et.price.refundHours ? <span className="tiny muted" style={{ display: 'block' }}>{L(`החזר מלא בביטול עד ${et.price.refundHours} שעות לפני`, `Full refund if cancelled ${et.price.refundHours}h before`)}</span> : null}
              </span>
            </li>
          )}
          {recurring && (
            <li>
              <Icon name="refresh" />
              <select className="select input-sm" value={count} onChange={(e) => setCount(Number(e.target.value))} aria-label={L('חזרות', 'Repeats')}>
                <option value={1}>{L('פגישה אחת', 'One meeting')}</option>
                {Array.from({ length: recurring.maxCount - 1 }, (_, i) => i + 2).map((n) => (
                  <option key={n} value={n}>
                    {L(`${n} פגישות, ${recurring.freq === 'weekly' ? 'כל שבוע' : recurring.freq === 'biweekly' ? 'כל שבועיים' : 'כל חודש'}`, `${n} meetings, ${recurring.freq === 'weekly' ? 'weekly' : recurring.freq === 'biweekly' ? 'every 2 weeks' : 'monthly'}`)}
                  </option>
                ))}
              </select>
            </li>
          )}
          <li>
            <Icon name="globe" />
            {et.lockTimezone ? <span>{tz}</span> : <TimezoneSelect value={tz} onChange={(v) => { setTz(v); setSlot(null) }} className="select input-sm" />}
          </li>
        </ul>
        {isGoogleConfigured() && !reschedule && (
          <button
            className="btn btn-line btn-sm"
            onClick={async () => {
              if (mine) return setMine(null)
              try {
                setMine(await getInviteeBusy(range.from, range.to))
              } catch (e) {
                toast(String((e as Error).message), true)
              }
            }}
          >
            <Icon name="calendar" size={15} /> {mine ? L('הסתרת היומן שלי', 'Hide my calendar') : L('הצגת היומן שלי', 'Show my calendar')}
          </button>
        )}
        {mine && <p className="tiny muted">{L('זמנים שמתנגשים ביומן שלך מסומנים. דבר לא נשמר.', 'Times that clash with your calendar are marked. Nothing is stored.')}</p>}
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
                  {ooo && (
                    <div className="notice small" style={{ marginBottom: 10 }}>
                      <div>
                        {L(`${host.name.split(' ')[0]} מחוץ למשרד בתאריכים האלה.`, `${host.name.split(' ')[0]} is out of office on these dates.`)} {ooo.note}
                        {ooo.redirectUsername && (
                          <>
                            {' '}
                            <a className="link" href={`#/${ooo.redirectUsername}`}>{L('לקביעה עם מחליף', 'Book a teammate instead')}</a>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                  <div className="ticket-list">
                    {daySlots.map((s) => (
                      <TicketRow key={s.start} s={s} tz={tz} clash={clashes(s)} selected={slot?.start === s.start} onPick={() => setSlot(s)} onNext={() => setStep('form')} />
                    ))}
                  </div>
                  {occurrences.length > 1 && (
                    <ul className="list-plain series-list tiny">
                      {occurrences.map((o, i) => (
                        <li key={o.start} className="mono">{i + 1}. {fmtDate(o.start, tz, { weekday: 'short', day: 'numeric', month: 'short' })} {fmtTime(o.start, tz)}</li>
                      ))}
                    </ul>
                  )}
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
            et={et}
            slot={slot}
            tz={tz}
            reschedule={reschedule}
            linkToken={linkToken}
            personal={personal}
            prefill={prefill}
            routingResponseId={routingResponseId || params.get('rr') || undefined}
            count={recurring ? count : 1}
            seriesFreq={recurring?.freq}
            seriesTz={schedule.timezone}
            assignment={assign(slot)}
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
              postToParent('booked', { start: b.start, end: b.end, event: et.slug, status: b.status })
              if (et.redirectUrl && !reschedule && /^https?:\/\//i.test(et.redirectUrl)) {
                try {
                  const u = new URL(et.redirectUrl)
                  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('scheme')
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
              nav(`/b/${b.token}?new=1${embedded ? '&embed=1' : ''}`)
            }}
          />
        )
      )}
    </div>
  )
}

function TicketRow({ s, tz, selected, onPick, onNext, clash }: { s: Slot; tz: string; selected: boolean; onPick: () => void; onNext: () => void; clash?: boolean }) {
  const { L, fmtTime } = useI18n()
  return (
    <div className={`ticket-row${selected ? ' open' : ''}`}>
      <button className={`ticket${s.preferred ? ' preferred' : ''}${clash ? ' clash' : ''}`} aria-pressed={selected} onClick={onPick} title={clash ? L('מתנגש ביומן שלך', 'Clashes with your calendar') : undefined}>
        <span className="ltr">{fmtTime(s.start, tz)}</span>
        {clash && <span className="seats">{L('תפוס אצלך', 'You are busy')}</span>}
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

function WeekView({ start, onStart, byDate, tz, selected, onPick }: { start: DateTime; onStart: (d: DateTime) => void; byDate: Map<string, HostSlot[]>; tz: string; selected: HostSlot | null; onPick: (s: HostSlot) => void }) {
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
  et,
  slot,
  tz,
  reschedule,
  linkToken,
  personal,
  prefill,
  routingResponseId,
  count,
  seriesFreq,
  seriesTz,
  assignment,
  onBack,
  onDone,
  onConflict,
}: {
  et: EventType
  slot: Slot
  tz: string
  reschedule?: Booking
  linkToken?: string
  personal?: PersonalLink
  prefill?: Record<string, string>
  routingResponseId?: string
  count: number
  seriesFreq?: 'weekly' | 'biweekly' | 'monthly'
  seriesTz: string
  assignment: { ownerId: string; coHostIds: string[] }
  onBack: () => void
  onDone: (b: Booking) => void
  onConflict: () => void
}) {
  const { L, locale, fmtDate, fmtRange, dir } = useI18n()
  const store = useStore()
  const toast = useToast()
  const [params] = useSearchParams()
  const p = (k: string) => params.get(k) || prefill?.[k] || ''
  const [name, setName] = useState(reschedule?.attendee.name || p('name') || personal?.name || '')
  const [email, setEmail] = useState(reschedule?.attendee.email || p('email') || personal?.email || '')
  const [phone, setPhone] = useState(reschedule?.attendee.phone || p('phone'))
  const [waOptIn, setWaOptIn] = useState(reschedule?.attendee.whatsappOptIn ?? true)
  const [notes, setNotes] = useState(reschedule?.notes || p('notes'))
  const [guests, setGuests] = useState<string[]>(reschedule?.guests || [])
  const [guestDraft, setGuestDraft] = useState('')
  const [loc, setLoc] = useState<EventLocation>(reschedule?.location || et.locations[0] || { type: 'meet' })
  const [answers, setAnswers] = useState<Record<string, string | string[] | boolean>>(() => {
    const a: Record<string, string | string[] | boolean> = { ...(reschedule?.answers || {}) }
    et.questions.forEach((q) => {
      const v = params.get(q.id) ?? params.get('q_' + q.id) ?? prefill?.[q.id] ?? null
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
    if (!SINGLE_EMAIL.test(email.trim())) e.email = L('כתובת מייל לא תקינה', 'Invalid email')
    if ((phoneRequired || phone) && !isValidPhone(phone)) e.phone = L('מספר טלפון לא תקין', 'Invalid phone number')
    et.questions.forEach((q) => {
      if (!visible(q, answers) || !q.required) return
      const v = answers[q.id]
      // a required yes/no question accepts "no"; only a consent checkbox must be ticked
      const missing = v === undefined || v === '' || (Array.isArray(v) && v.length === 0) || (v === false && q.type === 'checkbox')
      if (missing) e[q.id] = L('שדה חובה', 'Required')
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
            ownerId: assignment.ownerId,
            coHostIds: assignment.coHostIds,
            teamId: et.teamId || undefined,
            personalLinkId: personal?.id,
            routingResponseId,
            count,
            seriesFreq,
            seriesTz,
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
      else if (res.error === 'limit') toast(L('כבר קבעת פגישה כזו לאחרונה. אפשר לנהל אותה מהמייל שקיבלת.', 'You already booked this recently. Manage it from your email.'), true)
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
                  if ((e.key === 'Enter' || e.key === ',') && SINGLE_EMAIL.test(guestDraft.trim()) && guests.length < 10) {
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

export function QuestionField({ q, value, onChange, error }: { q: Question; value: unknown; onChange: (v: string | string[] | boolean) => void; error?: string }) {
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
