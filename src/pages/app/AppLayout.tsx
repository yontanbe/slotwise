import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth, useMe } from '../../auth/AuthProvider'
import { Avatar, Icon, Logo, useCopy } from '../../components/ui'
import { markShared, ProductTour } from '../../components/Onboarding'
import { useLoad, useStore } from '../../data/StoreProvider'
import { useI18n } from '../../i18n'
import { isGoogleConnected } from '../../integrations/google'
import { runSync } from '../../integrations/sync'
import { appUrl } from '../../lib/links'
import { isDark, setTheme } from '../../lib/theme'

export default function AppLayout() {
  const me = useMe()
  const { signOut, mode } = useAuth()
  const store = useStore()
  const { L, locale, setLocale } = useI18n()
  const copy = useCopy()
  const loc = useLocation()
  const [dark, setDark] = useState(isDark())
  const [menu, setMenu] = useState(false)
  const pending = useLoad(async () => (await store.listBookings(me.id)).filter((b) => b.status === 'pending' && b.end > new Date().toISOString()).length, [me.id])

  // keep the host's browser acting as the "worker": notifications, Google events, busy sync
  const meRef = useRef(me)
  meRef.current = me
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const kick = (pullBusy: boolean) => {
      clearTimeout(t)
      t = setTimeout(() => runSync(store, meRef.current, { pullBusy }).catch(() => {}), 400)
    }
    kick(true)
    const unsub = store.subscribe(() => kick(false))
    const iv = setInterval(() => isGoogleConnected() && kick(true), 5 * 60 * 1000)
    return () => {
      unsub()
      clearInterval(iv)
      clearTimeout(t)
    }
  }, [store])

  useEffect(() => {
    setMenu(false)
  }, [loc.pathname])

  const items: [string, string, string, number?][] = [
    ['/app', 'home', L('היום', 'Today')],
    ['/app/bookings', 'calendar', L('פגישות', 'Bookings'), pending.data || undefined],
    ['/app/event-types', 'cards', L('סוגי פגישות', 'Event types')],
    ['/app/availability', 'clock', L('זמינות', 'Availability')],
    ['/app/workflows', 'refresh', L('תהליכים', 'Workflows')],
    ['/app/routing', 'arrow', L('טפסי ניתוב', 'Routing')],
    ['/app/teams', 'users', L('צוותים', 'Teams')],
    ['/app/polls', 'poll', L('סקרים', 'Polls')],
    ['/app/contacts', 'inbox', L('אנשי קשר', 'Contacts')],
    ['/app/insights', 'chart', L('נתונים', 'Insights')],
    ['/app/integrations', 'plug', L('חיבורים', 'Integrations')],
    ['/app/developers', 'link', L('מפתחים', 'Developers')],
    ['/app/settings', 'gear', L('הגדרות', 'Settings')],
  ]

  return (
    <div className="shell">
      <aside className={`rail${menu ? ' open' : ''}`}>
        <div className="rail-top">
          <NavLink to="/app" className="rail-logo" aria-label="Slotwise">
            <Logo size={19} />
          </NavLink>
          <button className="icon-btn rail-close" onClick={() => setMenu(false)} aria-label="close">
            <Icon name="x" />
          </button>
        </div>
        <nav className="rail-nav">
          {items.map(([to, ic, label, badge]) => (
            <NavLink key={to} to={to} end={to === '/app'} className="rail-link" data-tour={to}>
              <Icon name={ic} size={19} />
              <span>{label}</span>
              {badge ? <span className="rail-badge">{badge}</span> : null}
            </NavLink>
          ))}
        </nav>
        <div className="rail-bottom">
          <button className="rail-link" data-tour="share" onClick={() => { copy(appUrl(`/${me.username}`)); markShared(me.id) }}>
            <Icon name="link" size={19} />
            <span className="ltr" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>/{me.username}</span>
          </button>
          <div className="row" style={{ gap: 6, padding: '6px 10px' }}>
            <button className="rail-mini" onClick={() => setLocale(locale === 'he' ? 'en' : 'he')} aria-label="language">
              {locale === 'he' ? 'EN' : 'עב'}
            </button>
            <button className="rail-mini" onClick={() => { setTheme(dark ? 'light' : 'dark'); setDark(!dark) }} aria-label="theme">
              <Icon name={dark ? 'sun' : 'moon'} size={15} />
            </button>
            <button className="rail-mini" onClick={signOut} aria-label={L('יציאה', 'Sign out')} title={L('יציאה', 'Sign out')}>
              <Icon name="logout" size={15} />
            </button>
          </div>
          <div className="rail-me">
            <Avatar name={me.name} src={me.avatarUrl} size={34} />
            <div style={{ minWidth: 0 }}>
              <div className="rail-name">{me.name}</div>
              <div className="rail-mode">{mode === 'demo' ? L('מצב דמו', 'Demo mode') : 'Supabase'}</div>
            </div>
          </div>
        </div>
      </aside>
      {menu && <div className="rail-scrim" onClick={() => setMenu(false)} />}
      {!/[?&]notour=1/.test(window.location.hash) && <ProductTour />}
      <div className="main">
        <div className="mobile-bar">
          <button className="icon-btn" onClick={() => setMenu(true)} aria-label="menu">
            <span style={{ fontSize: 18, lineHeight: 1 }}>≡</span>
          </button>
          <Logo size={17} />
          <Avatar name={me.name} src={me.avatarUrl} size={30} />
        </div>
        <div className="main-inner">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
