import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { Prefs } from '../components/PublicShell'
import { Icon, Logo } from '../components/ui'
import { useI18n } from '../i18n'

export default function Landing() {
  const { L, dir } = useI18n()
  const auth = useAuth()
  const nav = useNavigate()
  const arrow = dir === 'rtl' ? 'chevL' : 'chevR'

  const tryDemo = async () => {
    if (auth.mode === 'demo') {
      await auth.enterDemo()
      nav('/app')
    } else nav('/login')
  }

  const rows: [string, string, string, string][] = [
    ['01', L('הזמינות שלך, בכללים שלך', 'Your availability, your rules'), L('כמה לוחות זמנים, חריגות לפי תאריך, באפרים, הגבלות יומיות ושעות מועדפות.', 'Multiple schedules, date overrides, buffers, daily caps and preferred hours.'), 'clock'],
    ['02', L('Google Calendar ו-Meet מובנים', 'Google Calendar and Meet built in'), L('בודקים התנגשויות בכל היומנים, יוצרים אירוע עם קישור Meet ושולחים מה-Gmail שלך.', 'Checks every calendar for conflicts, creates the event with a Meet link and sends from your Gmail.'), 'calendar'],
    ['03', L('שבת וחגים חוסמים את עצמם', 'Shabbat and holidays block themselves'), L('מהדלקת נרות ועד הבדלה לפי העיר שלך, כולל תאריך עברי בדף ההזמנה.', 'From candle lighting to havdalah by your city, with the Hebrew date on the booking page.'), 'star'],
    ['04', L('WhatsApp כערוץ ראשי', 'WhatsApp as a first class channel'), L('אישורים ותזכורות בלחיצה, ובהמשך קביעה מלאה בתוך הצ׳אט.', 'One tap confirmations and reminders, with full in-chat booking next.'), 'whatsapp'],
    ['05', L('סקרי מועדים וקישורים חד פעמיים', 'Polls and single use links'), L('מציעים כמה מועדים, כולם מצביעים בלי להירשם, ואתם בוחרים.', 'Offer a few times, everyone votes without signing up, you pick.'), 'poll'],
  ]

  return (
    <div className="landing">
      <header className="public-top container">
        <Logo size={20} />
        <nav className="row" style={{ gap: 8 }}>
          <Link className="btn btn-ghost btn-sm" to="/yonatan">
            {L('דף לדוגמה', 'Sample page')}
          </Link>
          {auth.status === 'in' ? (
            <Link className="btn btn-sm" to="/app">
              {L('לדשבורד', 'Dashboard')}
            </Link>
          ) : (
            <Link className="btn btn-line btn-sm" to="/login">
              {L('כניסה', 'Log in')}
            </Link>
          )}
          <Prefs />
        </nav>
      </header>

      <section className="hero container">
        <div className="hero-copy rise">
          <div className="eyebrow">{L('קביעת פגישות · עברית ואנגלית', 'Scheduling · Hebrew and English')}</div>
          <h1 className="hero-title">
            {L('קישור אחד.', 'One link.')}
            <br />
            <span className="hero-strike">{L('בלי הלוך ושוב.', 'No back and forth.')}</span>
          </h1>
          <p className="hero-sub">
            {L(
              'Slotwise מראה למוזמנים רק את הזמנים שבאמת פנויים אצלך, קובע את הפגישה ביומן, מוסיף קישור Meet ושולח אישור. את השאר אתם עושים בפגישה עצמה.',
              'Slotwise shows invitees only the times you are truly free, puts the meeting on your calendar, adds a Meet link and sends the confirmation. You just show up.',
            )}
          </p>
          <div className="row wrap" style={{ gap: 10 }}>
            <button className="btn btn-accent btn-lg" onClick={tryDemo}>
              {L('נסו את הדמו', 'Try the demo')} <Icon name={arrow} />
            </button>
            <Link className="btn btn-line btn-lg" to="/yonatan/intro">
              {L('איך זה נראה למוזמן', 'See the invitee view')}
            </Link>
          </div>
        </div>
        <div className="hero-art">
          <img className="illus" src="./illustrations/hero.webp" alt="" />
          <div className="hero-ticket sheet" aria-hidden>
            <div className="eyebrow">{L('יום שלישי, 10 בנובמבר', 'Tuesday, Nov 10')}</div>
            {['09:30', '10:00', '11:30'].map((t, i) => (
              <div key={t} className={`ticket${i === 1 ? ' preferred' : ''}`} aria-pressed={i === 1} style={{ cursor: 'default' }}>
                <span className="ltr">{t}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="container features">
        <div className="features-head">
          <h2>{L('לוח זמנים, לא עוד טופס.', 'A timetable, not another form.')}</h2>
          <p className="muted">{L('כל מה שצריך כדי שאנשים יקבעו איתך בשניות, ושאתם תשמרו על הזמן שלכם.', 'Everything people need to book you in seconds, and everything you need to protect your time.')}</p>
        </div>
        <div className="timetable">
          {rows.map(([n, t, d, ic]) => (
            <div key={n} className="tt-row feature-row">
              <div className="tt-time">
                <b>{n}</b>
              </div>
              <div>
                <h3 style={{ fontSize: 24 }}>{t}</h3>
                <p className="muted" style={{ marginTop: 4 }}>{d}</p>
              </div>
              <span className="feature-icon">
                <Icon name={ic} size={22} />
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="container cta-band">
        <div>
          <h2>{L('מוכנים לקבוע פגישה ראשונה?', 'Ready for your first booking?')}</h2>
          <p className="muted">{L('הדמו רץ כולו בדפדפן. אפשר לחבר Google Calendar אמיתי מתוך ההגדרות.', 'The demo runs fully in your browser. Connect a real Google Calendar from settings.')}</p>
        </div>
        <button className="btn btn-lg" onClick={tryDemo}>
          {L('כניסה לדמו', 'Enter the demo')} <Icon name={arrow} />
        </button>
      </section>

      <footer className="container public-foot">
        <Logo size={16} mono />
        <span className="tiny muted">© {new Date().getFullYear()} Slotwise</span>
      </footer>
    </div>
  )
}
