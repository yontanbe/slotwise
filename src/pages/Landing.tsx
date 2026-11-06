import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { Prefs } from '../components/PublicShell'
import { Icon, Logo } from '../components/ui'
import { useI18n } from '../i18n'

/** Reveals children with a short rise when they scroll into view. */
function Reveal({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!('IntersectionObserver' in window)) return setShown(true)
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => e.isIntersecting && (setShown(true), io.disconnect())),
      { rootMargin: '0px 0px -10% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <div ref={ref} className={`reveal${shown ? ' in' : ''} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  )
}

const FAN = ['08:30', '09:00', '09:45', '10:30', '11:15', '13:00', '14:30', '16:00']

function TicketFan({ onPick }: { onPick: () => void }) {
  const { L } = useI18n()
  const [picked, setPicked] = useState<number | null>(null)
  return (
    <div className="fan" aria-hidden>
      {FAN.map((t, i) => (
        <button
          key={t}
          tabIndex={-1}
          className={`fan-ticket${i % 2 ? ' ink' : ''}${picked === i ? ' picked' : ''}`}
          style={{ ['--i' as string]: i, ['--n' as string]: FAN.length }}
          onMouseEnter={() => setPicked(i)}
          onClick={onPick}
        >
          <span className="fan-perf" />
          <span className="fan-time">{t}</span>
          <span className="fan-meta">{i === 3 ? L('★ מועדף', '★ preferred') : L('פנוי', 'open')}</span>
        </button>
      ))}
    </div>
  )
}

function Terminal() {
  const lines = [
    '> get_availability { event: "intro", days: 3 }',
    '  ✓ 14 open slots · Sun 09:00, 09:20, 10:20 …',
    '> create_booking { start: "Sun 10:20", email: "dana@…" }',
    '  ✓ booked · Meet link sent · WhatsApp reminder set',
  ]
  const [n, setN] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setN((x) => (x >= lines.length + 2 ? 0 : x + 1)), 1100)
    return () => clearInterval(t)
  }, [lines.length])
  return (
    <div className="terminal" dir="ltr">
      <div className="terminal-bar">
        <span />
        <span />
        <span />
        <b>slotwise · mcp</b>
      </div>
      {lines.slice(0, n).map((l, i) => (
        <div key={i} className={l.startsWith('>') ? 'cmd' : 'ok'}>
          {l}
        </div>
      ))}
      <div className="cursor">▍</div>
    </div>
  )
}

export default function Landing() {
  const { L, dir, locale } = useI18n()
  const auth = useAuth()
  const nav = useNavigate()
  const arrow = dir === 'rtl' ? 'chevL' : 'chevR'

  const tryDemo = async () => {
    if (auth.mode === 'demo') {
      await auth.enterDemo()
      nav('/app')
    } else nav('/login')
  }
  const days = locale === 'he' ? ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'] : ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

  return (
    <div className="landing v2">
      <header className="public-top container land-top">
        <Logo size={20} />
        <nav className="row" style={{ gap: 8 }}>
          <a className="btn btn-ghost btn-sm hide-sm" href="#features" onClick={(e) => { e.preventDefault(); document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' }) }}>
            {L('מה בפנים', 'Features')}
          </a>
          <Link className="btn btn-ghost btn-sm hide-sm" to="/guide">{L('מדריך הקמה', 'Setup guide')}</Link>
          {auth.status === 'in' ? (
            <Link className="btn btn-sm" to="/app">{L('לדשבורד', 'Dashboard')}</Link>
          ) : (
            <Link className="btn btn-line btn-sm" to="/login">{L('כניסה', 'Log in')}</Link>
          )}
          <Prefs />
        </nav>
      </header>

      <section className="hero2 container">
        <div className="hero2-copy">
          <div className="eyebrow rise">{L('קביעת פגישות · עברית ואנגלית · WhatsApp · AI', 'Scheduling · Hebrew & English · WhatsApp · AI')}</div>
          <h1 className="hero2-title rise" style={{ animationDelay: '80ms' }}>
            {L('תפסו', 'Own')}
            <br />
            {L('את', 'your')} <em>{L('הזמן.', 'time.')}</em>
          </h1>
          <p className="hero2-sub rise" style={{ animationDelay: '160ms' }}>
            {L(
              'קישור אחד שמראה רק את מה שבאמת פנוי אצלך, נכנס ליומן עם קישור Meet, שולח אישור ותזכורת ב-WhatsApp ושומר לך על השבת. בלי הלוך ושוב.',
              'One link that shows only what is truly open, lands on your calendar with a Meet link, confirms and reminds on WhatsApp and keeps your Shabbat. No back and forth.',
            )}
          </p>
          <div className="row wrap rise" style={{ gap: 10, animationDelay: '240ms' }}>
            <button className="btn btn-accent btn-lg" onClick={tryDemo}>
              {L('נסו עכשיו, בחינם', 'Try it free')} <Icon name={arrow} />
            </button>
            <Link className="btn btn-line btn-lg" to="/yonatan/intro">{L('איך זה נראה למוזמן', 'See the invitee view')}</Link>
          </div>
          <ul className="hero2-proof rise" style={{ animationDelay: '320ms' }}>
            <li><b>0</b> {L('מיילים של הלוך ושוב', 'back and forth emails')}</li>
            <li><b>30″</b> {L('לקביעת פגישה', 'to book a meeting')}</li>
            <li><b>24/7</b> {L('תזכורות אוטומטיות', 'automatic reminders')}</li>
          </ul>
        </div>
        <div className="hero2-art">
          <TicketFan onPick={() => nav('/yonatan/intro')} />
          <span className="stamp ok hero2-stamp">{L('נקבע ✓', 'Booked ✓')}</span>
        </div>
      </section>

      <div className="timeline" aria-hidden>
        <div className="timeline-track">
          {Array.from({ length: 4 }).flatMap((_, r) =>
            days.map((d, i) => (
              <span key={r + '-' + i}>
                <small>{i % 2 ? 'PM' : 'AM'}</small>
                {d}
              </span>
            )),
          )}
        </div>
      </div>

      <section className="container how" id="how">
        <Reveal>
          <div className="section-head">
            <span className="eyebrow">{L('שלושה צעדים', 'Three steps')}</span>
            <h2>{L('מהגדרה לפגישה ראשונה בחמש דקות.', 'From setup to first booking in five minutes.')}</h2>
          </div>
        </Reveal>
        <div className="how-grid">
          {[
            ['01', L('מגדירים מתי פנויים', 'Set when you are free'), L('שעות עבודה, חריגות, שבתות וחגים, באפרים והגבלות. כמה לוחות לפי הצורך.', 'Hours, overrides, Shabbat and holidays, buffers and caps. As many schedules as you need.'), 'clock'],
            ['02', L('מחברים את Google', 'Connect Google'), L('בודקים התנגשויות בכל היומנים, יוצרים אירוע עם Meet ושולחים מה-Gmail שלך.', 'Conflicts from every calendar, events with Meet, emails from your Gmail.'), 'calendar'],
            ['03', L('משתפים קישור', 'Share one link'), L('בוואטסאפ, במייל, באתר או דרך סוכן AI. המוזמן בוחר, הכל השאר קורה לבד.', 'On WhatsApp, email, your site or an AI agent. They pick, the rest happens on its own.'), 'link'],
          ].map(([n, t, d, ic], i) => (
            <Reveal key={n} delay={i * 90}>
              <article className="how-card">
                <span className="how-n">{n}</span>
                <span className="how-ic"><Icon name={ic} size={22} /></span>
                <h3>{t}</h3>
                <p className="muted">{d}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="container bento-wrap" id="features">
        <Reveal>
          <div className="section-head">
            <span className="eyebrow">{L('מה בפנים', 'What is inside')}</span>
            <h2>{L('כל מה שקלנדלי עושה. ועוד הרבה.', 'Everything Calendly does. And a lot more.')}</h2>
          </div>
        </Reveal>
        <div className="bento">
          <Reveal className="b-timetable">
            <article className="b-card">
              <div className="b-label">{L('זמינות חכמה', 'Smart availability')}</div>
              <div className="mini-tt" dir="ltr">
                {['09:00', '09:30', '10:00', '10:30', '11:00', '11:30'].map((t, i) => (
                  <div key={t} className={i === 2 ? 'busy' : i === 4 ? 'pref' : ''}>
                    <span>{t}</span>
                    <i>{i === 2 ? 'Google · busy' : i === 4 ? '★ preferred' : 'open'}</i>
                  </div>
                ))}
              </div>
              <p className="muted small">{L('כמה לוחות, חריגות, באפרים, מקסימום ביום ושעות מועדפות.', 'Multiple schedules, overrides, buffers, daily caps, preferred hours.')}</p>
            </article>
          </Reveal>
          <Reveal className="b-wa" delay={80}>
            <article className="b-card">
              <div className="b-label">WhatsApp</div>
              <div className="wa-bubble">
                {L('היי דנה 👋 תזכורת: שיחת היכרות מחר ב-10:20. מגיעה?', 'Hi Dana 👋 reminder: intro call tomorrow 10:20. Still on?')}
                <span className="wa-time">09:41</span>
              </div>
              <div className="wa-actions">
                <span>{L('מגיעה ✓', 'Confirm ✓')}</span>
                <span>{L('שינוי מועד', 'Reschedule')}</span>
                <span>{L('ביטול', 'Cancel')}</span>
              </div>
            </article>
          </Reveal>
          <Reveal className="b-shabbat" delay={120}>
            <article className="b-card center">
              <img className="illus" src="./illustrations/shabbat.webp" alt="" loading="lazy" />
              <h3>{L('שבת שלום. אוטומטית.', 'Shabbat shalom. Automatically.')}</h3>
              <p className="muted small">{L('נחסם מהדלקת נרות ועד הבדלה לפי העיר שלך, כולל חגים ותאריך עברי.', 'Blocked from candle lighting to havdalah by your city, holidays and Hebrew date included.')}</p>
            </article>
          </Reveal>
          <Reveal className="b-month" delay={60}>
            <article className="b-card">
              <div className="b-label">{L('דף ההזמנה', 'Booking page')}</div>
              <div className="mini-month">
                {Array.from({ length: 28 }, (_, i) => (
                  <span key={i} className={i % 7 === 6 ? 'off' : i === 10 ? 'sel' : i % 5 === 0 ? '' : 'on'}>{i + 1}</span>
                ))}
              </div>
              <p className="muted small">{L('חודש, שבוע, אזור זמן אוטומטי, והיומן של המוזמן מעל.', 'Month, week, auto timezone, and the invitee’s own calendar on top.')}</p>
            </article>
          </Reveal>
          <Reveal className="b-ai" delay={100}>
            <article className="b-card ink">
              <div className="b-label">{L('סוכני AI · MCP', 'AI agents · MCP')}</div>
              <Terminal />
              <p className="small" style={{ opacity: 0.75 }}>{L('Claude, ChatGPT ו-Cursor קובעים, מזיזים ומבטלים בשמך.', 'Claude, ChatGPT and Cursor book, move and cancel for you.')}</p>
            </article>
          </Reveal>
          <Reveal className="b-teams" delay={140}>
            <article className="b-card">
              <div className="b-label">{L('צוותים', 'Teams')}</div>
              <div className="rr">
                {['י', 'נ', 'ע', 'ד'].map((x, i) => (
                  <span key={x} className={`rr-dot${i === 1 ? ' on' : ''}`}>{x}</span>
                ))}
              </div>
              <p className="muted small">{L('סבב לפי עדיפות ומשקל, פגישה משותפת, טפסי ניתוב וקישור קבוצתי.', 'Round robin by priority and weight, collective, routing forms and group links.')}</p>
            </article>
          </Reveal>
        </div>
        <Reveal>
          <ul className="feature-chips">
            {[
              L('תזכורות אוטומטיות', 'Automated reminders'),
              L('סקרי מועדים', 'Meeting polls'),
              L('פגישות חוזרות', 'Recurring'),
              L('תשלום ומקדמה', 'Payments & deposits'),
              L('קישורים אישיים', 'Personal links'),
              L('קישור חד פעמי', 'Single use links'),
              L('אישור הגעה', 'Reconfirmation'),
              L('מחוץ למשרד', 'Out of office'),
              L('נסיעות ואזורי זמן', 'Travel timezones'),
              L('הטמעה באתר', 'Website embed'),
              'Webhooks · API',
              L('אימות דו-שלבי', '2FA'),
              L('עובד גם בלי אינטרנט', 'Works offline'),
            ].map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </Reveal>
      </section>

      <section className="container quote-band">
        <Reveal>
          <blockquote>
            <span className="q-mark">״</span>
            {L('הפסקתי לשלוח ״מתי נוח לך?״. שולחת קישור, וזהו.', 'I stopped sending “when works for you?”. I send a link. Done.')}
            <cite>{L('יועצת עסקית, תל אביב', 'Business consultant, Tel Aviv')}</cite>
          </blockquote>
        </Reveal>
      </section>

      <section className="container cta-band">
        <div>
          <h2>{L('הפגישה הבאה שלך מחכה בקישור אחד.', 'Your next meeting is one link away.')}</h2>
          <p className="muted">{L('הדמו רץ בדפדפן, בלי הרשמה. אפשר לחבר Google Calendar אמיתי בהגדרות.', 'The demo runs in your browser, no sign up. Connect a real Google Calendar in settings.')}</p>
        </div>
        <div className="row wrap" style={{ gap: 10 }}>
          <button className="btn btn-lg" onClick={tryDemo}>{L('כניסה לדמו', 'Enter the demo')} <Icon name={arrow} /></button>
          <Link className="btn btn-line btn-lg on-ink" to="/guide">{L('מדריך הקמה', 'Setup guide')}</Link>
        </div>
      </section>

      <footer className="container public-foot land-foot">
        <div className="stack" style={{ ['--gap' as string]: '6px' }}>
          <Logo size={18} mono />
          <span className="tiny muted">{L('לוח זמנים, לא עוד טופס.', 'A timetable, not another form.')}</span>
        </div>
        <nav className="row wrap" style={{ gap: 16 }}>
          <Link className="link small" to="/yonatan">{L('דף לדוגמה', 'Sample page')}</Link>
          <Link className="link small" to="/team/studio">{L('דף צוות', 'Team page')}</Link>
          <Link className="link small" to="/guide">{L('מדריך', 'Guide')}</Link>
          <span className="tiny muted">© {new Date().getFullYear()} Slotwise</span>
        </nav>
      </footer>
    </div>
  )
}
