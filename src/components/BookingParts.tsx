import { DateTime } from 'luxon'
import { useState } from 'react'
import { useMe } from '../auth/AuthProvider'
import { useStore } from '../data/StoreProvider'
import { useI18n } from '../i18n'
import { whatsappText } from '../integrations/notifications'
import { nowISO } from '../lib/id'
import { appUrl, whatsappLink } from '../lib/links'
import { LOCATION_GLYPH, locationDetail, locationName } from '../lib/locations'
import type { Booking, EventType } from '../lib/types'
import { Avatar, Field, Icon, Modal, StatusStamp, useCopy, useToast } from './ui'

export function BookingRow({ b, et, onOpen, showDate }: { b: Booking; et?: EventType; onOpen: () => void; showDate?: boolean }) {
  const me = useMe()
  const { L, fmtTime, fmtDate } = useI18n()
  return (
    <button className="tt-row booking-row" onClick={onOpen}>
      <div className="tt-time">
        {showDate && <span className="tiny muted" style={{ display: 'block' }}>{fmtDate(b.start, me.timezone, { day: 'numeric', month: 'short' })}</span>}
        <b>{fmtTime(b.start, me.timezone)}</b>
        {fmtTime(b.end, me.timezone)}
      </div>
      <div className="row" style={{ gap: 12, minWidth: 0 }}>
        <span className="folder" style={{ ['--c' as string]: et?.color || 'var(--accent)' }}>{b.title}</span>
        <div style={{ minWidth: 0 }}>
          <div className="booking-name">{b.attendee.name}</div>
          <div className="tiny muted ellipsis">
            {LOCATION_GLYPH[b.location.type]} {locationName(b.location.type, L)}
          </div>
        </div>
      </div>
      <div className="row" style={{ gap: 8 }}>
        {b.google?.eventId && <span className="chip" title="Google Calendar">G</span>}
        <StatusStamp status={b.status} noShow={b.noShow} />
      </div>
    </button>
  )
}

export function BookingDetails({ b, et, onClose }: { b: Booking | null; et?: EventType; onClose: () => void }) {
  const me = useMe()
  const store = useStore()
  const toast = useToast()
  const copy = useCopy()
  const { L, fmtDate, fmtRange, locale } = useI18n()
  const [notes, setNotes] = useState(b?.internalNotes ?? '')
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState('')
  const [moving, setMoving] = useState(false)
  const [newStart, setNewStart] = useState('')
  if (!b) return null
  const tz = me.timezone
  const update = async (patch: Partial<Booking>, action: string, note?: string) => {
    await store.saveBooking({ ...b, ...patch, history: [...b.history, { at: nowISO(), action, by: 'host', note }] })
    toast(L('עודכן', 'Updated'))
  }
  const future = b.end > nowISO()
  const active = b.status === 'accepted' || b.status === 'pending'
  const questions = et?.questions || []
  const answerText = (v: unknown) => (Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? L('כן', 'Yes') : L('לא', 'No')) : String(v ?? ''))

  return (
    <Modal open onClose={onClose} wide>
      <div className="details">
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div className="row" style={{ gap: 14 }}>
            <Avatar name={b.attendee.name} size={52} />
            <div>
              <div className="eyebrow">{b.title}</div>
              <h2>{b.attendee.name}</h2>
              <div className="small muted ltr">
                {b.attendee.email}
                {b.attendee.phone ? ` · ${b.attendee.phone}` : ''}
              </div>
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <StatusStamp status={b.status} noShow={b.noShow} />
            <button className="icon-btn" onClick={onClose} aria-label="close">
              <Icon name="x" />
            </button>
          </div>
        </div>

        <div className="details-grid">
          <div className="stub" style={{ margin: 0 }}>
            <div>
              <div className="eyebrow">{L('מתי', 'When')}</div>
              <div className="display" style={{ fontSize: 20 }}>{fmtDate(b.start, tz)}</div>
            </div>
            <div className="stub-time mono ltr">{fmtRange(b.start, b.end, tz)}</div>
          </div>
          <dl className="kv">
            <dt>{L('מיקום', 'Location')}</dt>
            <dd>
              {locationName(b.location.type, L)} <span className="muted small">{locationDetail(b.location, L, b.google?.meetUrl)}</span>
            </dd>
            {b.attendee.timezone && b.attendee.timezone !== tz && (
              <>
                <dt>{L('אצל המוזמן', 'Invitee time')}</dt>
                <dd className="mono small">{fmtRange(b.start, b.end, b.attendee.timezone)} · {b.attendee.timezone}</dd>
              </>
            )}
            {b.guests.length > 0 && (
              <>
                <dt>{L('אורחים', 'Guests')}</dt>
                <dd className="ltr small">{b.guests.join(', ')}</dd>
              </>
            )}
            {b.notes && (
              <>
                <dt>{L('הערות המוזמן', 'Invitee notes')}</dt>
                <dd>{b.notes}</dd>
              </>
            )}
            {Object.entries(b.answers).map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt>{questions.find((q) => q.id === k)?.label || k}</dt>
                <dd>{answerText(v)}</dd>
              </div>
            ))}
            {b.cancelReason && (
              <>
                <dt>{L('סיבת ביטול', 'Cancel reason')}</dt>
                <dd>{b.cancelReason}</dd>
              </>
            )}
            {b.rescheduleReason && (
              <>
                <dt>{L('סיבת שינוי', 'Reschedule reason')}</dt>
                <dd>{b.rescheduleReason}</dd>
              </>
            )}
            {Object.keys(b.utm).length > 0 && (
              <>
                <dt>UTM</dt>
                <dd className="ltr small mono">{Object.entries(b.utm).map(([k, v]) => `${k}=${v}`).join(' ')}</dd>
              </>
            )}
            {b.google?.error && (
              <>
                <dt>Google</dt>
                <dd className="small" style={{ color: 'var(--danger)' }}>{b.google.error}</dd>
              </>
            )}
          </dl>
        </div>

        {(b.payment || b.reconfirmedAt || b.recurringId || b.coHostIds?.length || b.teamId) && (
          <div className="badge-row">
            {b.payment && (
              <span className={`chip ${b.payment.status === 'paid' ? 'sage' : 'accent'}`}>
                {b.payment.status === 'paid' ? L('שולם', 'Paid') : b.payment.status === 'waived' ? L('פטור מתשלום', 'Waived') : b.payment.status === 'refunded' ? L('הוחזר', 'Refunded') : L('ממתין לתשלום', 'Unpaid')} · {b.payment.amount} {b.payment.currency}
              </span>
            )}
            {b.reconfirmedAt && <span className="chip sage">{L('אישר הגעה', 'Reconfirmed')}</span>}
            {b.recurringId && <span className="chip">{L('סדרה', 'Series')} #{(b.recurringIndex ?? 0) + 1}</span>}
            {b.coHostIds?.length ? <span className="chip">{L('משותפת', 'Collective')} +{b.coHostIds.length}</span> : null}
            {b.teamId && !b.coHostIds?.length && <span className="chip">{L('צוות', 'Team')}</span>}
          </div>
        )}
        {b.payment && b.payment.status === 'unpaid' && (
          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn btn-line btn-sm" onClick={() => update({ payment: { ...b.payment!, status: 'paid', paidAt: nowISO() } }, 'paid')}>{L('סימון כשולם', 'Mark paid')}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => update({ payment: { ...b.payment!, status: 'waived' } }, 'payment_waived')}>{L('פטור', 'Waive')}</button>
          </div>
        )}
        {b.status === 'pending' && future && (
          <div className="notice accent">
            <div className="grow">{L('המוזמן מחכה לאישור שלך.', 'The invitee is waiting for your approval.')}</div>
            <button className="btn btn-accent btn-sm" onClick={() => update({ status: 'accepted' }, 'confirmed')}>{L('אישור', 'Approve')}</button>
            <button className="btn btn-line btn-sm" onClick={() => update({ status: 'rejected' }, 'rejected')}>{L('דחייה', 'Decline')}</button>
          </div>
        )}

        <div className="row wrap" style={{ gap: 8 }}>
          {b.attendee.phone && active && (
            <a className="btn btn-line btn-sm" target="_blank" rel="noreferrer" href={whatsappLink(b.attendee.phone, whatsappText(future ? 'reminder' : 'confirm', b, me, b.attendee.locale || locale))}>
              <Icon name="whatsapp" size={15} /> {L('תזכורת ב-WhatsApp', 'WhatsApp reminder')}
            </a>
          )}
          <a className="btn btn-line btn-sm" href={`mailto:${b.attendee.email}?subject=${encodeURIComponent(b.title)}`}>
            <Icon name="mail" size={15} /> {L('מייל', 'Email')}
          </a>
          <button className="btn btn-line btn-sm" onClick={() => copy(appUrl(`/b/${b.token}`))}>
            <Icon name="link" size={15} /> {L('קישור ניהול', 'Manage link')}
          </button>
          {active && future && (
            <button className="btn btn-line btn-sm" onClick={() => { setMoving(!moving); setNewStart(DateTime.fromISO(b.start).setZone(tz).toFormat("yyyy-MM-dd'T'HH:mm")) }}>
              <Icon name="refresh" size={15} /> {L('הזזה', 'Move')}
            </button>
          )}
          {!future && b.status === 'accepted' && (
            <button className="btn btn-line btn-sm" onClick={() => update({ noShow: !b.noShow }, b.noShow ? 'no_show_cleared' : 'no_show')}>
              {b.noShow ? L('ביטול סימון לא הגיע', 'Clear no show') : L('סימון לא הגיע', 'Mark no show')}
            </button>
          )}
          {active && future && b.recurringId && (
            <button className="btn btn-danger btn-sm" onClick={async () => {
              if (!window.confirm(L('לבטל את כל הפגישות העתידיות בסדרה?', 'Cancel all future meetings in this series?'))) return
              const all = (await store.listBookings(me.id)).filter((x) => x.recurringId === b.recurringId && x.end > nowISO() && (x.status === 'accepted' || x.status === 'pending'))
              for (const x of all) await store.saveBooking({ ...x, status: 'cancelled', cancelReason: L('סדרה בוטלה', 'Series cancelled'), history: [...x.history, { at: nowISO(), action: 'cancelled', by: 'host' }] })
              toast(L(`בוטלו ${all.length}`, `Cancelled ${all.length}`))
            }}>
              {L('ביטול הסדרה', 'Cancel series')}
            </button>
          )}
          {active && future && (
            <button className="btn btn-danger btn-sm" onClick={() => setCancelling(!cancelling)}>
              {L('ביטול', 'Cancel')}
            </button>
          )}
        </div>

        {moving && (
          <div className="card-flat row wrap" style={{ gap: 10 }}>
            <input className="input input-sm ltr" style={{ maxWidth: 240 }} type="datetime-local" value={newStart} onChange={(e) => setNewStart(e.target.value)} />
            <button
              className="btn btn-sm"
              onClick={async () => {
                const s = DateTime.fromISO(newStart, { zone: tz })
                if (!s.isValid) return
                const dur = Date.parse(b.end) - Date.parse(b.start)
                await update({ start: s.toUTC().toISO()!, end: s.plus({ milliseconds: dur }).toUTC().toISO()!, google: b.google ? { ...b.google, syncedAt: undefined } : undefined, emailsSent: (b.emailsSent || []).filter((x) => x !== 'booked' && x !== 'confirmed' && x !== 'rescheduled'), rescheduledFromId: b.rescheduledFromId || b.id }, 'moved_by_host')
                setMoving(false)
              }}
            >
              {L('שמירה ושליחת עדכון', 'Save and notify')}
            </button>
            <span className="tiny muted">{L('עוקף זמינות. המוזמן יקבל עדכון.', 'Overrides availability. The invitee is notified.')}</span>
          </div>
        )}

        {cancelling && (
          <div className="card-flat stack">
            <textarea className="textarea" placeholder={L('סיבה (תישלח למוזמן)', 'Reason (sent to invitee)')} value={reason} onChange={(e) => setReason(e.target.value)} />
            <button className="btn btn-accent btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => { update({ status: 'cancelled', cancelReason: reason }, 'cancelled', reason); setCancelling(false) }}>
              {L('ביטול הפגישה', 'Cancel meeting')}
            </button>
          </div>
        )}

        <Field label={L('הערות פנימיות (רק לך)', 'Internal notes (only you)')}>
          <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== b.internalNotes && update({ internalNotes: notes }, 'note')} />
        </Field>

        <details>
          <summary className="small muted" style={{ cursor: 'pointer' }}>{L('היסטוריה', 'History')} ({b.history.length})</summary>
          <ol className="history">
            {b.history.map((h, i) => (
              <li key={i}>
                <span className="mono tiny">{DateTime.fromISO(h.at).setZone(tz).toFormat('dd.MM HH:mm')}</span> <b>{h.action}</b> <span className="muted">· {h.by}</span>
                {h.note && <span className="muted"> · {h.note}</span>}
              </li>
            ))}
          </ol>
        </details>
      </div>
    </Modal>
  )
}

export function NewBookingModal({ open, onClose, eventTypes }: { open: boolean; onClose: () => void; eventTypes: EventType[] }) {
  const me = useMe()
  const store = useStore()
  const toast = useToast()
  const { L, locale } = useI18n()
  const [etId, setEtId] = useState(eventTypes[0]?.id || '')
  const et = eventTypes.find((e) => e.id === etId) ?? eventTypes[0]
  const [start, setStart] = useState(() => DateTime.now().setZone(me.timezone).plus({ days: 1 }).set({ hour: 10, minute: 0 }).toFormat("yyyy-MM-dd'T'HH:mm"))
  const [duration, setDuration] = useState(et?.defaultDuration || 30)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [override, setOverride] = useState(true)
  if (!et) return null
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const s = DateTime.fromISO(start, { zone: me.timezone })
    if (!name || !/^\S+@\S+\.\S+$/.test(email) || !s.isValid) return toast(L('נא למלא שם, מייל ומועד', 'Name, email and time are required'), true)
    const res = await store.createBooking({
      ownerId: me.id,
      eventTypeId: et.id,
      start: s.toUTC().toISO()!,
      end: s.plus({ minutes: duration }).toUTC().toISO()!,
      attendee: { name, email, phone, timezone: me.timezone, locale, whatsappOptIn: !!phone },
      guests: [],
      notes: '',
      answers: {},
      location: et.locations[0] || { type: 'meet' },
      utm: {},
      source: 'manual',
      override,
    })
    if (res.ok) {
      toast(L('הפגישה נקבעה', 'Booked'))
      onClose()
    } else toast(res.error === 'conflict' ? L('יש התנגשות. סמנו "עקיפת זמינות" כדי לקבוע בכל זאת.', 'Conflict. Enable override to book anyway.') : res.error, true)
  }
  return (
    <Modal open={open} onClose={onClose}>
      <form className="stack" onSubmit={submit} style={{ ['--gap' as string]: '14px' }}>
        <h3>{L('קביעת פגישה ידנית', 'Book manually')}</h3>
        <Field label={L('סוג פגישה', 'Event type')}>
          <select className="select" value={etId} onChange={(e) => { setEtId(e.target.value); setDuration(eventTypes.find((x) => x.id === e.target.value)?.defaultDuration || 30) }}>
            {eventTypes.map((x) => (
              <option key={x.id} value={x.id}>{x.title}</option>
            ))}
          </select>
        </Field>
        <div className="grid-2">
          <Field label={L('מועד', 'Start')}>
            <input className="input ltr" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label={L('משך (דקות)', 'Duration (min)')}>
            <input className="input" type="number" min={5} step={5} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
          </Field>
        </div>
        <div className="grid-2">
          <Field label={L('שם', 'Name')}>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={L('מייל', 'Email')}>
            <input className="input ltr" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        </div>
        <Field label={L('טלפון', 'Phone')}>
          <input className="input ltr" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
          {L('עקיפת זמינות (לקבוע גם מחוץ לשעות)', 'Override availability (book outside hours)')}
        </label>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-accent">{L('קביעה', 'Book')}</button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>{L('ביטול', 'Cancel')}</button>
        </div>
      </form>
    </Modal>
  )
}
