import { useState } from 'react'
import { useMe } from '../../auth/AuthProvider'
import PageHead from '../../components/PageHead'
import { Empty, Field, Icon, Modal, useCopy, useToast } from '../../components/ui'
import { useLoad, useStore } from '../../data/StoreProvider'
import { useI18n } from '../../i18n'
import { nowISO, slugify, uid } from '../../lib/id'
import { appUrl } from '../../lib/links'
import { describeTarget } from '../../lib/routing'
import type { EventType, Question, QuestionType, RouteTarget, RoutingCondition, RoutingForm } from '../../lib/types'

interface TargetOption {
  value: string
  label: string
  target: RouteTarget
}

export default function RoutingForms() {
  const me = useMe()
  const store = useStore()
  const copy = useCopy()
  const toast = useToast()
  const { L, fmtDate } = useI18n()
  const data = useLoad(async () => {
    const [forms, ets, teams] = await Promise.all([store.listKind('routing_form', me.id), store.listEventTypes(me.id), store.listMyTeams(me.id)])
    const teamBundles = await Promise.all(teams.map((t) => store.getTeam(t.slug)))
    return { forms, ets, teamBundles: teamBundles.filter(Boolean) as NonNullable<Awaited<ReturnType<typeof store.getTeam>>>[] }
  }, [me.id])
  const [edit, setEdit] = useState<RoutingForm | null>(null)
  const [responsesOf, setResponsesOf] = useState<RoutingForm | null>(null)

  const ets = data.data?.ets ?? []
  const options: TargetOption[] = [
    ...ets.filter((e) => !e.teamId).map((e) => ({ value: 'e:' + e.id, label: e.title, target: { type: 'event' as const, eventTypeId: e.id } })),
    ...(data.data?.teamBundles ?? []).flatMap((tb) =>
      tb.eventTypes.map((e: EventType) => ({ value: 'e:' + e.id, label: `${tb.team.name} · ${e.title}`, target: { type: 'event' as const, eventTypeId: e.id, teamSlug: tb.team.slug } })),
    ),
  ]
  const titleOf = (id: string) => options.find((o) => o.value === 'e:' + id)?.label ?? id

  const create = () =>
    setEdit({
      id: uid(),
      ownerId: me.id,
      title: L('טופס ניתוב חדש', 'New routing form'),
      description: '',
      slug: 'form-' + uid(4),
      fields: [
        { id: 'name', type: 'text', label: L('שם', 'Name'), required: true },
        { id: 'email', type: 'email', label: L('מייל', 'Email'), required: true },
      ],
      rules: [],
      fallback: ets[0] ? { type: 'event', eventTypeId: ets[0].id } : { type: 'message', text: L('תודה!', 'Thanks!') },
      responses: [],
      createdAt: nowISO(),
    })

  const forms = data.data?.forms ?? []
  return (
    <div className="stack" style={{ ['--gap' as string]: '24px' }}>
      <PageHead
        title={L('טפסי ניתוב', 'Routing forms')}
        sub={L('כמה שאלות לפני היומן, ואז כל אחד מגיע לפגישה הנכונה, לאדם הנכון או לדף אחר.', 'A few questions before the calendar, then everyone lands on the right meeting, person or page.')}
        actions={<button className="btn btn-accent" onClick={create}><Icon name="plus" size={15} /> {L('טופס חדש', 'New form')}</button>}
      />
      {forms.length === 0 ? (
        <Empty img="onboarding" title={L('אין טפסים עדיין', 'No forms yet')} />
      ) : (
        <div className="timetable">
          {forms.map((f) => (
            <div key={f.id} className="tt-row">
              <div className="tt-time"><b>{f.responses.length}</b>{L('תשובות', 'responses')}</div>
              <button className="link" style={{ textDecoration: 'none', textAlign: 'start' }} onClick={() => setEdit(f)}>
                <h3 style={{ fontSize: 20 }}>{f.title}</h3>
                <div className="tiny muted ltr">/{me.username}/forms/{f.slug}</div>
              </button>
              <div className="row" style={{ gap: 6 }}>
                <button className="icon-btn" title={L('תשובות', 'Responses')} onClick={() => setResponsesOf(f)}><Icon name="inbox" size={15} /></button>
                <button className="icon-btn" onClick={() => copy(appUrl(`/${me.username}/forms/${f.slug}`))}><Icon name="copy" size={15} /></button>
                <a className="icon-btn" href={appUrl(`/${me.username}/forms/${f.slug}`)} target="_blank" rel="noreferrer"><Icon name="eye" size={15} /></a>
                <button className="icon-btn" onClick={async () => { if (window.confirm(L('למחוק?', 'Delete?'))) await store.deleteKind('routing_form', f.id) }}><Icon name="trash" size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      {edit && (
        <FormEditor
          form={edit}
          options={options}
          onClose={() => setEdit(null)}
          onSave={async (f) => {
            const slug = slugify(f.slug).replace(/[^a-z0-9-]/g, '')
            if (!slug) return toast(L('צריך כתובת באנגלית', 'A latin slug is required'), true)
            if (forms.some((x) => x.id !== f.id && x.slug === slug)) return toast(L('הכתובת תפוסה', 'Slug taken'), true)
            await store.saveKind('routing_form', { ...f, slug })
            setEdit(null)
            toast(L('נשמר', 'Saved'))
          }}
        />
      )}
      {responsesOf && (
        <Modal open onClose={() => setResponsesOf(null)} wide>
          <div className="stack">
            <div className="row between">
              <h3>{responsesOf.title}</h3>
              <button className="icon-btn" onClick={() => setResponsesOf(null)}><Icon name="x" /></button>
            </div>
            <table className="data">
              <thead>
                <tr>
                  <th>{L('מתי', 'When')}</th>
                  {responsesOf.fields.map((q) => <th key={q.id}>{q.label}</th>)}
                  <th>{L('נותב אל', 'Routed to')}</th>
                </tr>
              </thead>
              <tbody>
                {[...responsesOf.responses].reverse().map((r) => (
                  <tr key={r.id}>
                    <td className="small">{fmtDate(r.at, me.timezone, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                    {responsesOf.fields.map((q) => <td key={q.id} className="small">{String(Array.isArray(r.answers[q.id]) ? (r.answers[q.id] as string[]).join(', ') : r.answers[q.id] ?? '')}</td>)}
                    <td className="small">{r.routedTo.startsWith('event:') ? titleOf(r.routedTo.slice(6)) : r.routedTo}</td>
                  </tr>
                ))}
                {responsesOf.responses.length === 0 && <tr><td className="muted small" colSpan={9}>{L('אין עדיין תשובות', 'No responses yet')}</td></tr>}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </div>
  )
}

const QTYPES: QuestionType[] = ['text', 'email', 'phone', 'number', 'select', 'multiselect', 'radio', 'textarea', 'url']

function TargetPicker({ value, onChange, options }: { value: RouteTarget; onChange: (t: RouteTarget) => void; options: TargetOption[] }) {
  const { L } = useI18n()
  const sel = value.type === 'event' ? 'e:' + value.eventTypeId : value.type
  return (
    <div className="row wrap" style={{ gap: 6 }}>
      <select
        className="select input-sm"
        style={{ width: 'auto', minWidth: 200 }}
        value={sel}
        onChange={(e) => {
          const v = e.target.value
          if (v === 'url') onChange({ type: 'url', url: 'https://' })
          else if (v === 'message') onChange({ type: 'message', text: '' })
          else onChange(options.find((o) => o.value === v)!.target)
        }}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{L('פגישה: ', 'Meeting: ')}{o.label}</option>)}
        <option value="url">{L('הפניה לכתובת', 'Redirect to URL')}</option>
        <option value="message">{L('הודעה', 'Show a message')}</option>
      </select>
      {value.type === 'url' && <input className="input input-sm ltr grow" value={value.url} onChange={(e) => onChange({ type: 'url', url: e.target.value })} />}
      {value.type === 'message' && <input className="input input-sm grow" value={value.text} onChange={(e) => onChange({ type: 'message', text: e.target.value })} />}
    </div>
  )
}

function FormEditor({ form, options, onClose, onSave }: { form: RoutingForm; options: TargetOption[]; onClose: () => void; onSave: (f: RoutingForm) => void }) {
  const { L } = useI18n()
  const [f, setF] = useState<RoutingForm>(form)
  const setField = (i: number, p: Partial<Question>) => setF({ ...f, fields: f.fields.map((q, j) => (j === i ? { ...q, ...p } : q)) })
  const ops: [RoutingCondition['op'], string][] = [
    ['equals', L('שווה ל', 'equals')],
    ['not_equals', L('שונה מ', 'is not')],
    ['contains', L('מכיל', 'contains')],
    ['gt', '>'],
    ['lt', '<'],
  ]
  return (
    <Modal open onClose={onClose} wide>
      <div className="stack" style={{ ['--gap' as string]: '16px' }}>
        <div className="row between">
          <h3>{L('עריכת טופס', 'Edit form')}</h3>
          <button className="icon-btn" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="grid-2">
          <Field label={L('כותרת', 'Title')}><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label={L('כתובת', 'Slug')}><input className="input ltr" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} /></Field>
        </div>
        <Field label={L('תיאור', 'Description')}><textarea className="textarea" style={{ minHeight: 60 }} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>

        <h3>{L('שאלות', 'Questions')}</h3>
        {f.fields.map((q, i) => (
          <div key={q.id} className="q-card">
            <div className="row wrap" style={{ gap: 8 }}>
              <span className="mono tiny muted">{q.id}</span>
              <input className="input input-sm grow" value={q.label} onChange={(e) => setField(i, { label: e.target.value })} />
              <select className="select input-sm" style={{ width: 140 }} value={q.type} onChange={(e) => setField(i, { type: e.target.value as QuestionType })}>
                {QTYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <label className="check small"><input type="checkbox" checked={q.required} onChange={(e) => setField(i, { required: e.target.checked })} /> {L('חובה', 'Required')}</label>
              <button className="icon-btn" onClick={() => setF({ ...f, fields: f.fields.filter((_, j) => j !== i) })}><Icon name="trash" size={14} /></button>
            </div>
            {['select', 'multiselect', 'radio'].includes(q.type) && (
              <textarea className="textarea" style={{ minHeight: 60 }} placeholder={L('אפשרות בכל שורה', 'One option per line')} value={(q.options || []).join('\n')} onChange={(e) => setField(i, { options: e.target.value.split('\n') })} />
            )}
          </div>
        ))}
        <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setF({ ...f, fields: [...f.fields, { id: 'q' + uid(4), type: 'select', label: '', required: true, options: [] }] })}>
          <Icon name="plus" size={14} /> {L('שאלה', 'Question')}
        </button>

        <h3>{L('כללי ניתוב', 'Routing rules')}</h3>
        <p className="tiny muted">{L('הכלל הראשון שמתאים מנצח.', 'The first matching rule wins.')}</p>
        {f.rules.map((r, ri) => (
          <div key={r.id} className="wf-step">
            <div className="row wrap" style={{ gap: 6 }}>
              <b className="small">{L('אם', 'If')}</b>
              <select className="select input-sm" style={{ width: 'auto' }} value={r.match} onChange={(e) => setF({ ...f, rules: f.rules.map((x, j) => (j === ri ? { ...x, match: e.target.value as 'all' | 'any' } : x)) })}>
                <option value="all">{L('כל התנאים', 'all conditions')}</option>
                <option value="any">{L('אחד התנאים', 'any condition')}</option>
              </select>
              <button className="icon-btn" style={{ marginInlineStart: 'auto' }} onClick={() => setF({ ...f, rules: f.rules.filter((_, j) => j !== ri) })}><Icon name="trash" size={14} /></button>
            </div>
            {r.conditions.map((c, ci) => {
              const upd = (p: Partial<RoutingCondition>) => setF({ ...f, rules: f.rules.map((x, j) => (j === ri ? { ...x, conditions: x.conditions.map((y, k) => (k === ci ? { ...y, ...p } : y)) } : x)) })
              const fld = f.fields.find((q) => q.id === c.fieldId)
              return (
                <div key={ci} className="row wrap" style={{ gap: 6 }}>
                  <select className="select input-sm" style={{ width: 'auto' }} value={c.fieldId} onChange={(e) => upd({ fieldId: e.target.value })}>
                    {f.fields.map((q) => <option key={q.id} value={q.id}>{q.label || q.id}</option>)}
                  </select>
                  <select className="select input-sm" style={{ width: 'auto' }} value={c.op} onChange={(e) => upd({ op: e.target.value as RoutingCondition['op'] })}>
                    {ops.map(([o, l]) => <option key={o} value={o}>{l}</option>)}
                  </select>
                  {fld?.options?.length ? (
                    <select className="select input-sm" style={{ width: 'auto' }} value={c.value} onChange={(e) => upd({ value: e.target.value })}>
                      <option value="" />
                      {fld.options.map((o) => <option key={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input className="input input-sm" style={{ width: 160 }} value={c.value} onChange={(e) => upd({ value: e.target.value })} />
                  )}
                </div>
              )
            })}
            <button className="link tiny" style={{ alignSelf: 'flex-start' }} onClick={() => setF({ ...f, rules: f.rules.map((x, j) => (j === ri ? { ...x, conditions: [...x.conditions, { fieldId: f.fields[0]?.id || '', op: 'equals', value: '' }] } : x)) })}>
              + {L('תנאי', 'condition')}
            </button>
            <div className="row wrap" style={{ gap: 6 }}>
              <b className="small">{L('אז', 'Then')}</b>
              <TargetPicker value={r.target} options={options} onChange={(t) => setF({ ...f, rules: f.rules.map((x, j) => (j === ri ? { ...x, target: t } : x)) })} />
            </div>
          </div>
        ))}
        <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setF({ ...f, rules: [...f.rules, { id: uid(6), match: 'all', conditions: [{ fieldId: f.fields[0]?.id || '', op: 'equals', value: '' }], target: options[0]?.target ?? { type: 'message', text: '' } }] })}>
          <Icon name="plus" size={14} /> {L('כלל', 'Rule')}
        </button>
        <Field label={L('אחרת', 'Otherwise')}>
          <TargetPicker value={f.fallback} options={options} onChange={(t) => setF({ ...f, fallback: t })} />
        </Field>
        <p className="tiny muted">{L('ברירת מחדל כרגע: ', 'Current fallback: ')}{describeTarget(f.fallback, (id) => options.find((o) => o.value === 'e:' + id)?.label ?? id)}</p>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-accent" onClick={() => onSave(f)}>{L('שמירה', 'Save')}</button>
          <button className="btn btn-ghost" onClick={onClose}>{L('ביטול', 'Cancel')}</button>
        </div>
      </div>
    </Modal>
  )
}
