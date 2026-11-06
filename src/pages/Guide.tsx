import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Prefs } from '../components/PublicShell'
import { Icon, Logo, useCopy } from '../components/ui'
import { useI18n } from '../i18n'

interface Section {
  id: string
  title: string
  img?: string
  body: React.ReactNode
}

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="guide-steps">
      {items.map((x, i) => (
        <li key={i}>
          <span className="mono">{String(i + 1).padStart(2, '0')}</span>
          <div>{x}</div>
        </li>
      ))}
    </ol>
  )
}

export default function Guide() {
  const { L } = useI18n()
  const copy = useCopy()
  const origin = window.location.origin
  const [active, setActive] = useState('start')

  const sections: Section[] = [
    {
      id: 'start',
      title: L('מתחילים בחמש דקות', 'Start in five minutes'),
      img: 'journey',
      body: (
        <Steps
          items={[
            <>{L('נכנסים ב', 'Sign in at ')}<Link className="link" to="/login">{L('דף הכניסה', 'the login page')}</Link>{L('. במצב דמו אפשר להיכנס בלחיצה, או עם Google אם הוגדר.', '. In demo mode one click is enough, or Google when configured.')}</>,
            L('באשף הפתיחה: שם, קישור אישי, אזור זמן, ושבת וחגים לפי העיר.', 'In the setup wizard: name, personal link, timezone, Shabbat and holidays by city.'),
            L('בזמינות: מסמנים שעות עבודה. חופש או שעות מיוחדות מוסיפים בלוח החודשי.', 'In Availability: mark working hours. Days off or special hours go on the month calendar.'),
            L('בסוגי פגישות: עורכים את השם, המשך והמיקום (Meet, טלפון, WhatsApp, פרונטלי).', 'In Event types: edit the name, duration and location (Meet, phone, WhatsApp, in person).'),
            L('מעתיקים את הקישור ושולחים. זהו, מעכשיו אנשים קובעים לבד.', 'Copy your link and send it. From now on people book themselves.'),
          ]}
        />
      ),
    },
    {
      id: 'google',
      title: L('חיבור Google Calendar, Meet ו-Gmail', 'Connect Google Calendar, Meet and Gmail'),
      img: 'onboarding',
      body: (
        <>
          <p>{L('כל משתמש מחבר את היומן שלו. החיבור קורה ישירות מהדפדפן מול Google, האסימון נשמר רק בלשונית ופג אחרי שעה.', 'Each user connects their own calendar. It happens directly between the browser and Google; the token lives in the tab only and expires after an hour.')}</p>
          <h4>{L('פעם אחת, למי שמקים את האתר', 'Once, by whoever runs the site')}</h4>
          <Steps
            items={[
              <>{L('ב-', 'In ')}<a className="link" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">Google Cloud Console</a>{L(' יוצרים פרויקט ומפעילים Calendar API ו-Gmail API.', ' create a project and enable Calendar API and Gmail API.')}</>,
              L('OAuth consent screen: סוג External, מוסיפים את הסקופים calendar.events, calendar.readonly, gmail.send. בזמן בדיקות מוסיפים משתמשי בדיקה.', 'OAuth consent screen: External, add scopes calendar.events, calendar.readonly, gmail.send. While testing, add test users.'),
              <>
                {L('Credentials: יוצרים OAuth Client ID מסוג Web application, ומוסיפים ל-Authorized JavaScript origins את:', 'Credentials: create an OAuth Client ID (Web application) and add to Authorized JavaScript origins:')}
                <div className="row" style={{ gap: 6, marginTop: 8 }}>
                  <code className="code-inline">{origin}</code>
                  <button className="icon-btn" onClick={() => copy(origin)} aria-label="copy"><Icon name="copy" size={14} /></button>
                </div>
              </>,
              L('מגדירים את ה-Client ID כמשתנה VITE_GOOGLE_CLIENT_ID בבנייה (Cloudflare או GitHub), או מדביקים אותו בחיבורים בתוך האפליקציה.', 'Set the Client ID as VITE_GOOGLE_CLIENT_ID at build time (Cloudflare or GitHub), or paste it under Integrations inside the app.'),
              L('כדי שכל אחד יוכל להתחבר (לא רק משתמשי בדיקה) צריך לפרסם את המסך ולעבור אימות של Google לסקופים הרגישים.', 'For anyone to connect (not only test users) publish the consent screen and pass Google verification for the sensitive scopes.'),
            ]}
          />
          <h4>{L('כל משתמש', 'Every user')}</h4>
          <Steps
            items={[
              L('לוחצים "המשך עם Google" בדף הכניסה, או "חיבור Google" בחיבורים.', 'Click "Continue with Google" on the login page, or "Connect Google" under Integrations.'),
              L('בוחרים אילו יומנים נבדקים להתנגשויות ולאיזה יומן נכנסות פגישות חדשות.', 'Pick which calendars are checked for conflicts and where new meetings go.'),
              L('בתצוגת השבוע בפגישות רואים גם את האירועים מהיומן שלכם.', 'The week view under Bookings also shows your own calendar events.'),
            ]}
          />
        </>
      ),
    },
    {
      id: 'share',
      title: L('לשתף ולקבל פגישות', 'Share and get booked'),
      img: 'confirmed',
      body: (
        <ul className="guide-list">
          <li><b>{L('קישור אישי', 'Your link')}</b> · {L('דף עם כל סוגי הפגישות שלכם.', 'A page with all your event types.')}</li>
          <li><b>{L('קישור לאדם מסוים', 'Personal link')}</b> · {L('עם ברכה ושם ממולא, למשל ', 'with a greeting and prefilled name, e.g. ')}<code className="code-inline">/yonatan/dana</code></li>
          <li><b>{L('קישור חד פעמי', 'Single use link')}</b> · {L('לפגישה אחת בלבד.', 'for one booking only.')}</li>
          <li><b>{L('סקר מועדים', 'Meeting poll')}</b> · {L('כמה אנשים מצביעים, אתם קובעים.', 'several people vote, you book.')}</li>
          <li><b>{L('הטמעה באתר', 'Embed')}</b> · {L('בדף מפתחים: בתוך הדף, חלון קופץ או כפתור צף.', 'under Developers: inline, popup or floating button.')}</li>
          <li><b>{L('צוות', 'Team')}</b> · {L('סבב בין אנשי הצוות, או פגישה שכולם בה.', 'round robin across the team, or a meeting with everyone.')}</li>
        </ul>
      ),
    },
    {
      id: 'automate',
      title: L('תזכורות ו-WhatsApp', 'Reminders and WhatsApp'),
      img: 'messaging',
      body: (
        <>
          <p>{L('בתהליכים בוחרים תבנית, למשל תזכורת 24 שעות ב-WhatsApp. בלי שרת, ההודעות מחכות בדשבורד לשליחה בלחיצה; עם Supabase ו-WhatsApp Cloud API הן יוצאות לבד, כולל כפתורי אישור, ביטול ושינוי.', 'Under Workflows pick a template, e.g. a 24h WhatsApp reminder. Without a server messages wait in the dashboard for a one tap send; with Supabase and the WhatsApp Cloud API they go out on their own, with confirm, cancel and reschedule buttons.')}</p>
        </>
      ),
    },
    {
      id: 'ai',
      title: L('סוכני AI (MCP)', 'AI agents (MCP)'),
      img: 'agent',
      body: (
        <p>{L('בדף מפתחים יוצרים מפתח API ומחברים את כתובת שרת ה-MCP ל-Claude, ChatGPT או Cursor. הסוכן יכול לבדוק זמינות, לקבוע, להזיז ולבטל. דורש Supabase.', 'Under Developers create an API key and connect the MCP server URL to Claude, ChatGPT or Cursor. The agent can check availability, book, move and cancel. Requires Supabase.')}</p>
      ),
    },
    {
      id: 'live',
      title: L('לעלות לאוויר', 'Going live'),
      img: 'hero',
      body: (
        <>
          <table className="data guide-table">
            <thead>
              <tr>
                <th />
                <th>{L('מצב דמו', 'Demo mode')}</th>
                <th>{L('עם Supabase', 'With Supabase')}</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>{L('איפה הנתונים', 'Where data lives')}</td><td>{L('בדפדפן של כל משתמש', 'In each user’s browser')}</td><td>{L('בענן, מכל מכשיר', 'In the cloud, any device')}</td></tr>
              <tr><td>{L('משתמשים', 'Users')}</td><td>{L('חשבון מקומי לכל דפדפן', 'A local account per browser')}</td><td>{L('הרשמה אמיתית, Google, Microsoft, 2FA', 'Real sign up, Google, Microsoft, 2FA')}</td></tr>
              <tr><td>{L('הזמנות מאנשים אחרים', 'Bookings from others')}</td><td>{L('רק באותו דפדפן', 'Same browser only')}</td><td>{L('מכל מקום', 'From anywhere')}</td></tr>
              <tr><td>{L('תזכורות אוטומטיות', 'Automatic reminders')}</td><td>{L('כשהדשבורד פתוח', 'While the dashboard is open')}</td><td>{L('תמיד, מהשרת', 'Always, from the server')}</td></tr>
              <tr><td>{L('עלות', 'Cost')}</td><td>{L('חינם', 'Free')}</td><td>{L('חינם בשכבה החינמית', 'Free tier')}</td></tr>
            </tbody>
          </table>
          <Steps
            items={[
              L('אחסון: Cloudflare Pages בחינם. מחברים את הריפו בלוח הבקרה של Cloudflare (Build: npm run build, Output: dist) או משתמשים ב-GitHub Action המצורף.', 'Hosting: Cloudflare Pages for free. Connect the repo in the Cloudflare dashboard (Build: npm run build, Output: dist) or use the included GitHub Action.'),
              L('שרת: פרויקט Supabase חדש, מריצים את scripts/setup-supabase.sh, ומגדירים VITE_SUPABASE_URL ו-VITE_SUPABASE_ANON_KEY.', 'Backend: a new Supabase project, run scripts/setup-supabase.sh, set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'),
              L('דומיין משלכם: מוסיפים ב-Cloudflare ומעדכנים את ה-origins ב-Google.', 'Custom domain: add it in Cloudflare and update the origins in Google.'),
            ]}
          />
          <p className="small muted">{L('הפרטים המלאים בקובץ docs/DEPLOY.md בריפו.', 'Full details in docs/DEPLOY.md in the repo.')}</p>
        </>
      ),
    },
  ]

  useEffect(() => {
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setActive(e.target.id)), { rootMargin: '-40% 0px -55% 0px' })
    sections.forEach((s) => {
      const el = document.getElementById(s.id)
      if (el) io.observe(el)
    })
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="guide">
      <header className="public-top container land-top">
        <Link to="/" style={{ textDecoration: 'none', color: 'inherit' }}><Logo size={18} /></Link>
        <div className="row" style={{ gap: 8 }}>
          <Link className="btn btn-sm" to="/login">{L('כניסה', 'Log in')}</Link>
          <Prefs />
        </div>
      </header>
      <div className="container guide-head">
        <div className="eyebrow">{L('מדריך', 'Guide')}</div>
        <h1>{L('איך מקימים את Slotwise.', 'How to set up Slotwise.')}</h1>
        <p className="muted" style={{ fontSize: 18, maxWidth: 640 }}>{L('מההגדרה הראשונה ועד דומיין משלכם, עם Google, WhatsApp וסוכני AI.', 'From first setup to your own domain, with Google, WhatsApp and AI agents.')}</p>
      </div>
      <div className="container guide-grid">
        <nav className="guide-toc" aria-label={L('תוכן', 'Contents')}>
          {sections.map((s, i) => (
            <a key={s.id} href={`#${s.id}`} aria-current={active === s.id} onClick={(e) => { e.preventDefault(); document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth' }) }}>
              <span className="mono">{String(i + 1).padStart(2, '0')}</span> {s.title}
            </a>
          ))}
        </nav>
        <main className="stack" style={{ ['--gap' as string]: '56px' }}>
          {sections.map((s, i) => (
            <section key={s.id} id={s.id} className="guide-sec">
              <div className="guide-sec-head">
                <span className="how-n">{String(i + 1).padStart(2, '0')}</span>
                <h2>{s.title}</h2>
                {s.img && (
                  <div className="illus-frame guide-illus"><img className="illus" src={`./illustrations/${s.img}.webp`} alt="" loading="lazy" /></div>
                )}
              </div>
              <div className="guide-body">{s.body}</div>
            </section>
          ))}
          <div className="cta-band">
            <h2>{L('מוכנים?', 'Ready?')}</h2>
            <Link className="btn btn-lg" to="/login">{L('מתחילים', 'Get started')}</Link>
          </div>
        </main>
      </div>
    </div>
  )
}
