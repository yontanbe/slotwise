import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '../i18n'
import { isDark, setTheme } from '../lib/theme'
import { Icon, Logo } from './ui'
import { useEffect, useState } from 'react'
import { isEmbedded } from './Booker'

export function Prefs() {
  const { locale, setLocale } = useI18n()
  const [dark, setDark] = useState(isDark())
  return (
    <div className="row" style={{ gap: 6 }}>
      <button className="icon-btn" onClick={() => setLocale(locale === 'he' ? 'en' : 'he')} aria-label="language" title="עברית / English">
        <span style={{ fontSize: 12, fontWeight: 700 }}>{locale === 'he' ? 'EN' : 'עב'}</span>
      </button>
      <button
        className="icon-btn"
        onClick={() => {
          setTheme(dark ? 'light' : 'dark')
          setDark(!dark)
        }}
        aria-label="theme"
      >
        <Icon name={dark ? 'sun' : 'moon'} size={16} />
      </button>
    </div>
  )
}

export default function PublicShell({ children, wide = true }: { children: ReactNode; wide?: boolean }) {
  const { L } = useI18n()
  const embedded = isEmbedded()
  useEffect(() => {
    document.documentElement.classList.toggle('embed', embedded)
  }, [embedded])
  if (embedded) return <main className="container embed-main" style={{ paddingBlock: 12 }}>{children}</main>
  return (
    <div className="public">
      <header className="public-top container">
        <Link to="/" style={{ textDecoration: 'none' }} aria-label="Slotwise">
          <Logo size={18} />
        </Link>
        <Prefs />
      </header>
      <main className={wide ? 'container' : 'container narrow'}>{children}</main>
      <footer className="public-foot container">
        <span className="tiny muted">
          {L('מופעל על ידי', 'Powered by')}{' '}
          <Link to="/" className="link">
            Slotwise
          </Link>
        </span>
      </footer>
    </div>
  )
}

export function NotFound({ text }: { text?: string }) {
  const { L } = useI18n()
  return (
    <PublicShell>
      <div className="empty">
        <div className="illus-frame">
          <img className="illus" src="./illustrations/empty.webp" alt="" style={{ width: 200, height: 200, objectFit: 'cover' }} />
        </div>
        <h2>{L('לא מצאנו את הדף', 'Page not found')}</h2>
        <p className="muted">{text || L('ייתכן שהקישור השתנה או פג תוקפו.', 'The link may have changed or expired.')}</p>
        <Link to="/" className="btn btn-line">
          {L('לדף הבית', 'Home')}
        </Link>
      </div>
    </PublicShell>
  )
}
