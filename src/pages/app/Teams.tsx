import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMe } from '../../auth/AuthProvider'
import PageHead from '../../components/PageHead'
import { Avatar, Empty, Field, Icon, Modal, useCopy, useToast } from '../../components/ui'
import { newEventType } from '../../data/defaults'
import { useLoad, useStore } from '../../data/StoreProvider'
import { useI18n } from '../../i18n'
import { nowISO, slugify, uid } from '../../lib/id'
import { appUrl } from '../../lib/links'
import type { Team } from '../../lib/types'

export default function Teams() {
  const me = useMe()
  const store = useStore()
  const nav = useNavigate()
  const copy = useCopy()
  const toast = useToast()
  const { L } = useI18n()
  const data = useLoad(async () => {
    const teams = await store.listMyTeams(me.id)
    const bundles = await Promise.all(teams.map((t) => store.getTeam(t.slug)))
    const mine = await store.listKind('team_member', me.id)
    return { teams, bundles, mine }
  }, [me.id])
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [adding, setAdding] = useState<Record<string, string>>({})

  const create = async () => {
    const s = (slug || slugify(name)).toLowerCase().replace(/[^a-z0-9-]/g, '')
    if (!name.trim() || s.length < 3) return toast(L('שם וכתובת באנגלית (3 תווים לפחות)', 'Name and a latin slug (3+ chars)'), true)
    if (await store.getTeam(s)) return toast(L('הכתובת תפוסה', 'Slug taken'), true)
    const t: Team = { id: uid(), ownerId: me.id, name: name.trim(), slug: s, bio: '', members: [{ userId: me.id, role: 'owner', accepted: true }], createdAt: nowISO() }
    await store.saveKind('team', t)
    await store.saveKind('team_member', { id: `${t.id}:${me.id}`, ownerId: me.id, teamId: t.id, userId: me.id, accepted: true })
    setCreating(false)
    setName('')
    setSlug('')
  }
  const addMember = async (t: Team) => {
    const u = await store.findUserByUsername((adding[t.id] || '').trim().replace(/^@/, ''))
    if (!u) return toast(L('לא נמצא משתמש כזה', 'No such user'), true)
    if (t.members.some((m) => m.userId === u.id)) return toast(L('כבר בצוות', 'Already a member'), true)
    await store.saveKind('team', { ...t, members: [...t.members, { userId: u.id, role: 'member', accepted: true }] })
    setAdding({ ...adding, [t.id]: '' })
    toast(L('נוסף. החבר/ה צריך/ה לאשר את ההזמנה בדף הצוותים שלו/ה.', 'Added. They need to accept the invite on their Teams page.'))
  }
  const newTeamEvent = async (t: Team, mode: 'round_robin' | 'collective') => {
    const et = newEventType(me.id, me.defaultScheduleId, mode === 'collective' ? L('פגישת צוות', 'Team meeting') : L('שיחה עם הצוות', 'Talk to the team'), 30)
    et.slug = (mode === 'collective' ? 'together-' : 'rr-') + uid(4)
    et.teamId = t.id
    et.schedulingType = mode
    et.hosts = t.members.filter((m) => m.accepted).map((m) => ({ userId: m.userId, priority: 2, weight: 50 }))
    await store.saveEventType(et)
    nav(`/app/event-types/${et.id}`)
  }

  const teams = data.data?.teams ?? []
  return (
    <div className="stack" style={{ ['--gap' as string]: '24px' }}>
      <PageHead
        title={L('צוותים', 'Teams')}
        sub={L('סבב (round robin) מחלק פגישות בין אנשי הצוות. משותף (collective) מציג רק זמנים שכולם פנויים.', 'Round robin spreads meetings across the team. Collective shows only times everyone is free.')}
        actions={<button className="btn btn-accent" onClick={() => setCreating(true)}><Icon name="plus" size={15} /> {L('צוות חדש', 'New team')}</button>}
      />
      {teams.length === 0 && !data.loading && <Empty img="poll" title={L('עוד אין צוותים', 'No teams yet')} />}
      {teams
        .filter((t) => !(data.data?.mine ?? []).some((m) => m.teamId === t.id && m.accepted))
        .map((t) => (
          <div key={'inv-' + t.id} className="notice accent">
            <Icon name="users" />
            <div className="grow">
              {L(`הוזמנת לצוות "${t.name}". אחרי האישור אנשים יוכלו לקבוע איתך דרך הצוות.`, `You were invited to "${t.name}". Once you accept, people can book you through the team.`)}
            </div>
            <button className="btn btn-accent btn-sm" onClick={async () => { await store.saveKind('team_member', { id: `${t.id}:${me.id}`, ownerId: me.id, teamId: t.id, userId: me.id, accepted: true }); toast(L('הצטרפת לצוות', 'You joined the team')) }}>
              {L('אישור', 'Accept')}
            </button>
          </div>
        ))}
      {teams.map((t, i) => {
        const b = data.data?.bundles[i]
        const isAdmin = t.ownerId === me.id || t.members.some((m) => m.userId === me.id && m.role !== 'member')
        return (
          <section key={t.id} className="card stack" style={{ ['--gap' as string]: '16px' }}>
            <div className="row between wrap" style={{ gap: 10 }}>
              <div>
                <h2 style={{ fontSize: 28 }}>{t.name}</h2>
                <div className="tiny muted ltr">/team/{t.slug}</div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn btn-line btn-sm" onClick={() => copy(appUrl(`/team/${t.slug}`))}><Icon name="copy" size={14} /> {L('קישור', 'Link')}</button>
                <a className="btn btn-line btn-sm" aria-label={L('תצוגה בלשונית חדשה', 'Preview in a new tab')} href={appUrl(`/team/${t.slug}`)} target="_blank" rel="noreferrer"><Icon name="eye" size={14} /></a>
              </div>
            </div>
            <div className="row wrap" style={{ gap: 14 }}>
              {(b?.members ?? []).map((m) => (
                <div key={m.user.id} className="row" style={{ gap: 8 }}>
                  <Avatar name={m.user.name} src={m.user.avatarUrl} size={34} />
                  <div>
                    <div className="small" style={{ fontWeight: 600 }}>{m.user.name}</div>
                    <div className="tiny muted">{t.members.find((x) => x.userId === m.user.id)?.role === 'owner' ? L('בעלים', 'Owner') : L('חבר/ה', 'Member')}</div>
                  </div>
                  {isAdmin && m.user.id !== t.ownerId && (
                    <button className="icon-btn" title={L('הסרה', 'Remove')} onClick={() => store.saveKind('team', { ...t, members: t.members.filter((x) => x.userId !== m.user.id) })} aria-label={L('הסרה', 'Remove')}><Icon name="x" size={12} /></button>
                  )}
                </div>
              ))}
            </div>
            {isAdmin && (
              <div className="row wrap" style={{ gap: 8 }}>
                <input className="input input-sm ltr" style={{ maxWidth: 220 }} placeholder={L('שם משתמש להוספה', 'username to add')} value={adding[t.id] || ''} onChange={(e) => setAdding({ ...adding, [t.id]: e.target.value })} />
                <button className="btn btn-line btn-sm" onClick={() => addMember(t)}>{L('הוספה', 'Add')}</button>
              </div>
            )}
            <hr className="rule" />
            <div className="row between wrap" style={{ gap: 8 }}>
              <h3>{L('סוגי פגישות של הצוות', 'Team event types')}</h3>
              {isAdmin && (
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => newTeamEvent(t, 'round_robin')}><Icon name="plus" size={14} /> {L('סבב', 'Round robin')}</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => newTeamEvent(t, 'collective')}><Icon name="plus" size={14} /> {L('משותף', 'Collective')}</button>
                </div>
              )}
            </div>
            <div className="timetable">
              {(b?.eventTypes ?? []).map((e) => (
                <div key={e.id} className="tt-row">
                  <div className="tt-time"><b>{e.defaultDuration}</b>{L('דק׳', 'min')}</div>
                  <div>
                    {e.ownerId === me.id ? <Link to={`/app/event-types/${e.id}`} className="link">{e.title}</Link> : <span>{e.title}</span>}
                    <div className="tiny muted">{e.schedulingType === 'collective' ? L('כולם יחד', 'Collective') : L('סבב', 'Round robin')} · {(e.hosts || []).length} {L('מארחים', 'hosts')}</div>
                  </div>
                  <button className="icon-btn" onClick={() => copy(appUrl(`/team/${t.slug}/${e.slug}`))} aria-label={L('העתקה', 'Copy')}><Icon name="copy" size={14} /></button>
                </div>
              ))}
            </div>
          </section>
        )
      })}
      <section className="card stack">
        <h3>{L('קישור קבוצתי דינמי', 'Dynamic group link')}</h3>
        <p className="small muted">{L('חברו שמות משתמשים עם + כדי לקבוע פגישה שכולם פנויים בה, בלי להקים צוות:', 'Join usernames with + to book a time everyone is free, no team needed:')}</p>
        <div className="code-block">{appUrl(`/${me.username}+noa/intro`)}</div>
      </section>
      <Modal open={creating} onClose={() => setCreating(false)}>
        <div className="stack" style={{ ['--gap' as string]: '14px' }}>
          <h3>{L('צוות חדש', 'New team')}</h3>
          <Field label={L('שם', 'Name')}><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label={L('כתובת', 'Slug')}>
            <div className="input-group ltr"><span className="addon">/team/</span><input aria-label={L('כתובת', 'Address slug')} className="input" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder={slugify(name)} /></div>
          </Field>
          <button className="btn btn-accent" onClick={create}>{L('יצירה', 'Create')}</button>
        </div>
      </Modal>
    </div>
  )
}
