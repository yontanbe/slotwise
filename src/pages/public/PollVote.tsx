import { useState } from 'react'
import { useParams } from 'react-router-dom'
import PublicShell, { NotFound } from '../../components/PublicShell'
import { Avatar, Field, useToast } from '../../components/ui'
import { useLoad, useStore } from '../../data/StoreProvider'
import { useI18n } from '../../i18n'
import { uid, nowISO } from '../../lib/id'
import { locationName } from '../../lib/locations'
import type { Poll, Vote } from '../../lib/types'

export const VOTE_MARK: Record<Vote, string> = { yes: '✓', maybe: '?', no: '·' }
const next: Record<Vote, Vote> = { no: 'yes', yes: 'maybe', maybe: 'no' }

export function scorePoll(p: Poll) {
  return p.options.map((_, i) => p.voters.reduce((s, v) => s + (v.votes[i] === 'yes' ? 1 : v.votes[i] === 'maybe' ? 0.5 : 0), 0))
}

function guessTz() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return 'Asia/Jerusalem'
  }
}

export function PollGrid({ poll, tz, draft, onDraft }: { poll: Poll; tz: string; draft?: Vote[]; onDraft?: (v: Vote[]) => void }) {
  const { L, fmtDate, fmtTime } = useI18n()
  const scores = scorePoll(poll)
  const best = Math.max(0, ...scores)
  return (
    <div className="poll-scroll">
      <table className="poll">
        <thead>
          <tr>
            <th />
            {poll.options.map((o, i) => (
              <th key={i} className={best > 0 && scores[i] === best ? 'best' : ''} aria-label={o.start}>
                <div className="poll-date">{fmtDate(o.start, tz, { weekday: 'short' })}</div>
                <div className="display" style={{ fontSize: 24, lineHeight: 1 }}>{fmtDate(o.start, tz, { day: 'numeric' })}</div>
                <div className="tiny muted">{fmtDate(o.start, tz, { month: 'short' })}</div>
                <div className="mono small ltr">{fmtTime(o.start, tz)}</div>
                {poll.chosenIndex === i && <span className="stamp ok" style={{ marginTop: 6 }}>{L('נבחר', 'Chosen')}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {poll.voters.map((v) => (
            <tr key={v.id}>
              <td className="poll-name">
                <Avatar name={v.name} size={26} /> {v.name}
              </td>
              {poll.options.map((_, i) => (
                <td key={i} className={`vote ${v.votes[i] || 'no'}`}>{VOTE_MARK[v.votes[i] || 'no']}</td>
              ))}
            </tr>
          ))}
          {draft && onDraft && (
            <tr className="draft">
              <td className="poll-name">{L('את/ה', 'You')}</td>
              {poll.options.map((_, i) => (
                <td key={i}>
                  <button type="button" className={`vote-btn ${draft[i]}`} onClick={() => onDraft(draft.map((x, j) => (j === i ? next[x] : x)))} aria-label={draft[i]}>
                    {VOTE_MARK[draft[i]]}
                  </button>
                </td>
              ))}
            </tr>
          )}
          <tr className="poll-total">
            <td className="tiny muted">{L('סה״כ', 'Total')}</td>
            {scores.map((s, i) => (
              <td key={i} className="mono">{s}</td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

export default function PollVote() {
  const { id = '' } = useParams()
  const store = useStore()
  const toast = useToast()
  const { L } = useI18n()
  const { data, loading } = useLoad(() => store.getPoll(id), [id])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [draft, setDraft] = useState<Vote[] | null>(null)
  const [done, setDone] = useState(false)
  if (loading) return <PublicShell><div className="boot"><span className="boot-dot" /></div></PublicShell>
  if (!data) return <NotFound />
  const { poll, user } = data
  const tz = guessTz()
  const d = draft ?? poll.options.map(() => 'no' as Vote)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return toast(L('נא למלא שם', 'Please enter your name'), true)
    const r = await store.votePoll(poll.id, { id: uid(), name: name.trim(), email: email.trim(), votes: d, at: nowISO() })
    if (r) {
      setDone(true)
      toast(L('ההצבעה נשמרה', 'Vote saved'))
    }
  }

  return (
    <PublicShell>
      <div className="poll-head rise">
        <div>
          <div className="eyebrow">{L('סקר מועדים מאת', 'Scheduling poll by')} {user.name}</div>
          <h1>{poll.title}</h1>
          {poll.description && <p className="muted" style={{ marginTop: 8 }}>{poll.description}</p>}
          <p className="small" style={{ marginTop: 10 }}>
            {poll.duration} {L('דקות', 'minutes')} · {locationName(poll.location.type, L)} · <span className="muted">{tz}</span>
          </p>
        </div>
        <div className="illus-frame" style={{ width: 160, height: 160, flex: 'none' }}>
          <img className="illus" src="./illustrations/poll.webp" alt="" style={{ width: 160, height: 160, objectFit: 'cover' }} />
        </div>
      </div>
      <div className="rule-strong" style={{ margin: '20px 0' }} />
      {poll.status === 'closed' ? (
        <>
          <div className="notice accent" style={{ marginBottom: 16 }}>{L('הסקר נסגר.', 'This poll is closed.')}</div>
          <PollGrid poll={poll} tz={tz} />
        </>
      ) : (
        <form onSubmit={submit} className="stack" style={{ ['--gap' as string]: '18px' }}>
          <p className="small muted">{L('לחצו על כל משבצת כדי לעבור בין כן (✓), אולי (?) ולא (·).', 'Tap a cell to cycle yes (✓), maybe (?) and no (·).')}</p>
          <PollGrid poll={poll} tz={tz} draft={done ? undefined : d} onDraft={setDraft} />
          {!done && (
            <div className="grid-2" style={{ maxWidth: 640 }}>
              <Field label={L('שם', 'Name')} required>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label={L('מייל (כדי לעדכן אותך)', 'Email (to update you)')}>
                <input className="input ltr" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
            </div>
          )}
          {!done ? (
            <button className="btn btn-accent btn-lg" style={{ alignSelf: 'flex-start' }}>
              {L('שליחת ההצבעה', 'Submit vote')}
            </button>
          ) : (
            <div className="notice">{L('תודה! נעדכן כשייבחר מועד.', 'Thanks! We will let you know when a time is chosen.')}</div>
          )}
        </form>
      )}
    </PublicShell>
  )
}
