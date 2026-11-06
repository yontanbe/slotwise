import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { Prefs } from '../components/PublicShell'
import { Field, Icon, Logo, Modal, useToast } from '../components/ui'
import { useI18n } from '../i18n'
import { getConfig, setConfig } from '../lib/config'

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}
function MsMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 22 22" aria-hidden>
      <path fill="#F25022" d="M0 0h10v10H0z" />
      <path fill="#7FBA00" d="M12 0h10v10H12z" />
      <path fill="#00A4EF" d="M0 12h10v10H0z" />
      <path fill="#FFB900" d="M12 12h10v10H12z" />
    </svg>
  )
}

export default function Login() {
  const auth = useAuth()
  const nav = useNavigate()
  const toast = useToast()
  const [params] = useSearchParams()
  const { L } = useI18n()
  const [tab, setTab] = useState<'login' | 'signup'>('login')
  const [method, setMethod] = useState<'magic' | 'password'>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [cfgOpen, setCfgOpen] = useState(false)
  const [code, setCode] = useState('')
  const next = params.get('next') || '/app'

  useEffect(() => {
    if (auth.status === 'in') nav(next, { replace: true })
  }, [auth.status, nav, next])

  const [notice, setNotice] = useState<string | null>(null)
  const run = async (fn: () => Promise<string | null>, magic = false) => {
    setBusy(true)
    const err = await fn()
    setBusy(false)
    if (err === 'google_not_configured') setNotice(L('כניסה עם Google תעבוד ברגע שיוגדר Google Client ID לאתר. בינתיים אפשר להיכנס עם מייל או לדמו.', 'Google sign in works once a Google Client ID is set for this site. Meanwhile use email or the demo.'))
    else if (err === 'microsoft_needs_backend') setNotice(L('כניסה עם Microsoft דורשת חיבור Supabase.', 'Microsoft sign in needs the Supabase backend.'))
    else if (err === 'popup_closed' || err === 'popup_failed_to_open') toast(L('חלון ההתחברות נסגר', 'The sign in window was closed'), true)
    else if (err) toast(err, true)
    else if (magic && auth.mode === 'supabase') setSent(true)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast(L('כתובת מייל לא תקינה', 'Invalid email'), true)
    if (method === 'magic') return run(() => auth.signInWithMagicLink(email), true)
    if (auth.mode === 'supabase' && password.length < 8) return toast(L('סיסמה של 8 תווים לפחות', 'Password must be 8+ characters'), true)
    return run(() => (tab === 'signup' ? auth.signUp(email, password, name) : auth.signInWithPassword(email, password)), tab === 'signup')
  }

  return (
    <div className="login">
      <aside className="login-art">
        <Link to="/" style={{ textDecoration: 'none', color: 'inherit' }}>
          <Logo size={20} />
        </Link>
        <img className="illus" src="./illustrations/login.webp" alt="" />
        <blockquote className="display">
          {L('״הזמן הוא המשאב היחיד שאי אפשר לקנות עוד ממנו.״', '“Time is the one resource you cannot buy more of.”')}
        </blockquote>
      </aside>

      <main className="login-main">
        <div className="row between" style={{ marginBottom: 32 }}>
          <span className="login-logo-sm"><Logo size={18} /></span>
          <Prefs />
        </div>
        <div className="login-box rise">
          <div className="eyebrow">{tab === 'login' ? L('ברוכים השבים', 'Welcome back') : L('חשבון חדש', 'New account')}</div>
          <h1 style={{ fontSize: 40 }}>{tab === 'login' ? L('כניסה ל-Slotwise', 'Log in to Slotwise') : L('מתחילים בדקה', 'Start in a minute')}</h1>

          {auth.mode === 'demo' && (
            <div className="demo-pass">
              <div>
                <b>{L('מצב דמו', 'Demo mode')}</b>
                <p className="small muted">{L('ההתחברות פתוחה. כל מייל וסיסמה יעבדו, או כנסו ישר לחשבון לדוגמה.', 'Login is open. Any email and password work, or jump into the sample account.')}</p>
              </div>
              <button className="btn btn-accent" onClick={async () => { await auth.enterDemo(); nav(next) }}>
                {L('כניסה מהירה', 'Quick enter')} <Icon name="arrow" />
              </button>
            </div>
          )}

          {auth.status === 'mfa' ? (
            <form
              className="stack"
              style={{ ['--gap' as string]: '12px' }}
              onSubmit={async (e) => {
                e.preventDefault()
                const err = await auth.verifyMfa(code.trim())
                if (err) toast(err, true)
              }}
            >
              <Field label={L('קוד מאפליקציית האימות', 'Code from your authenticator app')}>
                <input className="input ltr mono" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              </Field>
              <button className="btn btn-lg btn-block" disabled={code.length !== 6}>{L('אימות', 'Verify')}</button>
              <button type="button" className="link small" onClick={auth.signOut}>{L('יציאה', 'Sign out')}</button>
            </form>
          ) : sent ? (
            <div className="notice accent">
              <Icon name="mail" />
              <div>{L(`שלחנו קישור כניסה ל-${email}. אפשר לסגור את הלשונית.`, `We sent a sign in link to ${email}. You can close this tab.`)}</div>
            </div>
          ) : (
            <>
              <div className="stack" style={{ ['--gap' as string]: '10px' }}>
                <button className="btn btn-line btn-lg btn-block" disabled={busy} onClick={() => run(() => auth.signInWithOAuth('google'))}>
                  <GoogleMark /> {L('המשך עם Google', 'Continue with Google')}
                </button>
                <button className="btn btn-line btn-lg btn-block" disabled={busy} onClick={() => run(() => auth.signInWithOAuth('azure'))}>
                  <MsMark /> {L('המשך עם Microsoft', 'Continue with Microsoft')}
                </button>
              </div>
              {notice && (
                <div className="notice small">
                  <Icon name="plug" />
                  <div>
                    {notice} <Link className="link" to="/guide">{L('איך מגדירים', 'How to set it up')}</Link>
                  </div>
                </div>
              )}
              <div className="or"><span>{L('או עם מייל', 'or with email')}</span></div>
              <form className="stack" onSubmit={submit} style={{ ['--gap' as string]: '14px' }}>
                <div className="seg" style={{ alignSelf: 'flex-start' }}>
                  <button type="button" aria-pressed={method === 'password'} onClick={() => setMethod('password')}>{L('סיסמה', 'Password')}</button>
                  <button type="button" aria-pressed={method === 'magic'} onClick={() => setMethod('magic')}>{L('קישור קסם', 'Magic link')}</button>
                </div>
                {tab === 'signup' && method === 'password' && (
                  <Field label={L('שם מלא', 'Full name')}>
                    <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
                  </Field>
                )}
                <Field label={L('מייל', 'Email')}>
                  <input className="input ltr" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
                </Field>
                {method === 'password' && (
                  <Field label={L('סיסמה', 'Password')} hint={tab === 'signup' ? L('8 תווים לפחות', 'At least 8 characters') : undefined}>
                    <input className="input ltr" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={tab === 'signup' ? 'new-password' : 'current-password'} />
                  </Field>
                )}
                <button className="btn btn-lg btn-block" disabled={busy}>
                  {method === 'magic' ? L('שליחת קישור', 'Send link') : tab === 'login' ? L('כניסה', 'Log in') : L('יצירת חשבון', 'Create account')}
                </button>
              </form>
              <p className="small" style={{ textAlign: 'center' }}>
                {tab === 'login' ? L('אין לך חשבון? ', 'No account? ') : L('כבר יש חשבון? ', 'Have an account? ')}
                <button className="link" onClick={() => setTab(tab === 'login' ? 'signup' : 'login')}>
                  {tab === 'login' ? L('הרשמה', 'Sign up') : L('כניסה', 'Log in')}
                </button>
              </p>
            </>
          )}
          <div className="login-foot tiny muted">
            <span>{auth.mode === 'demo' ? L('הנתונים נשמרים בדפדפן הזה בלבד.', 'Data is stored in this browser only.') : L('מחובר ל-Supabase', 'Connected to Supabase')}</span>
            <button className="link tiny" onClick={() => setCfgOpen(true)}>{L('חיבור שרת', 'Backend')}</button>
          </div>
        </div>
      </main>
      <BackendModal open={cfgOpen} onClose={() => setCfgOpen(false)} />
    </div>
  )
}

export function BackendModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { L } = useI18n()
  const c = getConfig()
  const [url, setUrl] = useState(c.supabaseUrl)
  const [key, setKey] = useState(c.supabaseAnonKey)
  return (
    <Modal open={open} onClose={onClose}>
      <div className="stack" style={{ ['--gap' as string]: '14px' }}>
        <h3>{L('חיבור ל-Supabase', 'Connect Supabase')}</h3>
        <p className="small muted">
          {L('הריצו את supabase/schema.sql בפרויקט חדש והדביקו כאן את ה-URL וה-anon key. ההגדרה נשמרת בדפדפן הזה. כדי לחזור לדמו מחקו את השדות.', 'Run supabase/schema.sql in a new project and paste the URL and anon key. Saved in this browser. Clear both fields to go back to demo.')}
        </p>
        <Field label={L('כתובת הפרויקט (Project URL)', 'Project URL')}>
          <input className="input ltr" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxx.supabase.co" />
        </Field>
        <Field label={L('מפתח ציבורי (anon key)', 'anon public key')}>
          <input className="input ltr" value={key} onChange={(e) => setKey(e.target.value)} />
        </Field>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={() => { setConfig({ supabaseUrl: url.trim(), supabaseAnonKey: key.trim() }); window.location.reload() }}>
            {L('שמירה וטעינה מחדש', 'Save and reload')}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>{L('ביטול', 'Cancel')}</button>
        </div>
      </div>
    </Modal>
  )
}
