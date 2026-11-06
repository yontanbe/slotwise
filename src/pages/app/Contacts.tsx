import { useMemo, useState } from 'react'
import { useMe } from '../../auth/AuthProvider'
import { BookingDetails } from '../../components/BookingParts'
import PageHead from '../../components/PageHead'
import { Avatar, Empty, Icon, StatusStamp } from '../../components/ui'
import { useLoad, useStore } from '../../data/StoreProvider'
import { useI18n } from '../../i18n'
import { whatsappLink } from '../../lib/links'
import type { Booking } from '../../lib/types'

interface Contact {
  email: string
  name: string
  phone: string
  bookings: Booking[]
  last: string
  noShows: number
}

export default function Contacts() {
  const me = useMe()
  const store = useStore()
  const { L, fmtDate, fmtTime } = useI18n()
  const data = useLoad(async () => ({ bookings: await store.listBookings(me.id), ets: await store.listEventTypes(me.id) }), [me.id])
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [open, setOpen] = useState<Booking | null>(null)
  const contacts = useMemo(() => {
    const m = new Map<string, Contact>()
    for (const b of data.data?.bookings ?? []) {
      const k = b.attendee.email.toLowerCase()
      const c = m.get(k) ?? { email: b.attendee.email, name: b.attendee.name, phone: b.attendee.phone, bookings: [], last: '', noShows: 0 }
      c.bookings.push(b)
      if (b.start > c.last) {
        c.last = b.start
        c.name = b.attendee.name
        c.phone = b.attendee.phone || c.phone
      }
      if (b.noShow) c.noShows++
      m.set(k, c)
    }
    return [...m.values()].sort((a, b) => b.last.localeCompare(a.last))
  }, [data.data])
  const n = q.toLowerCase()
  const list = contacts.filter((c) => !n || `${c.name} ${c.email} ${c.phone}`.toLowerCase().includes(n))
  const cur = contacts.find((c) => c.email.toLowerCase() === sel)

  return (
    <div className="stack" style={{ ['--gap' as string]: '22px' }}>
      <PageHead title={L('אנשי קשר', 'Contacts')} sub={L('כל מי שקבע איתך, עם ההיסטוריה המלאה.', 'Everyone who booked you, with full history.')} />
      <div className="input-group" style={{ maxWidth: 420 }}>
        <span className="addon"><Icon name="search" size={16} /></span>
        <input aria-label={L('חיפוש', 'Search')} className="input" placeholder={L('חיפוש', 'Search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {contacts.length === 0 ? (
        <Empty title={L('עוד אין אנשי קשר', 'No contacts yet')} />
      ) : (
        <div className="contacts">
          <ul className="list-plain contact-list">
            {list.map((c) => (
              <li key={c.email}>
                <button className="contact-item" aria-pressed={sel === c.email.toLowerCase()} onClick={() => setSel(c.email.toLowerCase())}>
                  <Avatar name={c.name} size={36} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{c.name}</div>
                    <div className="tiny muted ltr ellipsis">{c.email}</div>
                  </div>
                  <span className="count">{c.bookings.length}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="card">
            {cur ? (
              <div className="stack" style={{ ['--gap' as string]: '16px' }}>
                <div className="row" style={{ gap: 14 }}>
                  <Avatar name={cur.name} size={56} />
                  <div className="grow">
                    <h2>{cur.name}</h2>
                    <div className="small muted ltr">{cur.email}{cur.phone ? ` · ${cur.phone}` : ''}</div>
                  </div>
                  {cur.phone && <a className="btn btn-line btn-sm" href={whatsappLink(cur.phone, '')} target="_blank" rel="noreferrer"><Icon name="whatsapp" size={15} /> WhatsApp</a>}
                  <a className="btn btn-line btn-sm" href={`mailto:${cur.email}`}><Icon name="mail" size={15} /></a>
                </div>
                <div className="row" style={{ gap: 28 }}>
                  <div><div className="numeral" style={{ fontSize: 40 }}>{cur.bookings.length}</div><div className="tiny muted">{L('פגישות', 'meetings')}</div></div>
                  <div><div className="numeral" style={{ fontSize: 40 }}>{cur.bookings.filter((b) => b.status === 'cancelled').length}</div><div className="tiny muted">{L('ביטולים', 'cancelled')}</div></div>
                  <div><div className="numeral" style={{ fontSize: 40 }}>{cur.noShows}</div><div className="tiny muted">{L('לא הגיע', 'no shows')}</div></div>
                </div>
                <div className="timetable">
                  {cur.bookings.sort((a, b) => b.start.localeCompare(a.start)).map((b) => (
                    <button key={b.id} className="tt-row" onClick={() => setOpen(b)}>
                      <div className="tt-time"><b>{fmtDate(b.start, me.timezone, { day: 'numeric', month: 'short' })}</b>{fmtTime(b.start, me.timezone)}</div>
                      <div>{b.title}</div>
                      <StatusStamp status={b.status} noShow={b.noShow} />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="muted">{L('בחרו איש קשר', 'Select a contact')}</p>
            )}
          </div>
        </div>
      )}
      {open && <BookingDetails key={open.id} b={(data.data?.bookings ?? []).find((x) => x.id === open.id) ?? open} et={data.data?.ets.find((e) => e.id === open.eventTypeId)} onClose={() => setOpen(null)} />}
    </div>
  )
}
