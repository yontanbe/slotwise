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
import type { EventType, PersonalLink } from '../../lib/types'

export default function EventTypes() {
  const me = useMe()
  const store = useStore()
  const nav = useNavigate()
  const copy = useCopy()
  const toast = useToast()
  const { L, fmtDate } = useI18n()
  const data = useLoad(
    async () => ({
      ets: await store.listEventTypes(me.id),
      links: await store.listLinks(me.id),
      schedules: await store.listSchedules(me.id),
      personal: await store.listKind('personal_link', me.id),
    }),
    [me.id],
  )
  const [pl, setPl] = useState<PersonalLink | null>(null)
  const [q, setQ] = useState('')
  const [linkFor, setLinkFor] = useState<EventType | null>(null)
  const [linkLabel, setLinkLabel] = useState('')
  const ets = (data.data?.ets ?? []).filter((e) => !e.teamId)
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
                    <button className="icon-btn" title={L('העתקת קישור', 'Copy link')} onClick={() => copy(appUrl(`/${me.username}/${e.slug}`))} aria-label={L('העתקה', 'Copy')}><Icon name="copy" size={15} /></button>
                    <button className="icon-btn" title={L('קישור חד פעמי', 'Single use link')} onClick={() => setLinkFor(e)} aria-label={L('קישור', 'Link')}><Icon name="link" size={15} /></button>
                    <a className="icon-btn" title={L('תצוגה', 'Preview')} href={appUrl(`/${me.username}/${e.slug}`)} target="_blank" rel="noreferrer" aria-label={L('תצוגה בלשונית חדשה', 'Preview in a new tab')}><Icon name="eye" size={15} /></a>
                    <button className="icon-btn" title={L('שכפול', 'Duplicate')} onClick={() => duplicate(e)} aria-label={L('שכפול', 'Duplicate')}><Icon name="cards" size={15} /></button>
                    <button className="icon-btn" title={L('מחיקה', 'Delete')} onClick={() => remove(e)} aria-label={L('מחיקה', 'Delete')}><Icon name="trash" size={15} /></button>
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

      <section>
        <div className="row between" style={{ marginBottom: 8 }}>
          <h2 style={{ fontSize: 24 }}>{L('קישורים אישיים', 'Personal links')}</h2>
          <button className="btn btn-line btn-sm" disabled={!ets.length} onClick={() => setPl({ id: uid(), ownerId: me.id, slug: '', eventTypeId: ets[0]?.id ?? '', name: '', email: '', greeting: '', createdAt: nowISO() })}>
            <Icon name="plus" size={14} /> {L('קישור אישי', 'Personal link')}
          </button>
        </div>
        <p className="small muted" style={{ marginBottom: 8 }}>{L('קישור עם שם, ברכה ופרטים ממולאים מראש לאדם אחד, למשל ', 'A link with a name, greeting and prefilled details for one person, e.g. ')}<span className="ltr mono">/{me.username}/dana</span></p>
        {(data.data?.personal ?? []).length > 0 && (
          <div className="timetable">
            {data.data!.personal.map((p) => (
              <div key={p.id} className="tt-row">
                <div className="tt-time"><b className="ltr">/{p.slug}</b></div>
                <div>
                  <div style={{ fontWeight: 600 }}>{p.name || p.slug}</div>
                  <div className="tiny muted">{ets.find((e) => e.id === p.eventTypeId)?.title} {p.greeting ? `· ${p.greeting.slice(0, 50)}` : ''}</div>
                </div>
                <div className="row" style={{ gap: 4 }}>
                  <button className="icon-btn" onClick={() => copy(appUrl(`/${me.username}/${p.slug}`))} aria-label={L('העתקה', 'Copy')}><Icon name="copy" size={14} /></button>
                  <button className="icon-btn" onClick={() => setPl(p)} aria-label={L('עריכה', 'Edit')}><Icon name="edit" size={14} /></button>
                  <button className="icon-btn" onClick={() => store.deleteKind('personal_link', p.id)} aria-label={L('מחיקה', 'Delete')}><Icon name="trash" size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

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
                      {!l.usedBookingId && <button className="icon-btn" onClick={() => copy(appUrl(`/d/${l.token}`))} aria-label={L('העתקה', 'Copy')}><Icon name="copy" size={14} /></button>}
                      <button className="icon-btn" onClick={() => store.deleteLink(l.id)} aria-label={L('מחיקה', 'Delete')}><Icon name="trash" size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {pl && (
        <Modal open onClose={() => setPl(null)}>
          <div className="stack" style={{ ['--gap' as string]: '14px' }}>
            <h3>{L('קישור אישי', 'Personal link')}</h3>
            <Field label={L('כתובת', 'Slug')}>
              <div className="input-group ltr"><span className="addon">/{me.username}/</span><input aria-label={L('כתובת', 'Address slug')} className="input" value={pl.slug} onChange={(e) => setPl({ ...pl, slug: e.target.value })} placeholder="dana" /></div>
            </Field>
            <Field label={L('סוג פגישה', 'Event type')}>
              <select className="select" value={pl.eventTypeId} onChange={(e) => setPl({ ...pl, eventTypeId: e.target.value })}>
                {ets.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
              </select>
            </Field>
            <div className="grid-2">
              <Field label={L('שם', 'Name')}><input aria-label={L('כתובת', 'Address slug')} className="input" value={pl.name} onChange={(e) => setPl({ ...pl, name: e.target.value })} /></Field>
              <Field label={L('מייל', 'Email')}><input className="input ltr" value={pl.email} onChange={(e) => setPl({ ...pl, email: e.target.value })} /></Field>
            </div>
            <Field label={L('ברכה', 'Greeting')}><textarea className="textarea" style={{ minHeight: 70 }} value={pl.greeting} onChange={(e) => setPl({ ...pl, greeting: e.target.value })} /></Field>
            <button className="btn btn-accent" onClick={async () => {
              const slug = pl.slug.toLowerCase().replace(/[^a-z0-9-]/g, '')
              if (slug.length < 2) return toast(L('כתובת באנגלית', 'A latin slug'), true)
              if (ets.some((e) => e.slug === slug) || (data.data?.personal ?? []).some((x) => x.id !== pl.id && x.slug === slug)) return toast(L('הכתובת תפוסה', 'Slug taken'), true)
              await store.saveKind('personal_link', { ...pl, slug })
              copy(appUrl(`/${me.username}/${slug}`))
              setPl(null)
            }}>{L('שמירה והעתקה', 'Save and copy')}</button>
          </div>
        </Modal>
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
