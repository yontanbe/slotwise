import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMe } from '../auth/AuthProvider'
import { useLoad, useStore } from '../data/StoreProvider'
import { useI18n } from '../i18n'
import { isGoogleConnected } from '../integrations/google'
import { Icon, useFocusTrap } from './ui'
import { newSchedule } from '../data/defaults'

const lsGet = (k: string) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* ignore */
  }
}
export const markShared = (userId: string) => lsSet('slotwise:shared:' + userId, '1')

/** Getting started checklist on the home screen. Every item is derived from real data. */
export function SetupChecklist() {
  const me = useMe()
  const store = useStore()
  const { L } = useI18n()
  const [hidden, setHidden] = useState(() => lsGet('slotwise:setup-hidden:' + me.id) === '1')
  const data = useLoad(async () => {
    const [ets, schedules, bookings, workflows] = await Promise.all([store.listEventTypes(me.id), store.listSchedules(me.id), store.listBookings(me.id), store.listKind('workflow', me.id)])
    return { ets, schedules, bookings, workflows }
  }, [me.id])
  if (hidden || !data.data) return null
  const d = data.data
  const items: { done: boolean; label: string; to: string; hint: string }[] = [
    { done: !!(me.bio || me.avatarUrl), label: L('להשלים פרופיל', 'Complete your profile'), to: '/app/settings', hint: L('תמונה וכמה מילים עליך', 'A photo and a few words') },
    { done: d.schedules.some((s) => s.overrides.length > 0 || JSON.stringify(s.weekly) !== JSON.stringify(newSchedule(me.id).weekly)) || lsGet('slotwise:hours:' + me.id) === '1', label: L('להגדיר שעות', 'Set your hours'), to: '/app/availability', hint: L('מתי אפשר לקבוע איתך', 'When people can book you') },
    { done: isGoogleConnected() || !!me.google?.email, label: L('לחבר Google Calendar', 'Connect Google Calendar'), to: '/app/integrations', hint: L('בלי התנגשויות, עם Meet', 'No clashes, with Meet') },
    { done: d.ets.some((e) => e.description), label: L('לסדר סוג פגישה', 'Polish an event type'), to: '/app/event-types', hint: L('שם, משך, מיקום ותיאור', 'Name, duration, location, description') },
    { done: lsGet('slotwise:shared:' + me.id) === '1', label: L('לשתף את הקישור', 'Share your link'), to: '/app', hint: L('בוואטסאפ, במייל או באתר', 'On WhatsApp, email or your site') },
    { done: d.workflows.length > 0, label: L('להוסיף תזכורת אוטומטית', 'Add an automatic reminder'), to: '/app/workflows', hint: L('24 שעות לפני, ב-WhatsApp', '24h before, on WhatsApp') },
    { done: d.bookings.some((b) => b.source !== 'manual' && !b.attendee.email.endsWith('@example.com')), label: L('לקבל פגישה ראשונה', 'Get your first booking'), to: `/${me.username}`, hint: L('נסו להזמין את עצמכם', 'Try booking yourself') },
  ]
  const done = items.filter((i) => i.done).length
  const pct = Math.round((done / items.length) * 100)
  if (done === items.length) return null
  const R = 58
  const C = 2 * Math.PI * R
  return (
    <section className="setup-card rise" aria-label={L('צעדים ראשונים', 'Getting started')}>
      <button className="icon-btn setup-close" onClick={() => { lsSet('slotwise:setup-hidden:' + me.id, '1'); setHidden(true) }} aria-label={L('הסתרה', 'Hide')}>
        <Icon name="x" size={14} />
      </button>
      <div className="setup-ring">
        <svg width="132" height="132" viewBox="0 0 132 132" aria-hidden>
          <circle cx="66" cy="66" r={R} fill="none" stroke="var(--rule)" strokeWidth="8" />
          <circle cx="66" cy="66" r={R} fill="none" stroke="var(--accent)" strokeWidth="8" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)} style={{ transition: 'stroke-dashoffset .8s ease' }} />
        </svg>
        <b>{pct}%</b>
      </div>
      <div className="stack" style={{ ['--gap' as string]: '10px' }}>
        <div>
          <div className="eyebrow">{L('צעדים ראשונים', 'Getting started')}</div>
          <h3 style={{ fontSize: 24 }}>{L(`עוד ${items.length - done} צעדים וסיימת`, `${items.length - done} steps to go`)}</h3>
        </div>
        <ul className="setup-list">
          {items.map((i) => (
            <li key={i.label} className={i.done ? 'done' : ''}>
              <Link to={i.to}>
                <span className="setup-check"><Icon name="check" size={13} stroke={2.4} /></span>
                <span className="grow">
                  <span className="t">{i.label}</span>
                  {!i.done && <span className="tiny muted" style={{ display: 'block' }}>{i.hint}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <Link to="/guide" className="link small" style={{ alignSelf: 'flex-start' }}>{L('המדריך המלא', 'Full guide')}</Link>
      </div>
    </section>
  )
}

interface Step {
  target?: string
  title: string
  text: string
}

/** First-run product tour with a spotlight over the navigation. */
export function ProductTour({ force, onDone }: { force?: boolean; onDone?: () => void }) {
  const me = useMe()
  const { L } = useI18n()
  const key = 'slotwise:tour:' + me.id
  const [open, setOpen] = useState(() => force || lsGet(key) !== '1')
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const steps: Step[] = [
    { title: L('ברוכים הבאים ל-Slotwise 👋', 'Welcome to Slotwise 👋'), text: L('סיור של 30 שניות: איפה כל דבר ואיך מקבלים פגישה ראשונה.', 'A 30 second tour: where things are and how to get your first booking.') },
    { target: '[data-tour="/app/availability"]', title: L('מתי אתם פנויים', 'When you are free'), text: L('שעות עבודה, ימי חופש ושעות מיוחדות. שבת וחגים נחסמים לבד.', 'Working hours, days off and special hours. Shabbat and holidays block themselves.') },
    { target: '[data-tour="/app/event-types"]', title: L('סוגי פגישות', 'Event types'), text: L('כל כרטיס הוא קישור: שיחת היכרות, ייעוץ, סדנה. משך, מיקום, שאלות ותשלום.', 'Each card is a link: intro, consult, workshop. Duration, location, questions and payment.') },
    { target: '[data-tour="/app/integrations"]', title: L('חיבור Google', 'Connect Google'), text: L('כדי שלא יקבעו לכם על פגישה אחרת, ושכל פגישה תיכנס ליומן עם Meet.', 'So nobody books over other meetings, and every booking lands on your calendar with Meet.') },
    { target: '[data-tour="/app/workflows"]', title: L('תזכורות לבד', 'Reminders on autopilot'), text: L('תבנית אחת והתזכורות ב-WhatsApp ובמייל יוצאות בזמן.', 'One template and WhatsApp and email reminders go out on time.') },
    { target: '[data-tour="share"]', title: L('הקישור שלכם', 'Your link'), text: L('לחיצה מעתיקה אותו. שלחו, והפגישות יתחילו להגיע.', 'Click to copy it. Send it and bookings start coming in.') },
  ]
  const step = steps[i]
  const popRef = useRef<HTMLDivElement>(null)
  useFocusTrap(popRef, open, '.tour-next')
  useEffect(() => {
    popRef.current?.querySelector<HTMLElement>('.tour-next')?.focus({ preventScroll: true })
  }, [i])

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const el = step.target ? (document.querySelector(step.target) as HTMLElement | null) : null
      if (el && el.offsetParent !== null) {
        el.scrollIntoView({ block: 'nearest' })
        setRect(el.getBoundingClientRect())
      } else setRect(null)
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, i, step.target])

  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish()
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') setI((x) => Math.max(0, Math.min(steps.length - 1, x + ((e.key === 'ArrowLeft') === (document.dir === 'rtl') ? 1 : -1))))
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const finish = () => {
    lsSet(key, '1')
    setOpen(false)
    onDone?.()
  }
  if (!open) return null
  const W = Math.min(340, window.innerWidth - 32)
  const pos = rect
    ? {
        top: Math.min(window.innerHeight - 230, Math.max(16, rect.top - 10)),
        left: document.dir === 'rtl' ? Math.max(16, rect.left - W - 18) : Math.min(window.innerWidth - W - 16, rect.right + 18),
      }
    : { top: window.innerHeight / 2 - 110, left: window.innerWidth / 2 - W / 2 }
  const narrow = window.innerWidth < 900
  return (
    <div className="tour-scrim" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {rect && !narrow ? <div className="tour-hole" style={{ top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8 }} /> : <div className="tour-hole" style={{ top: '50%', left: '50%', width: 0, height: 0 }} />}
      <div ref={popRef} className="tour-pop" style={narrow ? { left: 16, right: 16, bottom: 16, top: 'auto', width: 'auto' } : pos}>
        <div className="tour-dots">{steps.map((_, j) => <i key={j} className={j === i ? 'on' : ''} />)}</div>
        <h3 id="tour-title">{step.title}</h3>
        <p className="muted">{step.text}</p>
        <div className="row between" style={{ marginTop: 6 }}>
          <button className="btn btn-ghost btn-sm" onClick={finish}>{L('דילוג', 'Skip')}</button>
          <div className="row" style={{ gap: 6 }}>
            {i > 0 && <button className="btn btn-line btn-sm" onClick={() => setI(i - 1)}>{L('הקודם', 'Back')}</button>}
            {i < steps.length - 1 ? (
              <button className="btn btn-accent btn-sm tour-next" onClick={() => setI(i + 1)}>{L('הבא', 'Next')}</button>
            ) : (
              <button className="btn btn-accent btn-sm tour-next" onClick={finish}>{L('יאללה', 'Let’s go')}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
