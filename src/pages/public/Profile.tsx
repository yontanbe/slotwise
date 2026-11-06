import { Link, Navigate, useParams } from 'react-router-dom'
import PublicShell, { NotFound } from '../../components/PublicShell'
import { Avatar, Icon } from '../../components/ui'
import { useLoad, useStore } from '../../data/StoreProvider'
import { useI18n } from '../../i18n'
import { locationName } from '../../lib/locations'

export default function Profile() {
  const { username = '' } = useParams()
  const store = useStore()
  const { L, dir } = useI18n()
  const { data, loading } = useLoad(() => store.getPublicProfile(username), [username])
  if (loading) return <PublicShell><div className="boot"><span className="boot-dot" /></div></PublicShell>
  if (!data) return <NotFound />
  if (data.redirectedFrom) return <Navigate to={`/${data.user.username}`} replace />
  const { user, eventTypes } = data
  const visible = eventTypes.filter((e) => !e.hidden)
  return (
    <PublicShell>
      <section className="profile-head rise">
        <Avatar name={user.name} src={user.avatarUrl} size={88} />
        <div className="stack" style={{ ['--gap' as string]: '6px' }}>
          <div className="eyebrow ltr">slotwise / {user.username}</div>
          <h1>{user.name}</h1>
          {user.bio && <p className="muted" style={{ maxWidth: 560, fontSize: 17 }}>{user.bio}</p>}
        </div>
      </section>
      <div className="rule-strong" />
      <div className="profile-grid">
        {visible.map((et, i) => (
          <Link key={et.id} to={`/${user.username}/${et.slug}`} className="index-card rise" style={{ ['--tab' as string]: et.color, animationDelay: `${i * 60}ms` }}>
            <div className="row between">
              <span className="eyebrow">{et.durations.join(' / ')} {L('דק׳', 'min')}</span>
              {et.seats ? <span className="chip sage">{L('קבוצתי', 'Group')}</span> : null}
            </div>
            <h3 style={{ marginTop: 10 }}>{et.title}</h3>
            {et.description && <p className="muted small" style={{ marginTop: 6 }}>{et.description}</p>}
            <div className="row between" style={{ marginTop: 18 }}>
              <span className="tiny muted">{et.locations.map((l) => locationName(l.type, L)).join(' · ')}</span>
              <span className="accent"><Icon name={dir === 'rtl' ? 'chevL' : 'chevR'} /></span>
            </div>
          </Link>
        ))}
        {visible.length === 0 && <p className="muted">{L('אין כרגע סוגי פגישות ציבוריים.', 'No public event types yet.')}</p>}
      </div>
    </PublicShell>
  )
}
