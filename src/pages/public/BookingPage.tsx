import { Navigate, useParams } from 'react-router-dom'
import Booker from '../../components/Booker'
import PublicShell, { NotFound } from '../../components/PublicShell'
import type { PublicProfile } from '../../data/store'
import { useLoad, useStore } from '../../data/StoreProvider'

/**
 * /:username/:slug
 *  - an event type of the user, or
 *  - a personalized link (/yonatan/dana), or
 *  - a dynamic group link (/alice+bob/30min): collective availability of everyone listed,
 *    using the event type of the first user.
 */
export default function BookingPage() {
  const { username = '', slug = '' } = useParams()
  const store = useStore()
  const names = username.split('+').map((x) => x.trim()).filter(Boolean).slice(0, 5)
  const { data, loading } = useLoad(async () => {
    const profiles = (await Promise.all(names.map((n) => store.getPublicProfile(n)))).filter((p): p is PublicProfile => !!p)
    if (profiles.length !== names.length || !profiles.length) return null
    const main = profiles[0]
    const et = main.eventTypes.find((e) => e.slug === slug)
    const personal = !et && names.length === 1 ? await store.getPersonalLink(names[0], slug) : null
    return { profiles, main, et, personal }
  }, [username, slug])
  if (loading) return <PublicShell><div className="boot"><span className="boot-dot" /></div></PublicShell>
  if (!data) return <NotFound />
  if (data.main.redirectedFrom && names.length === 1)
    return <Navigate to={`/${data.main.user.username}/${slug}${window.location.hash.includes('?') ? '?' + window.location.hash.split('?')[1] : ''}`} replace />
  const et = data.et ?? (data.personal ? data.main.eventTypes.find((e) => e.id === data.personal!.eventTypeId) : undefined)
  if (!et) return <NotFound />
  return (
    <PublicShell>
      <Booker
        profile={data.main}
        eventType={et}
        personal={data.personal ?? undefined}
        team={data.profiles.length > 1 ? { mode: 'collective', members: data.profiles } : undefined}
      />
    </PublicShell>
  )
}
