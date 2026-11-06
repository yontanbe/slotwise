import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import Booker from '../../components/Booker'
import PublicShell, { NotFound } from '../../components/PublicShell'
import { Avatar, Icon, StatusStamp, useToast } from '../../components/ui'
import { useLoad, useStore } from '../../data/StoreProvider'
import { useI18n } from '../../i18n'
import { runSync } from '../../integrations/sync'
import { downloadIcs } from '../../lib/ics'
import { googleCalendarLink, outlookLink, whatsappLink } from '../../lib/links'
import { functionsUrl } from '../../lib/config'
import { formatMoney } from '../../components/Booker'
import { LOCATION_GLYPH, locationDetail, locationName } from '../../lib/locations'

/** Stripe Payment Link (works without a server) with the booking id as client_reference_id. */
function paymentLinkUrl(b: { id: string; attendee: { email: string }; payment?: { link?: string } }): string | null {
  if (!b.payment?.link || !/^https:\/\//.test(b.payment.link)) return null
  const u = new URL(b.payment.link)
  u.searchParams.set('client_reference_id', b.id)
  u.searchParams.set('prefilled_email', b.attendee.email)
  return u.toString()
}

/** Stripe Checkout through the Edge Function: POST {token} -> {url}. */
async function startCheckout(token: string): Promise<string> {
  const res = await fetch(`${functionsUrl()}/stripe/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
  const j = await res.json().catch(() => ({}))
  if (!res.ok || !j.url) throw new Error(j?.error?.message || `checkout_${res.status}`)
  return j.url as string
}

export default function ManageBooking() {
  const { token = '' } = useParams()
  const [params] = useSearchParams()
  const store = useStore()
  const toast = useToast()
  const { L, fmtDate, fmtRange, intl } = useI18n()
  const { data, loading, reload } = useLoad(() => store.getBookingByToken(token), [token])
  const action = params.get('action')
  const [mode, setMode] = useState<'view' | 'cancel' | 'reschedule'>(action === 'cancel' ? 'cancel' : action === 'reschedule' ? 'reschedule' : 'view')
  const [confirmedNow, setConfirmedNow] = useState(false)
  useEffect(() => {
    if (action !== 'confirm' || confirmedNow) return
    setConfirmedNow(true)
    store.confirmAttendance(token).then((b) => {
      if (b) {
        toast(L('תודה, ההגעה אושרה', 'Thanks, attendance confirmed'))
        reload()
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action])
  const [reason, setReason] = useState('')
  const profile = useLoad(() => (data && mode === 'reschedule' ? store.getPublicProfile(data.user.username) : Promise.resolve(null)), [data?.user.username, mode])

  if (loading) return <PublicShell><div className="boot"><span className="boot-dot" /></div></PublicShell>
  if (!data) return <NotFound />
  const { booking: b, user, eventType } = data
  const tz = b.attendee.timezone || user.timezone
  const isNew = params.get('new') === '1'
  const active = b.status === 'accepted' || b.status === 'pending'
  const past = b.end < new Date().toISOString()
  const where = locationDetail(b.location, L, b.google?.meetUrl)
  const calTitle = `${b.title} · ${user.name}`
  const details = `${L('לשינוי או ביטול', 'Manage')}: ${window.location.href.split('?')[0]}`

  if (mode === 'reschedule' && profile.data && eventType)
    return (
      <PublicShell>
        <Booker profile={profile.data} eventType={eventType} reschedule={b} />
      </PublicShell>
    )

  const cancel = async () => {
    const r = await store.cancelByToken(token, reason)
    if (r) {
      if (store.mode === 'local') {
        const full = await store.getUser(user.id)
        if (full) runSync(store, full, { pullBusy: false }).catch(() => {})
      }
      toast(L('הפגישה בוטלה', 'Meeting cancelled'))
      setMode('view')
      reload()
    }
  }

  return (
    <PublicShell wide={false}>
      <div className="confirm rise">
        {isNew && active && (
          <div className="confirm-hero">
            <div className="illus-frame" style={{ width: 150, height: 150 }}>
              <img className="illus" src="./illustrations/confirmed.webp" alt="" style={{ width: 150, height: 150, objectFit: 'cover' }} />
            </div>
            <div>
              <div className="eyebrow">{b.status === 'pending' ? L('נשלח לאישור', 'Sent for approval') : L('נקבע', 'Booked')}</div>
              <h1 style={{ fontSize: 'clamp(30px,4vw,44px)' }}>
                {b.status === 'pending' ? L('הבקשה בדרך', 'Request sent') : L('נתראה שם.', 'See you there.')}
              </h1>
              <p className="muted">
                {b.status === 'pending'
                  ? L(`${user.name} יאשר בקרוב. נעדכן במייל.`, `${user.name} will confirm soon. We will email you.`)
                  : L(`שלחנו אישור ל-${b.attendee.email}`, `A confirmation was sent to ${b.attendee.email}`)}
              </p>
            </div>
          </div>
        )}

        {b.payment && b.payment.status === 'unpaid' && active && (
          <div className="pay-box">
            <div>
              <div className="eyebrow">{L('תשלום', 'Payment')}</div>
              <div className="display" style={{ fontSize: 22 }}>{formatMoney(b.payment.amount, b.payment.currency, intl)}</div>
              {eventType?.price?.refundHours ? <div className="tiny muted">{L(`החזר מלא בביטול עד ${eventType.price.refundHours} שעות לפני`, `Full refund if cancelled ${eventType.price.refundHours}h before`)}</div> : null}
            </div>
            {paymentLinkUrl(b) ? (
              <a className="btn btn-accent" href={paymentLinkUrl(b)!} target="_blank" rel="noreferrer">
                {L('לתשלום מאובטח', 'Pay securely')}
              </a>
            ) : functionsUrl() ? (
              <button
                className="btn btn-accent"
                onClick={async () => {
                  try {
                    window.location.href = await startCheckout(b.token)
                  } catch (e) {
                    toast(String((e as Error).message), true)
                  }
                }}
              >
                {L('לתשלום מאובטח', 'Pay securely')}
              </button>
            ) : (
              <span className="small muted">{L('המארח ישלח פרטי תשלום', 'The host will send payment details')}</span>
            )}
          </div>
        )}
        {params.get('paid') === '1' && b.payment?.status !== 'paid' && <div className="notice small">{L('התשלום בעיבוד. העמוד יתעדכן כשיאושר.', 'Payment is processing. This page updates once confirmed.')}</div>}
        {b.payment?.status === 'paid' && <div className="notice accent small"><Icon name="check" /> {L('התשלום התקבל', 'Payment received')}</div>}
        {b.reconfirmedAt && <div className="notice small"><Icon name="check" /> {L('אישרת הגעה', 'You confirmed attendance')}</div>}

        <article className="receipt">
          <div className="receipt-head">
            <div className="row" style={{ gap: 12 }}>
              <Avatar name={user.name} src={user.avatarUrl} size={44} />
              <div>
                <div className="eyebrow">{user.name}</div>
                <h2 style={{ fontSize: 26 }}>{b.title}</h2>
              </div>
            </div>
            <StatusStamp status={b.status} noShow={b.noShow} />
          </div>
          <div className="receipt-perf" />
          <dl className="receipt-body">
            <div>
              <dt>{L('מתי', 'When')}</dt>
              <dd>
                <div className="display" style={{ fontSize: 20 }}>{fmtDate(b.start, tz)}</div>
                <div className="mono ltr">{fmtRange(b.start, b.end, tz)}</div>
                <div className="tiny muted">{tz}</div>
              </dd>
            </div>
            <div>
              <dt>{L('איפה', 'Where')}</dt>
              <dd>
                <span className="loc-glyph">{LOCATION_GLYPH[b.location.type]}</span> {locationName(b.location.type, L)}
                {where && (
                  <div className="small">
                    {/^https?:/.test(where) ? (
                      <a className="link ltr" href={where} target="_blank" rel="noreferrer">
                        {where}
                      </a>
                    ) : (
                      <span className="muted">{where}</span>
                    )}
                  </div>
                )}
              </dd>
            </div>
            <div>
              <dt>{L('מי', 'Who')}</dt>
              <dd>
                {b.attendee.name} <span className="muted ltr">&lt;{b.attendee.email}&gt;</span>
                {b.guests.length > 0 && <div className="small muted ltr">{b.guests.join(', ')}</div>}
              </dd>
            </div>
            {b.cancelReason && b.status === 'cancelled' && (
              <div>
                <dt>{L('סיבת ביטול', 'Reason')}</dt>
                <dd>{b.cancelReason}</dd>
              </div>
            )}
          </dl>
          {b.rescheduledToId && <div className="notice small">{L('הפגישה הועברה למועד אחר. הפרטים נשלחו במייל.', 'This meeting moved to a new time. Details were emailed.')}</div>}
        </article>

        {active && !past && mode === 'view' && (
          <>
            <div className="row wrap" style={{ gap: 8, justifyContent: 'center' }}>
              <a className="btn btn-line btn-sm" href={googleCalendarLink({ title: calTitle, start: b.start, end: b.end, details, location: where })} target="_blank" rel="noreferrer">
                Google Calendar
              </a>
              <a className="btn btn-line btn-sm" href={outlookLink({ title: calTitle, start: b.start, end: b.end, details, location: where })} target="_blank" rel="noreferrer">
                Outlook
              </a>
              <button className="btn btn-line btn-sm" onClick={() => downloadIcs({ uid: b.id, start: b.start, end: b.end, title: calTitle, description: details, location: where, organizerName: user.name, organizerEmail: user.email })}>
                <Icon name="download" size={15} /> Apple / ICS
              </button>
              {user.phone && (
                <a className="btn btn-line btn-sm" href={whatsappLink(user.phone, L(`היי ${user.name}, לגבי הפגישה שלנו (${b.title})`, `Hi ${user.name}, about our meeting (${b.title})`))} target="_blank" rel="noreferrer">
                  <Icon name="whatsapp" size={15} /> WhatsApp
                </a>
              )}
            </div>
            <div className="rule" />
            <div className="row" style={{ justifyContent: 'center', gap: 10 }}>
              {eventType && (
                <button className="btn btn-line" onClick={() => setMode('reschedule')}>
                  <Icon name="refresh" size={16} /> {L('שינוי מועד', 'Reschedule')}
                </button>
              )}
              <button className="btn btn-danger" onClick={() => setMode('cancel')}>
                {L('ביטול פגישה', 'Cancel')}
              </button>
            </div>
          </>
        )}

        {mode === 'cancel' && (
          <div className="card stack">
            <h3>{L('לבטל את הפגישה?', 'Cancel this meeting?')}</h3>
            <textarea className="textarea" placeholder={L('סיבה (עוזר למארח, לא חובה)', 'Reason (optional, helps the host)')} value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-accent" onClick={cancel}>
                {L('כן, לבטל', 'Yes, cancel')}
              </button>
              <button className="btn btn-ghost" onClick={() => setMode('view')}>
                {L('לא, השאר', 'Keep it')}
              </button>
            </div>
          </div>
        )}

        {!active && (
          <div style={{ textAlign: 'center' }}>
            <Link className="btn btn-line" to={`/${user.username}`}>
              {L('קביעת פגישה חדשה', 'Book again')}
            </Link>
          </div>
        )}
      </div>
    </PublicShell>
  )
}
