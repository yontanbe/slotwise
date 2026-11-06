import { useParams } from 'react-router-dom'
import Booker from '../../components/Booker'
import PublicShell, { NotFound } from '../../components/PublicShell'
import { useLoad, useStore } from '../../data/StoreProvider'
import { useI18n } from '../../i18n'

export default function LinkPage() {
  const { token = '' } = useParams()
  const store = useStore()
  const { L } = useI18n()
  const { data, loading } = useLoad(() => store.getLink(token), [token])
  if (loading) return <PublicShell><div className="boot"><span className="boot-dot" /></div></PublicShell>
  if (!data) return <NotFound />
  const { link, profile } = data
  if (link.usedBookingId || (link.expiresAt && link.expiresAt < new Date().toISOString()))
    return <NotFound text={L('הקישור החד פעמי הזה כבר נוצל או שפג תוקפו.', 'This single use link was already used or expired.')} />
  const et = profile.eventTypes.find((e) => e.id === link.eventTypeId)
  if (!et) return <NotFound />
  return (
    <PublicShell>
      <div className="notice accent small" style={{ marginBottom: 18 }}>
        {L('קישור אישי וחד פעמי', 'Personal single use link')}
        {link.label ? ` · ${link.label}` : ''}
      </div>
      <Booker key={et.id} profile={profile} eventType={et} linkToken={token} />
    </PublicShell>
  )
}
