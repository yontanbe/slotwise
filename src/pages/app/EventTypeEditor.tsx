import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMe } from '../../auth/AuthProvider'
import { RangeEditor } from '../../components/WeeklyEditor'
import { Field, Icon, Toggle, useCopy, useToast } from '../../components/ui'
import { BRAND_COLORS } from '../../data/defaults'
import { useLoad, useStore } from '../../data/StoreProvider'
import { useI18n } from '../../i18n'
import { uid } from '../../lib/id'
import { appUrl } from '../../lib/links'
import { LOCATION_GLYPH, LOCATION_TYPES, locationName } from '../../lib/locations'
import type { EventType, Question, QuestionType } from '../../lib/types'

type Tab = 'basics' | 'availability' | 'form' | 'advanced'

const QTYPES: QuestionType[] = ['text', 'textarea', 'number', 'email', 'phone', 'select', 'multiselect', 'radio', 'checkbox', 'boolean', 'url', 'address']

export default function EventTypeEditor() {
  const { id = '' } = useParams()
  const me = useMe()
  const store = useStore()
  const toast = useToast()
  const copy = useCopy()
  const { L, dir, weekdayShort } = useI18n()
  const data = useLoad(async () => {
    const ets = await store.listEventTypes(me.id)
    const cur = ets.find((e) => e.id === id)
    let names: Record<string, string> = {}
    if (cur?.teamId) {
      const t = (await store.listMyTeams(me.id)).find((x) => x.id === cur.teamId)
      const b = t ? await store.getTeam(t.slug) : null
      names = Object.fromEntries((b?.members ?? []).map((m) => [m.user.id, m.user.name]))
    }
    return { ets, schedules: await store.listSchedules(me.id), names }
  }, [me.id, id])
  const [et, setEt] = useState<EventType | null>(null)
  const [tab, setTab] = useState<Tab>('basics')
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!et && data.data) setEt(data.data.ets.find((e) => e.id === id) ?? null)
  }, [data.data, id, et])

  if (!data.data) return <div className="boot"><span className="boot-dot" /></div>
  if (!et) return <p>{L('לא נמצא', 'Not found')} · <Link className="link" to="/app/event-types">{L('חזרה', 'Back')}</Link></p>

  const set = <K extends keyof EventType>(k: K, v: EventType[K]) => {
    setEt({ ...et, [k]: v })
    setDirty(true)
  }
  const save = async () => {
    const slug = et.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    if (!slug) return toast(L('צריך כתובת (slug) באנגלית', 'A latin slug is required'), true)
    if (data.data!.ets.some((e) => e.id !== et.id && e.slug === slug)) return toast(L('הכתובת כבר בשימוש', 'Slug already used'), true)
    if (!et.durations.length) return toast(L('צריך לפחות משך אחד', 'Add at least one duration'), true)
    if (et.redirectUrl && !/^https?:\/\//i.test(et.redirectUrl)) return toast(L('כתובת הפניה חייבת להתחיל ב-https://', 'Redirect URL must start with https://'), true)
    if (et.price?.paymentLink && !/^https:\/\//i.test(et.price.paymentLink)) return toast(L('קישור תשלום חייב להתחיל ב-https://', 'Payment link must start with https://'), true)
    const durations = [...new Set(et.durations)].sort((a, b) => a - b)
    const next = { ...et, slug, durations, defaultDuration: durations.includes(et.defaultDuration) ? et.defaultDuration : durations[0] }
    await store.saveEventType(next)
    setEt(next)
    setDirty(false)
    toast(L('נשמר', 'Saved'))
  }

  const tabs: [Tab, string][] = [
    ['basics', L('בסיס', 'Basics')],
    ['availability', L('זמינות וכללים', 'Availability & rules')],
    ['form', L('טופס הזמנה', 'Booking form')],
    ['advanced', L('מתקדם', 'Advanced')],
  ]
  const num = (v: string) => (v === '' ? null : Math.max(0, Number(v)))

  return (
    <div className="stack" style={{ ['--gap' as string]: '22px' }}>
      <div className="row between wrap" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 10 }}>
          <Link to="/app/event-types" className="icon-btn" aria-label={L('חזרה', 'Back')}><Icon name={dir === 'rtl' ? 'chevR' : 'chevL'} /></Link>
          <span className="et-swatch" style={{ background: et.color }} />
          <h1 className="page-title" style={{ fontSize: 34 }}>{et.title || L('ללא שם', 'Untitled')}</h1>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-line" onClick={() => copy(appUrl(`/${me.username}/${et.slug}`))}><Icon name="copy" size={15} /> {L('קישור', 'Link')}</button>
          <a className="btn btn-line" href={appUrl(`/${me.username}/${et.slug}`)} target="_blank" rel="noreferrer"><Icon name="eye" size={15} /> {L('תצוגה', 'Preview')}</a>
          <button className="btn btn-accent" onClick={save} disabled={!dirty}>{L('שמירה', 'Save')}</button>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      <div className="editor card rise" key={tab}>
        {tab === 'basics' && (
          <div className="stack" style={{ ['--gap' as string]: '18px' }}>
            <div className="grid-2">
              <Field label={L('שם', 'Title')}>
                <input className="input" value={et.title} onChange={(e) => set('title', e.target.value)} />
              </Field>
              <Field label={L('כתובת', 'URL')}>
                <div className="input-group ltr">
                  <span className="addon">/{me.username}/</span>
                  <input aria-label={L('כתובת', 'URL slug')} className="input" value={et.slug} onChange={(e) => set('slug', e.target.value)} />
                </div>
              </Field>
            </div>
            <Field label={L('תיאור', 'Description')}>
              <textarea className="textarea" value={et.description} onChange={(e) => set('description', e.target.value)} />
            </Field>
            <Field label={L('צבע', 'Color')}>
              <div className="row" style={{ gap: 8 }}>
                {BRAND_COLORS.map((c) => (
                  <button key={c} className="swatch" style={{ background: c }} aria-pressed={et.color === c} onClick={() => set('color', c)} aria-label={c} />
                ))}
                <input type="color" value={et.color} onChange={(e) => set('color', e.target.value)} className="swatch-input" aria-label={L('צבע מותאם', 'Custom color')} />
              </div>
            </Field>
            <Field label={L('משכים אפשריים (המוזמן בוחר)', 'Durations (invitee picks)')} hint={L('לחצו על משך כדי להגדיר אותו כברירת מחדל', 'Click a duration to make it the default')}>
              <div className="row wrap" style={{ gap: 6 }}>
                {[10, 15, 20, 30, 45, 60, 75, 90, 120].map((d) => {
                  const on = et.durations.includes(d)
                  return (
                    <button
                      key={d}
                      type="button"
                      className={`chip${on ? (et.defaultDuration === d ? ' ink' : ' accent') : ''}`}
                      style={{ cursor: 'pointer', height: 32 }}
                      onClick={() => {
                        if (on && et.defaultDuration !== d) set('defaultDuration', d)
                        else if (on) set('durations', et.durations.filter((x) => x !== d))
                        else setEt({ ...et, durations: [...et.durations, d], defaultDuration: et.durations.length ? et.defaultDuration : d }), setDirty(true)
                      }}
                    >
                      {d} {L('דק׳', 'min')}
                    </button>
                  )
                })}
              </div>
            </Field>
            <Field label={L('מיקומים', 'Locations')} hint={L('אם יש יותר מאחד, המוזמן יבחר', 'If more than one, the invitee picks')}>
              <div className="stack" style={{ ['--gap' as string]: '8px' }}>
                {et.locations.map((l, i) => (
                  <div key={i} className="row" style={{ gap: 8 }}>
                    <span className="loc-glyph">{LOCATION_GLYPH[l.type]}</span>
                    <select aria-label={L('סוג מיקום', 'Location type')} className="select input-sm" style={{ maxWidth: 220 }} value={l.type} onChange={(e) => set('locations', et.locations.map((x, j) => (j === i ? { type: e.target.value as typeof l.type } : x)))}>
                      {LOCATION_TYPES.map((t) => <option key={t} value={t}>{locationName(t, L)}</option>)}
                    </select>
                    {['zoom', 'teams', 'in_person', 'link', 'phone_invitee'].includes(l.type) && (
                      <input
                        className="input input-sm grow"
                        placeholder={l.type === 'in_person' ? L('כתובת', 'Address') : l.type === 'phone_invitee' ? L('המספר שלך', 'Your number') : 'https://'}
                        value={l.value || ''}
                        onChange={(e) => set('locations', et.locations.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                      />
                    )}
                    <button className="icon-btn" onClick={() => set('locations', et.locations.filter((_, j) => j !== i))} aria-label={L('הסרה', 'Remove')}><Icon name="x" size={14} /></button>
                  </div>
                ))}
                <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => set('locations', [...et.locations, { type: 'meet' }])}>
                  <Icon name="plus" size={14} /> {L('הוספת מיקום', 'Add location')}
                </button>
              </div>
            </Field>
          </div>
        )}

        {tab === 'availability' && (
          <div className="stack" style={{ ['--gap' as string]: '18px' }}>
            <Field label={L('לוח זמינות', 'Schedule')}>
              <select className="select" value={et.scheduleId} onChange={(e) => set('scheduleId', e.target.value)}>
                {data.data!.schedules.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <div className="grid-3">
              <Field label={L('באפר לפני (דק׳)', 'Buffer before (min)')}>
                <input className="input" type="number" min={0} step={5} value={et.bufferBefore} onChange={(e) => set('bufferBefore', Number(e.target.value))} />
              </Field>
              <Field label={L('באפר אחרי (דק׳)', 'Buffer after (min)')}>
                <input className="input" type="number" min={0} step={5} value={et.bufferAfter} onChange={(e) => set('bufferAfter', Number(e.target.value))} />
              </Field>
              <Field label={L('התראה מינימלית', 'Minimum notice')}>
                <select className="select" value={et.minNoticeMins} onChange={(e) => set('minNoticeMins', Number(e.target.value))}>
                  {[0, 30, 60, 120, 240, 720, 1440, 2880, 10080].map((m) => (
                    <option key={m} value={m}>{m === 0 ? L('ללא', 'None') : m < 60 ? `${m} ${L('דק׳', 'min')}` : m < 1440 ? `${m / 60} ${L('שעות', 'hours')}` : `${m / 1440} ${L('ימים', 'days')}`}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="grid-3">
              <Field label={L('חלון הזמנה', 'Booking window')}>
                <select className="select" value={et.window.type} onChange={(e) => set('window', e.target.value === 'rolling' ? { type: 'rolling', days: 60 } : e.target.value === 'range' ? { type: 'range', start: new Date().toISOString().slice(0, 10), end: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) } : { type: 'unlimited' })}>
                  <option value="rolling">{L('ימים קדימה', 'Rolling days')}</option>
                  <option value="range">{L('טווח תאריכים', 'Date range')}</option>
                  <option value="unlimited">{L('ללא הגבלה', 'Unlimited')}</option>
                </select>
              </Field>
              {et.window.type === 'rolling' && (
                <Field label={L('כמה ימים', 'Days ahead')}>
                  <input className="input" type="number" min={1} value={et.window.days} onChange={(e) => set('window', { type: 'rolling', days: Math.max(1, Number(e.target.value)) })} />
                </Field>
              )}
              {et.window.type === 'range' && (
                <>
                  <Field label={L('מ-', 'From')}>
                    <input className="input ltr" type="date" value={et.window.start} onChange={(e) => set('window', { ...(et.window as { type: 'range'; start: string; end: string }), start: e.target.value })} />
                  </Field>
                  <Field label={L('עד', 'To')}>
                    <input className="input ltr" type="date" value={et.window.end} onChange={(e) => set('window', { ...(et.window as { type: 'range'; start: string; end: string }), end: e.target.value })} />
                  </Field>
                </>
              )}
              <Field label={L('מרווח בין זמני התחלה', 'Start time increments')}>
                <select className="select" value={et.slotInterval ?? ''} onChange={(e) => set('slotInterval', e.target.value ? Number(e.target.value) : null)}>
                  <option value="">{L('לפי משך הפגישה', 'Same as duration')}</option>
                  {[5, 10, 15, 20, 30, 60].map((m) => <option key={m} value={m}>{m} {L('דק׳', 'min')}</option>)}
                </select>
              </Field>
            </div>
            <hr className="rule" />
            <h3>{L('הגבלות', 'Limits')}</h3>
            <div className="grid-3">
              <Field label={L('מקסימום ביום', 'Max per day')}>
                <input className="input" type="number" min={0} value={et.limits.perDay ?? ''} onChange={(e) => set('limits', { ...et.limits, perDay: num(e.target.value) })} placeholder="∞" />
              </Field>
              <Field label={L('מקסימום בשבוע', 'Max per week')}>
                <input className="input" type="number" min={0} value={et.limits.perWeek ?? ''} onChange={(e) => set('limits', { ...et.limits, perWeek: num(e.target.value) })} placeholder="∞" />
              </Field>
              <Field label={L('מקסימום דקות ביום', 'Max minutes per day')}>
                <input className="input" type="number" min={0} step={15} value={et.limits.durationPerDay ?? ''} onChange={(e) => set('limits', { ...et.limits, durationPerDay: num(e.target.value) })} placeholder="∞" />
              </Field>
            </div>
            <label className="row" style={{ gap: 10 }}>
              <Toggle label={L('רק הזמן הראשון בכל יום', 'Only the first slot each day')} checked={et.firstSlotOnly} onChange={(v) => set('firstSlotOnly', v)} />
              <span>{L('להציג רק את הזמן הראשון בכל יום', 'Only show the first slot of each day')}</span>
            </label>
            <hr className="rule" />
            <div>
              <h3>{L('שעות מועדפות', 'Preferred hours')}</h3>
              <p className="small muted">{L('יסומנו בכוכבית בדף ההזמנה. שאר הזמנים עדיין פתוחים.', 'Highlighted with a star on the booking page. Other times stay open.')}</p>
            </div>
            <div className="weekly">
              {[0, 1, 2, 3, 4, 5, 6].map((d) => {
                const ranges = et.preferred.filter((p) => p.day === d).map((p) => ({ start: p.start, end: p.end }))
                return (
                  <div key={d} className="weekly-row">
                    <b className="weekly-day" style={{ minWidth: 60 }}>{weekdayShort(d)}</b>
                    {ranges.length ? (
                      <RangeEditor ranges={ranges} onChange={(r) => set('preferred', [...et.preferred.filter((p) => p.day !== d), ...r.map((x) => ({ day: d, ...x }))])} />
                    ) : (
                      <button className="btn btn-ghost btn-sm" onClick={() => set('preferred', [...et.preferred, { day: d, start: '10:00', end: '12:00' }])}><Icon name="plus" size={14} /> {L('הוספה', 'Add')}</button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {tab === 'form' && <QuestionsEditor questions={et.questions} onChange={(q) => set('questions', q)} />}

        {tab === 'advanced' && (
          <div className="stack" style={{ ['--gap' as string]: '20px' }}>
            <Setting title={L('דורש אישור', 'Requires confirmation')} text={L('ההזמנה תמתין לאישור שלך לפני שתיכנס ליומן.', 'Bookings wait for your approval before hitting the calendar.')}>
              <Toggle label={L('דורש אישור', 'Requires confirmation')} checked={et.requiresConfirmation} onChange={(v) => set('requiresConfirmation', v)} />
            </Setting>
            {et.requiresConfirmation && (
              <Setting title={L('דחייה אוטומטית', 'Auto decline')} text={L('בקשה שלא אושרה תוך X שעות תידחה ותשוחרר.', 'Requests not approved within X hours are declined and freed.')}>
                <input className="input input-sm" type="number" min={0} style={{ width: 90 }} placeholder="∞" value={et.autoDeclineHours ?? ''} onChange={(e) => set('autoDeclineHours', e.target.value ? Number(e.target.value) : null)} />
              </Setting>
            )}
            <Setting title={L('פגישה חוזרת', 'Recurring')} text={L('המוזמן יכול לקבוע סדרה של פגישות במכה אחת.', 'Invitees can book a series in one go.')}>
              <div className="row" style={{ gap: 8 }}>
                {et.recurring && (
                  <>
                    <select className="select input-sm" style={{ width: 'auto' }} value={et.recurring.freq} onChange={(e) => set('recurring', { ...et.recurring!, freq: e.target.value as 'weekly' })}>
                      <option value="weekly">{L('כל שבוע', 'Weekly')}</option>
                      <option value="biweekly">{L('כל שבועיים', 'Every 2 weeks')}</option>
                      <option value="monthly">{L('כל חודש', 'Monthly')}</option>
                    </select>
                    <input className="input input-sm" type="number" min={2} max={52} style={{ width: 70 }} value={et.recurring.maxCount} onChange={(e) => set('recurring', { ...et.recurring!, maxCount: Math.min(52, Math.max(2, Number(e.target.value))) })} />
                  </>
                )}
                <Toggle label={L('פגישה חוזרת', 'Recurring')} checked={!!et.recurring} onChange={(v) => set('recurring', v ? { freq: 'weekly', maxCount: 4 } : null)} />
              </div>
            </Setting>
            <Setting title={L('תשלום', 'Payment')} text={L('מחיר, מקדמה ומדיניות החזר. בלי שרת: Stripe Payment Link. עם שרת: Stripe Checkout אוטומטי.', 'Price, deposit and refund policy. Without a server: a Stripe Payment Link. With one: automatic Stripe Checkout.')}>
              <Toggle label={L('תשלום', 'Payment')} checked={!!et.price} onChange={(v) => set('price', v ? { amount: 200, currency: 'ILS', mode: 'full', refundHours: 24 } : null)} />
            </Setting>
            {et.price && (
              <div className="card-flat stack" style={{ ['--gap' as string]: '12px' }}>
                <div className="grid-3">
                  <Field label={L('מחיר', 'Price')}>
                    <input className="input" type="number" min={0} value={et.price.amount} onChange={(e) => set('price', { ...et.price!, amount: Number(e.target.value) })} />
                  </Field>
                  <Field label={L('מטבע', 'Currency')}>
                    <select className="select" value={et.price.currency} onChange={(e) => set('price', { ...et.price!, currency: e.target.value as 'ILS' })}>
                      <option>ILS</option><option>USD</option><option>EUR</option>
                    </select>
                  </Field>
                  <Field label={L('גבייה', 'Charge')}>
                    <select className="select" value={et.price.mode} onChange={(e) => set('price', { ...et.price!, mode: e.target.value as 'full' })}>
                      <option value="full">{L('מלא', 'Full')}</option>
                      <option value="deposit">{L('מקדמה', 'Deposit')}</option>
                    </select>
                  </Field>
                </div>
                <div className="grid-3">
                  {et.price.mode === 'deposit' && (
                    <Field label={L('סכום מקדמה', 'Deposit')}>
                      <input className="input" type="number" min={0} value={et.price.depositAmount ?? ''} onChange={(e) => set('price', { ...et.price!, depositAmount: Number(e.target.value) })} />
                    </Field>
                  )}
                  <Field label={L('החזר מלא עד (שעות לפני)', 'Full refund until (hours before)')}>
                    <input className="input" type="number" min={0} value={et.price.refundHours ?? ''} onChange={(e) => set('price', { ...et.price!, refundHours: e.target.value ? Number(e.target.value) : undefined })} />
                  </Field>
                  <Field label={L('דמי אי הגעה', 'No show fee')}>
                    <input className="input" type="number" min={0} value={et.price.noShowFee ?? ''} onChange={(e) => set('price', { ...et.price!, noShowFee: e.target.value ? Number(e.target.value) : undefined })} />
                  </Field>
                </div>
                <Field label="Stripe Payment Link" hint={L('אופציונלי. נוסיף client_reference_id עם מזהה הפגישה.', 'Optional. We add client_reference_id with the booking id.')}>
                  <input className="input ltr" placeholder="https://buy.stripe.com/..." value={et.price.paymentLink ?? ''} onChange={(e) => set('price', { ...et.price!, paymentLink: e.target.value })} />
                </Field>
              </div>
            )}
            <Setting title={L('הגבלה לכל מוזמן', 'Per invitee limit')} text={L('כמה פגישות מותר לאותו מייל בתקופה.', 'How many bookings one email may make in a period.')}>
              <div className="row" style={{ gap: 6 }}>
                {et.perInviteeLimit && (
                  <>
                    <input className="input input-sm" type="number" min={1} style={{ width: 64 }} value={et.perInviteeLimit.count} onChange={(e) => set('perInviteeLimit', { ...et.perInviteeLimit!, count: Math.max(1, Number(e.target.value)) })} />
                    <span className="small">{L('ב-', 'per')}</span>
                    <input className="input input-sm" type="number" min={1} style={{ width: 70 }} value={et.perInviteeLimit.days} onChange={(e) => set('perInviteeLimit', { ...et.perInviteeLimit!, days: Math.max(1, Number(e.target.value)) })} />
                    <span className="small">{L('ימים', 'days')}</span>
                  </>
                )}
                <Toggle label={L('הגבלה לכל מוזמן', 'Per invitee limit')} checked={!!et.perInviteeLimit} onChange={(v) => set('perInviteeLimit', v ? { count: 1, days: 30 } : null)} />
              </div>
            </Setting>
            {et.teamId && (
              <div className="card-flat stack" style={{ ['--gap' as string]: '10px' }}>
                <b>{L('מארחים', 'Hosts')} · {et.schedulingType === 'collective' ? L('משותף', 'Collective') : L('סבב', 'Round robin')}</b>
                {(et.hosts || []).map((h, i) => (
                  <div key={h.userId} className="row wrap" style={{ gap: 8 }}>
                    <span className="small grow">{data.data!.names[h.userId] ?? h.userId}</span>
                    {et.schedulingType !== 'collective' && (
                      <>
                        <select className="select input-sm" style={{ width: 'auto' }} value={h.priority} onChange={(e) => set('hosts', et.hosts!.map((x, j) => (j === i ? { ...x, priority: Number(e.target.value) } : x)))}>
                          <option value={0}>{L('עדיפות נמוכה', 'Low')}</option>
                          <option value={1}>{L('בינונית', 'Medium')}</option>
                          <option value={2}>{L('גבוהה', 'High')}</option>
                          <option value={3}>{L('דחופה', 'Urgent')}</option>
                        </select>
                        <input className="input input-sm" type="number" min={1} max={100} style={{ width: 70 }} title={L('משקל', 'Weight')} value={h.weight} onChange={(e) => set('hosts', et.hosts!.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x)))} />
                      </>
                    )}
                    <button className="icon-btn" disabled={(et.hosts || []).length < 2} onClick={() => set('hosts', et.hosts!.filter((_, j) => j !== i))} aria-label={L('הסרה', 'Remove')}><Icon name="x" size={12} /></button>
                  </div>
                ))}
              </div>
            )}
            <Setting title={L('אירוע קבוצתי (מושבים)', 'Group event (seats)')} text={L('כמה אנשים יכולים להזמין את אותו מועד.', 'Several people can book the same time.')}>
              <div className="row" style={{ gap: 8 }}>
                {et.seats ? <input className="input input-sm" type="number" min={2} style={{ width: 90 }} value={et.seats} onChange={(e) => set('seats', Math.max(2, Number(e.target.value)))} /> : null}
                <Toggle label={L('אירוע קבוצתי', 'Group event')} checked={!!et.seats} onChange={(v) => set('seats', v ? 5 : null)} />
              </div>
            </Setting>
            <Setting title={L('נעילת אזור זמן', 'Lock timezone')} text={L('לפגישות פרונטליות: הזמנים יוצגו תמיד באזור הזמן שלך.', 'For in person events: always show times in your timezone.')}>
              <Toggle label={L('נעילת אזור זמן', 'Lock timezone')} checked={et.lockTimezone} onChange={(v) => set('lockTimezone', v)} />
            </Setting>
            <Setting title={L('מוסתר מהפרופיל', 'Hidden from profile')} text={L('רק מי שיש לו את הקישור יוכל להזמין.', 'Only people with the link can book.')}>
              <Toggle label={L('מוסתר מהפרופיל', 'Hidden from profile')} checked={et.hidden} onChange={(v) => set('hidden', v)} />
            </Setting>
            <Field label={L('הפניה אחרי הזמנה', 'Redirect after booking')} hint={L('נוסיף name, email, start ו-event לכתובת. בלי דף אזהרה.', 'We append name, email, start and event. No interstitial page.')}>
              <input className={`input ltr${et.redirectUrl && !/^https?:\/\//i.test(et.redirectUrl) ? ' err' : ''}`} type="url" placeholder="https://" value={et.redirectUrl} onChange={(e) => set('redirectUrl', e.target.value)} />
            </Field>
            <div className="notice small">
              <Icon name="link" />
              <div>
                {L('מילוי מראש מה-URL:', 'Prefill from the URL:')} <span className="mono ltr">?name=…&email=…&phone=…&notes=…&duration=30&date=2026-12-01&utm_source=…</span>
                {et.questions.length > 0 && <> · {L('לשאלות:', 'Questions:')} <span className="mono ltr">{et.questions.map((q) => `${q.id}=…`).join('&')}</span></>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Setting({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return (
    <div className="row between" style={{ gap: 16, alignItems: 'flex-start' }}>
      <div>
        <b>{title}</b>
        <p className="small muted">{text}</p>
      </div>
      {children}
    </div>
  )
}

function QuestionsEditor({ questions, onChange }: { questions: Question[]; onChange: (q: Question[]) => void }) {
  const { L } = useI18n()
  const typeName: Record<QuestionType, string> = {
    text: L('טקסט קצר', 'Short text'),
    textarea: L('טקסט ארוך', 'Long text'),
    number: L('מספר', 'Number'),
    email: L('מייל', 'Email'),
    phone: L('טלפון', 'Phone'),
    select: L('רשימה נפתחת', 'Select'),
    multiselect: L('בחירה מרובה', 'Multi select'),
    radio: L('בחירה יחידה', 'Radio'),
    checkbox: L('תיבת סימון', 'Checkbox'),
    boolean: L('כן / לא', 'Yes / No'),
    url: 'URL',
    address: L('כתובת', 'Address'),
  }
  const upd = (i: number, p: Partial<Question>) => onChange(questions.map((q, j) => (j === i ? { ...q, ...p } : q)))
  return (
    <div className="stack" style={{ ['--gap' as string]: '14px' }}>
      <div className="notice small">{L('שם, מייל וטלפון תמיד נשאלים. כאן מוסיפים שאלות משלכם.', 'Name, email and phone are always asked. Add your own questions here.')}</div>
      {questions.map((q, i) => (
        <div key={q.id} className="q-card">
          <div className="row wrap" style={{ gap: 8 }}>
            <span className="mono tiny muted">{q.id}</span>
            <input className="input input-sm grow" style={{ minWidth: 200 }} value={q.label} placeholder={L('השאלה', 'Question')} onChange={(e) => upd(i, { label: e.target.value })} />
            <select className="select input-sm" style={{ width: 160 }} value={q.type} onChange={(e) => upd(i, { type: e.target.value as QuestionType })}>
              {QTYPES.map((t) => <option key={t} value={t}>{typeName[t]}</option>)}
            </select>
            <label className="check small"><input type="checkbox" checked={q.required} onChange={(e) => upd(i, { required: e.target.checked })} /> {L('חובה', 'Required')}</label>
            <button className="icon-btn" disabled={i === 0} onClick={() => { const a = [...questions]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; onChange(a) }} aria-label={L('הזזה למעלה', 'Move up')}>↑</button>
            <button className="icon-btn" onClick={() => onChange(questions.filter((_, j) => j !== i))} aria-label={L('מחיקה', 'Delete')}><Icon name="trash" size={14} /></button>
          </div>
          {['select', 'multiselect', 'radio', 'checkbox'].includes(q.type) && (
            <Field label={L('אפשרויות (שורה לכל אחת)', 'Options (one per line)')}>
              <textarea className="textarea" style={{ minHeight: 70 }} value={(q.options || []).join('\n')} onChange={(e) => upd(i, { options: e.target.value.split('\n').filter((x, k, arr) => x.trim() || k === arr.length - 1) })} />
            </Field>
          )}
          {i > 0 && (
            <div className="row wrap small" style={{ gap: 6 }}>
              <span className="muted">{L('להציג רק אם', 'Show only if')}</span>
              <select className="select input-sm" style={{ width: 'auto' }} value={q.showIf?.questionId || ''} onChange={(e) => upd(i, { showIf: e.target.value ? { questionId: e.target.value, equals: q.showIf?.equals || '' } : undefined })}>
                <option value="">{L('תמיד', 'Always')}</option>
                {questions.slice(0, i).map((p) => <option key={p.id} value={p.id}>{p.label || p.id}</option>)}
              </select>
              {q.showIf && (
                <>
                  <span className="muted">=</span>
                  <input className="input input-sm" style={{ width: 160 }} value={q.showIf.equals} onChange={(e) => upd(i, { showIf: { ...q.showIf!, equals: e.target.value } })} />
                </>
              )}
            </div>
          )}
        </div>
      ))}
      <button className="btn btn-line" style={{ alignSelf: 'flex-start' }} onClick={() => onChange([...questions, { id: 'q' + uid(4), type: 'text', label: '', required: false }])}>
        <Icon name="plus" size={15} /> {L('הוספת שאלה', 'Add question')}
      </button>
    </div>
  )
}
