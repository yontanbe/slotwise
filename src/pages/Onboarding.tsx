import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, useMe } from '../auth/AuthProvider'
import { Prefs } from '../components/PublicShell'
import WeeklyEditor from '../components/WeeklyEditor'
import { Field, Icon, Logo, TimezoneSelect, useToast } from '../components/ui'
import { newEventType, newSchedule } from '../data/defaults'
import { useLoad, useStore } from '../data/StoreProvider'
import { useI18n } from '../i18n'
import { isReservedUsername } from '../lib/id'
import { connectGoogle, getUserEmail, isGoogleConfigured, isGoogleConnected } from '../integrations/google'
import { slugify } from '../lib/id'
import { CITIES } from '../lib/holidays'
import type { TimeRange } from '../lib/types'

export default function Onboarding() {
  const me = useMe()
  const { refresh } = useAuth()
  const store = useStore()
  const nav = useNavigate()
  const toast = useToast()
  const { L, locale, setLocale, dir } = useI18n()
  const schedules = useLoad(() => store.listSchedules(me.id), [me.id])
  const [step, setStep] = useState(0)
  const [name, setName] = useState(me.name)
  const [username, setUsername] = useState(me.username)
  const [tz, setTz] = useState(me.timezone)
  const [city, setCity] = useState(me.shabbat.city)
  const [shabbat, setShabbat] = useState(me.shabbat.enabled)
  const [weekly, setWeekly] = useState<TimeRange[][] | null>(null)
  const [title, setTitle] = useState(L('שיחת היכרות', 'Intro call'))
  const [duration, setDuration] = useState(30)
  const [gConnected, setG] = useState(isGoogleConnected())
  const [gEmail, setGEmail] = useState(me.google?.email || '')

  const sched = schedules.data?.find((s) => s.id === me.defaultScheduleId) ?? schedules.data?.[0]
  const w = weekly ?? sched?.weekly ?? newSchedule(me.id).weekly
  const steps = [L('פרופיל', 'Profile'), L('יומן', 'Calendar'), L('שעות', 'Hours'), L('פגישה ראשונה', 'First event')]
  const arrow = dir === 'rtl' ? 'chevL' : 'chevR'

  const next = async () => {
    if (step === 0) {
      const u = username.toLowerCase().replace(/[^a-z0-9-_]/g, '')
      if (u.length < 3) return toast(L('שם משתמש של 3 תווים לפחות, באנגלית', 'Username needs 3+ latin characters'), true)
    if (isReservedUsername(u)) return toast(L('שם המשתמש שמור למערכת', 'That username is reserved'), true)
      if (!(await store.isUsernameFree(u, me.id))) return toast(L('שם המשתמש תפוס', 'Username is taken'), true)
      setUsername(u)
    }
    setStep(step + 1)
  }

  const finish = async () => {
    let s = sched
    if (!s) s = newSchedule(me.id, L('שעות עבודה', 'Working hours'), tz)
    await store.saveSchedule({ ...s, weekly: w, timezone: tz })
    const et = newEventType(me.id, s.id, title, duration)
    et.slug = slugify(title)
    if (!/^[a-z0-9-]+$/.test(et.slug)) et.slug = duration + 'min'
    await store.saveEventType(et)
    await store.saveUser({
      ...me,
      name,
      username,
      timezone: tz,
      locale,
      defaultScheduleId: s.id,
      shabbat: { ...me.shabbat, enabled: shabbat, city },
      onboarded: true,
      google: gConnected ? { conflictCalendars: ['primary'], destinationCalendar: 'primary', sendWithGmail: true, ...me.google, email: gEmail } : me.google,
    })
    await refresh()
    toast(L('הכל מוכן', 'All set'))
    nav('/app')
  }

  return (
    <div className="onboard">
      <header className="public-top container">
        <Logo size={18} />
        <Prefs />
      </header>
      <div className="container onboard-grid">
        <aside className="onboard-side">
          <div className="illus-frame">
            <img className="illus" src="./illustrations/onboarding.webp" alt="" />
          </div>
          <ol className="onboard-steps">
            {steps.map((s, i) => (
              <li key={s} aria-current={i === step} className={i < step ? 'done' : ''}>
                <span className="mono">{String(i + 1).padStart(2, '0')}</span> {s}
              </li>
            ))}
          </ol>
        </aside>
        <main className="onboard-main card rise" key={step}>
          {step === 0 && (
            <div className="stack" style={{ ['--gap' as string]: '16px' }}>
              <h2>{L('נעים להכיר.', 'Nice to meet you.')}</h2>
              <Field label={L('שם מלא', 'Full name')}>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label={L('הקישור שלך', 'Your link')} hint={L('אותיות באנגלית, ספרות ומקף', 'Latin letters, digits and dashes')}>
                <div className="input-group ltr">
                  <span className="addon">slotwise/</span>
                  <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} />
                </div>
              </Field>
              <div className="grid-2">
                <Field label={L('אזור זמן', 'Timezone')}>
                  <TimezoneSelect value={tz} onChange={setTz} />
                </Field>
                <Field label={L('שפה', 'Language')}>
                  <select className="select" value={locale} onChange={(e) => setLocale(e.target.value as 'he' | 'en')}>
                    <option value="he">עברית</option>
                    <option value="en">English</option>
                  </select>
                </Field>
              </div>
              <div className="notice">
                <div className="stack grow" style={{ ['--gap' as string]: '8px' }}>
                  <label className="check">
                    <input type="checkbox" checked={shabbat} onChange={(e) => setShabbat(e.target.checked)} />
                    {L('לחסום אוטומטית שבתות וחגים', 'Auto block Shabbat and holidays')}
                  </label>
                  {shabbat && (
                    <select className="select input-sm" value={city} onChange={(e) => setCity(e.target.value)}>
                      {CITIES.map((c) => (
                        <option key={c.key} value={c.key}>{locale === 'he' ? c.he : c.en}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            </div>
          )}
          {step === 1 && (
            <div className="stack" style={{ ['--gap' as string]: '16px' }}>
              <h2>{L('חיבור Google Calendar', 'Connect Google Calendar')}</h2>
              <p className="muted">{L('כדי שלא יקבעו לך פגישה על פגישה, ושכל פגישה תיכנס ליומן עם קישור Meet.', 'So nobody books over your meetings, and every booking lands on your calendar with a Meet link.')}</p>
              {gConnected ? (
                <div className="notice accent"><Icon name="check" /> {L('מחובר', 'Connected')} {gEmail && <span className="ltr">· {gEmail}</span>}</div>
              ) : isGoogleConfigured() ? (
                <button
                  className="btn btn-line btn-lg"
                  onClick={async () => {
                    try {
                      await connectGoogle(true)
                      setG(true)
                      setGEmail(await getUserEmail().catch(() => ''))
                    } catch (e) {
                      toast(String((e as Error).message), true)
                    }
                  }}
                >
                  <Icon name="calendar" /> {L('חיבור עם Google', 'Connect with Google')}
                </button>
              ) : (
                <div className="notice small">
                  <Icon name="plug" />
                  <div>{L('צריך להגדיר Google Client ID (הגדרות > חיבורים). אפשר לדלג ולחבר אחר כך.', 'A Google Client ID is needed (Settings > Integrations). You can skip and connect later.')}</div>
                </div>
              )}
            </div>
          )}
          {step === 2 && (
            <div className="stack" style={{ ['--gap' as string]: '16px' }}>
              <h2>{L('מתי אפשר לקבוע איתך?', 'When can people book you?')}</h2>
              <WeeklyEditor weekly={w} onChange={setWeekly} weekStart={me.weekStart} />
            </div>
          )}
          {step === 3 && (
            <div className="stack" style={{ ['--gap' as string]: '16px' }}>
              <h2>{L('הפגישה הראשונה שלך', 'Your first event type')}</h2>
              <Field label={L('שם', 'Title')}>
                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <Field label={L('משך', 'Duration')}>
                <div className="seg">
                  {[15, 20, 30, 45, 60].map((d) => (
                    <button key={d} type="button" aria-pressed={duration === d} onClick={() => setDuration(d)}>{d}</button>
                  ))}
                </div>
              </Field>
            </div>
          )}
          <div className="row between" style={{ marginTop: 28 }}>
            <button className="btn btn-ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>{L('חזרה', 'Back')}</button>
            {step < 3 ? (
              <button className="btn" onClick={next}>
                {step === 1 && !gConnected ? L('דילוג', 'Skip') : L('המשך', 'Continue')} <Icon name={arrow} />
              </button>
            ) : (
              <button className="btn btn-accent" onClick={finish}>{L('סיום', 'Finish')} <Icon name="check" /></button>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
