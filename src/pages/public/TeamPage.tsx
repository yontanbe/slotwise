import { Link, useParams } from 'react-router-dom'
import Booker from '../../components/Booker'
import PublicShell, { NotFound } from '../../components/PublicShell'
import { Avatar, Icon } from '../../components/ui'
import { useLoad, useStore } from '../../data/StoreProvider'
import { useI18n } from '../../i18n'
import { locationName } from '../../lib/locations'

export function TeamProfile() {
  const { slug = '' } = useParams()
  const store = useStore()
  const { L, dir } = useI18n()
  const { data, loading } = useLoad(() => store.getTeam(slug), [slug])
  if (loading) return <PublicShell><div className="boot"><span className="boot-dot" /></div></PublicShell>
  if (!data) return <NotFound />
  return (
    <PublicShell>
      <section className="team-head rise">
        <div className="avatar-stack">
          {data.members.map((m) => (
            <Avatar key={m.user.id} name={m.user.name} src={m.user.avatarUrl} size={64} />
          ))}
        </div>
        <div>
          <div className="eyebrow ltr">slotwise / team / {data.team.slug}</div>
          <h1>{data.team.name}</h1>
          {data.team.bio && <p className="muted">{data.team.bio}</p>}
        </div>
      </section>
      <div className="rule-strong" />
      <div className="profile-grid">
        {data.eventTypes.filter((e) => !e.hidden).map((et) => (
          <Link key={et.id} to={`/team/${data.team.slug}/${et.slug}`} className="index-card" style={{ ['--tab' as string]: et.color, color: 'inherit' }}>
            <div className="row between">
              <span className="eyebrow">{et.durations.join(' / ')} {L('דק׳', 'min')}</span>
              <span className="chip">{et.schedulingType === 'collective' ? L('כולם יחד', 'Collective') : L('סבב', 'Round robin')}</span>
            </div>
            <h3 style={{ marginTop: 10 }}>{et.title}</h3>
            {et.description && <p className="muted small" style={{ marginTop: 6 }}>{et.description}</p>}
            <div className="row between" style={{ marginTop: 18 }}>
              <span className="tiny muted">{et.locations.map((l) => locationName(l.type, L)).join(' · ')}</span>
              <span className="accent"><Icon name={dir === 'rtl' ? 'chevL' : 'chevR'} /></span>
            </div>
          </Link>
        ))}
      </div>
    </PublicShell>
  )
}

export function TeamBooking() {
  const { slug = '', et: etSlug = '' } = useParams()
  const store = useStore()
  const { data, loading } = useLoad(() => store.getTeam(slug), [slug])
  if (loading) return <PublicShell><div className="boot"><span className="boot-dot" /></div></PublicShell>
  if (!data) return <NotFound />
  const et = data.eventTypes.find((e) => e.slug === etSlug)
  if (!et) return <NotFound />
  const hostIds = new Set((et.hosts || []).map((h) => h.userId))
  const members = data.members.filter((m) => hostIds.has(m.user.id))
  const owner = data.members.find((m) => m.user.id === et.ownerId)
  if (!owner || !members.length) return <NotFound />
  return (
    <PublicShell>
      <Booker profile={owner} eventType={et} team={{ mode: et.schedulingType === 'collective' ? 'collective' : 'round_robin', members }} />
    </PublicShell>
  )
}
