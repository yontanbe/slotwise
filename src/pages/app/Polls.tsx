import { useNavigate, Link } from 'react-router-dom'
import { useMe } from '../../auth/AuthProvider'
import PageHead from '../../components/PageHead'
import { Empty, Icon, useCopy } from '../../components/ui'
import { useLoad, useStore } from '../../data/StoreProvider'
import { useI18n } from '../../i18n'
import { nowISO, uid } from '../../lib/id'
import { appUrl } from '../../lib/links'
import type { Poll } from '../../lib/types'
import { scorePoll } from '../public/PollVote'

export default function Polls() {
  const me = useMe()
  const store = useStore()
  const nav = useNavigate()
  const copy = useCopy()
  const { L, fmtDate } = useI18n()
  const polls = useLoad(() => store.listPolls(me.id), [me.id])
  const create = async () => {
    const p: Poll = { id: uid(), ownerId: me.id, title: L('סקר חדש', 'New poll'), description: '', duration: 30, location: { type: 'meet' }, options: [], voters: [], status: 'open', chosenIndex: null, createdAt: nowISO() }
    await store.savePoll(p)
    nav(`/app/polls/${p.id}`)
  }
  const list = (polls.data ?? []).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return (
    <div className="stack" style={{ ['--gap' as string]: '22px' }}>
      <PageHead title={L('סקרי מועדים', 'Meeting polls')} sub={L('מציעים כמה מועדים, המשתתפים מצביעים בלי חשבון, ואתם קובעים את המנצח.', 'Offer a few times, people vote without an account, you book the winner.')} actions={<button className="btn btn-accent" onClick={create}><Icon name="plus" size={15} /> {L('סקר חדש', 'New poll')}</button>} />
      {list.length === 0 ? (
        <Empty img="poll" title={L('אין סקרים עדיין', 'No polls yet')} action={<button className="btn btn-accent" onClick={create}>{L('יצירת סקר', 'Create a poll')}</button>} />
      ) : (
        <div className="timetable">
          {list.map((p) => {
            const scores = scorePoll(p)
            const best = scores.length ? scores.indexOf(Math.max(...scores)) : -1
            return (
              <div key={p.id} className="tt-row">
                <div className="tt-time"><b>{p.voters.length}</b>{L('הצביעו', 'votes')}</div>
                <Link to={`/app/polls/${p.id}`} style={{ textDecoration: 'none', minWidth: 0 }}>
                  <h3 style={{ fontSize: 20 }}>{p.title}</h3>
                  <div className="tiny muted">
                    {p.options.length} {L('אפשרויות', 'options')}
                    {best >= 0 && p.options[best] && <> · {L('מוביל:', 'Leading:')} {fmtDate(p.options[best].start, me.timezone, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</>}
                  </div>
                </Link>
                <div className="row" style={{ gap: 6 }}>
                  <span className={`stamp ${p.status === 'open' ? 'ok' : 'mute'}`}>{p.status === 'open' ? L('פתוח', 'Open') : L('סגור', 'Closed')}</span>
                  <button className="icon-btn" onClick={() => copy(appUrl(`/p/${p.id}`))}><Icon name="copy" size={15} /></button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
