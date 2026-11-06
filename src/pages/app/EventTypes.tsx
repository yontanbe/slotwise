import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMe } from '../../auth/AuthProvider'
import PageHead from '../../components/PageHead'
import { Empty, Field, Icon, Modal, Toggle, useCopy, useToast } from '../../components/ui'
import { newEventType } from '../../data/defaults'
import { useLoad, useStore } from '../../data/StoreProvider'
import { useI18n } from '../../i18n'
import { nowISO, token, uid } from '../../lib/id'
import { appUrl } from '../../lib/links'
import { locationName } from '../../lib/locations'
import type { EventType } from '../../lib/types'

export default function EventTypes() {
  const me = useMe()
  const store = useStore()
  const nav = useNavigate()
  const copy = useCopy()
  const toast = useToast()
  const { L, fmtDate } = useI18n()
  const data = useLoad(async () => ({ ets: await store.listEventTypes(me.id), links: await store.listLinks(me.id), schedules: await store.listSchedules(me.id) }), [me.id])
  const [q, setQ] = useState('')
  const [linkFor, setLinkFor] = useState<EventType | null>(null)
  const [linkLabel, setLinkLabel] = useState('')
  const ets = data.data?.ets ?? []
  const links = data.data?.links ?? []
  const filtered = ets.filter((e) => !q || e.title.toLowerCase().includes(q.toLowerCase()))

  const create = async () => {
    const sid = me.defaultScheduleId || data.data?.schedules[0]?.id || ''
    const et = newEventType(me.id, sid, L('פגישה חדשה', 'New meeting'), 30)
    et.slug = 'meeting-' + uid(4)
    et.position = ets.length
    await store.saveEventType(et)
    nav(`/app/event-types/${et.id}`)
  }
  const duplicate = async (e: EventType) => {
    await store.saveEventType({ ...e, id: uid(), slug: e.slug + '-copy', title: e.title + L(' (העתק)', ' (copy)'), position: ets.length, createdAt: nowISO() })
    toast(L('שוכפל', 'Duplicated'))
  }
  const remove = async (e: EventType) => {
    if (!window.confirm(L(`למחוק את "${e.title}"? פגישות קיימות יישארו.`, `Delete "${e.title}"? Existing bookings stay.`))) return
    await store.deleteEventType(e.id)
  }
  const move = async (i: number, d: -1 | 1) => {
    const arr = [...ets]
    const j = i + d
    if (j < 0 || j >= arr.length) return
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
    await Promise.all(arr.map((e, k) => (e.position !== k ? store.saveEventType({ ...e, position: k }) : null)))
  }
  const makeLink = async () => {
    if (!linkFor) return
    const l = { id: uid(), token: token(), ownerId: me.id, eventTypeId: linkFor.id, label: linkLabel, createdAt: nowISO() }
    await store.saveLink(l)
    copy(appUrl(`/d/${l.token}`))
    setLinkFor(null)
    setLinkLabel('')
  }

  return (
    <div className="stack" style={{ ['--gap' as string]: '26px' }}>
      <PageHead
        title={L('סוגי פגישות', 'Event types')}
        sub={L('כל כרטיס הוא קישור שאפשר לשתף.', 'Each card is a link you can share.')}
        actions={
          <>
            <input className="input" style={{ width: 200 }} placeholder={L('חיפוש…', 'Search…')} value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn btn-accent" onClick={create}><Icon name="plus" size={16} /> {L('חדש', 'New')}</button>
          </>
        }
      />
      {ets.length === 0 && !data.loading ? (
        <Empty img="onboarding" title={L('עוד אין סוגי פגישות', 'No event types yet')} action={<button className="btn btn-accent" onClick={create}>{L('יצירת הראשון', 'Create the first')}</button>} />
      ) : (
        <div className="et-grid">
          {filtered.map((e) => {
            const i = ets.indexOf(e)
            return (
              <div key={e.id} className={`index-card et-card${e.hidden ? ' is-hidden' : ''}`} style={{ ['--tab' as string]: e.color }}>
                <div className="row between">
                  <span className="eyebrow">{e.durations.join(' / ')} {L('דק׳', 'min')}</span>
                  <div className="row" style={{ gap: 6 }}>
                    {e.hidden && <span className="chip">{L('מוסתר', 'Hidden')}</span>}
                    {e.seats ? <span className="chip sage">{e.seats} {L('מקומות', 'seats')}</span> : null}
                    {e.requiresConfirmation && <span className="chip accent">{L('באישור', 'Approval')}</span>}
                  </div>
                </div>
                <Link to={`/app/event-types/${e.id}`} className="et-title"><h3>{e.title}</h3></Link>
                <div className="tiny muted ltr">/{me.username}/{e.slug}</div>
                <div className="tiny muted" style={{ marginTop: 6 }}>{e.locations.map((l) => locationName(l.type, L)).join(' · ')}</div>
                <hr className="rule" style={{ margin: '14px 0 10px' }} />
                <div className="row between">
                  <div className="row" style={{ gap: 4 }}>
                    <button className="icon-btn" title={L('העתקת קישור', 'Copy link')} onClick={() => copy(appUrl(`/${me.username}/${e.slug}`))}><Icon name="copy" size={15} /></button>
                    <button className="icon-btn" title={L('קישור חד פעמי', 'Single use link')} onClick={() => setLinkFor(e)}><Icon name="link" size={15} /></button>
                    <a className="icon-btn" title={L('תצוגה', 'Preview')} href={appUrl(`/${me.username}/${e.slug}`)} target="_blank" rel="noreferrer"><Icon name="eye" size={15} /></a>
                    <button className="icon-btn" title={L('שכפול', 'Duplicate')} onClick={() => duplicate(e)}><Icon name="cards" size={15} /></button>
                    <button className="icon-btn" title={L('מחיקה', 'Delete')} onClick={() => remove(e)}><Icon name="trash" size={15} /></button>
                  </div>
                  <div className="row" style={{ gap: 4 }}>
                    <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="up">↑</button>
                    <button className="icon-btn" disabled={i === ets.length - 1} onClick={() => move(i, 1)} aria-label="down">↓</button>
                    <Toggle checked={!e.hidden} onChange={(v) => store.saveEventType({ ...e, hidden: !v })} label={L('מוצג בפרופיל', 'Shown on profile')} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {links.length > 0 && (
        <section>
          <h2 style={{ fontSize: 24, marginBottom: 8 }}>{L('קישורים חד פעמיים', 'Single use links')}</h2>
          <table className="data">
            <thead>
              <tr>
                <th>{L('תיאור', 'Label')}</th>
                <th>{L('סוג', 'Event')}</th>
                <th>{L('נוצר', 'Created')}</th>
                <th>{L('סטטוס', 'Status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {links.map((l) => (
                <tr key={l.id}>
                  <td>{l.label || '—'}</td>
                  <td>{ets.find((e) => e.id === l.eventTypeId)?.title}</td>
                  <td className="small">{fmtDate(l.createdAt, me.timezone, { day: 'numeric', month: 'short' })}</td>
                  <td>{l.usedBookingId ? <span className="stamp mute">{L('נוצל', 'Used')}</span> : <span className="stamp ok">{L('פעיל', 'Active')}</span>}</td>
                  <td>
                    <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                      {!l.usedBookingId && <button className="icon-btn" onClick={() => copy(appUrl(`/d/${l.token}`))}><Icon name="copy" size={14} /></button>}
                      <button className="icon-btn" onClick={() => store.deleteLink(l.id)}><Icon name="trash" size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <Modal open={!!linkFor} onClose={() => setLinkFor(null)}>
        <div className="stack" style={{ ['--gap' as string]: '14px' }}>
          <h3>{L('קישור חד פעמי', 'Single use link')}</h3>
          <p className="small muted">{L(`קישור ל"${linkFor?.title}" שעובד לפגישה אחת בלבד, גם אם סוג הפגישה מוסתר.`, `A link to "${linkFor?.title}" that works for one booking only, even if the event type is hidden.`)}</p>
          <Field label={L('למי? (לא חובה)', 'For whom? (optional)')}>
            <input className="input" value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} placeholder={L('למשל: דנה מ-Acme', 'e.g. Dana from Acme')} />
          </Field>
          <button className="btn btn-accent" onClick={makeLink}>{L('יצירה והעתקה', 'Create and copy')}</button>
        </div>
      </Modal>
    </div>
  )
}
