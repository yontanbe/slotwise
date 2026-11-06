import { Navigate, useParams } from 'react-router-dom'
import Booker from '../../components/Booker'
import PublicShell, { NotFound } from '../../components/PublicShell'
import { useLoad, useStore } from '../../data/StoreProvider'

export default function BookingPage() {
  const { username = '', slug = '' } = useParams()
  const store = useStore()
  const { data, loading } = useLoad(() => store.getPublicProfile(username), [username])
  if (loading) return <PublicShell><div className="boot"><span className="boot-dot" /></div></PublicShell>
  if (!data) return <NotFound />
  if (data.redirectedFrom) return <Navigate to={`/${data.user.username}/${slug}${window.location.hash.includes('?') ? '?' + window.location.hash.split('?')[1] : ''}`} replace />
  const et = data.eventTypes.find((e) => e.slug === slug)
  if (!et) return <NotFound />
  return (
    <PublicShell>
      <Booker profile={data} eventType={et} />
    </PublicShell>
  )
}
