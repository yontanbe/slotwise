import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { QuestionField } from '../../components/Booker'
import PublicShell, { NotFound } from '../../components/PublicShell'
import { Avatar, useToast } from '../../components/ui'
import { useLoad, useStore } from '../../data/StoreProvider'
import { useI18n } from '../../i18n'
import { nowISO, uid } from '../../lib/id'
import { routeFor } from '../../lib/routing'
import type { Question } from '../../lib/types'

type Answers = Record<string, string | string[] | boolean>

const visible = (q: Question, a: Answers) => !q.showIf || String(a[q.showIf.questionId] ?? '') === q.showIf.equals

export default function RoutingPage() {
  const { username = '', slug = '' } = useParams()
  const store = useStore()
  const nav = useNavigate()
  const toast = useToast()
  const { L } = useI18n()
  const { data, loading } = useLoad(() => store.getRoutingForm(username, slug), [username, slug])
  const [answers, setAnswers] = useState<Answers>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  if (loading) return <PublicShell><div className="boot"><span className="boot-dot" /></div></PublicShell>
  if (!data) return <NotFound />
  const { form, profile } = data

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const errs: Record<string, string> = {}
    form.fields.filter((q) => visible(q, answers) && q.required).forEach((q) => {
      const v = answers[q.id]
      if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) errs[q.id] = L('שדה חובה', 'Required')
    })
    setErrors(errs)
    if (Object.keys(errs).length) return
    const target = routeFor(form, answers)
    const id = uid()
    const routedTo = target.type === 'event' ? `event:${target.eventTypeId}` : target.type === 'url' ? `url:${target.url}` : 'message'
    try {
      await store.submitRouting(form.id, { id, answers, routedTo, at: nowISO() })
    } catch {
      toast(L('לא הצלחנו לשמור, ממשיכים בכל זאת', 'Could not save, continuing anyway'), true)
    }
    if (target.type === 'message') return setMessage(target.text)
    if (target.type === 'url') {
      if (/^https?:\/\//i.test(target.url)) window.location.href = target.url
      return
    }
    // prefill the booking form from answers: name, email, phone fields and question ids
    const q = new URLSearchParams()
    for (const f of form.fields) {
      const v = answers[f.id]
      if (v === undefined) continue
      const key = f.type === 'email' ? 'email' : f.type === 'phone' ? 'phone' : f.id
      q.set(key, Array.isArray(v) ? v.join(',') : String(v))
    }
    q.set('rr', id)
    if (target.teamSlug) {
      const team = await store.getTeam(target.teamSlug)
      const et = team?.eventTypes.find((x) => x.id === target.eventTypeId)
      if (team && et) return nav(`/team/${team.team.slug}/${et.slug}?${q}`)
    }
    const et = profile.eventTypes.find((x) => x.id === target.eventTypeId)
    if (et) return nav(`/${profile.user.username}/${et.slug}?${q}`)
    setMessage(L('תודה! נחזור אליכם בהקדם.', 'Thanks! We will get back to you soon.'))
  }

  return (
    <PublicShell wide={false}>
      <div className="stack rise" style={{ ['--gap' as string]: '22px', paddingTop: 24 }}>
        <div className="row" style={{ gap: 12 }}>
          <Avatar name={profile.user.name} src={profile.user.avatarUrl} size={44} />
          <div className="eyebrow">{profile.user.name}</div>
        </div>
        <h1>{form.title}</h1>
        {form.description && <p className="muted" style={{ fontSize: 17 }}>{form.description}</p>}
        <div className="rule-strong" />
        {message ? (
          <div className="route-msg">{message}</div>
        ) : (
          <form className="stack" onSubmit={submit} noValidate style={{ ['--gap' as string]: '16px' }}>
            {form.fields.filter((q) => visible(q, answers)).map((q) => (
              <QuestionField key={q.id} q={q} value={answers[q.id]} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} error={errors[q.id]} />
            ))}
            <button className="btn btn-accent btn-lg" style={{ alignSelf: 'flex-start' }}>{L('המשך', 'Continue')}</button>
          </form>
        )}
      </div>
    </PublicShell>
  )
}
