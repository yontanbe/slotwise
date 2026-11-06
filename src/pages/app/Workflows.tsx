import { useState } from 'react'
import { useAuth, useMe } from '../../auth/AuthProvider'
import PageHead from '../../components/PageHead'
import { Empty, Field, Icon, Modal, Toggle, useToast } from '../../components/ui'
import { useLoad, useStore } from '../../data/StoreProvider'
import { useI18n } from '../../i18n'
import { nowISO, uid } from '../../lib/id'
import { whatsappLink } from '../../lib/links'
import type { Workflow, WorkflowAction, WorkflowStep, WorkflowTrigger } from '../../lib/types'
import { TEMPLATE_VARS, WORKFLOW_PRESETS } from '../../../supabase/functions/_shared/workflows'

export default function Workflows() {
  const me = useMe()
  const { refresh } = useAuth()
  const store = useStore()
  const toast = useToast()
  const { L, locale } = useI18n()
  const data = useLoad(async () => ({ wfs: await store.listKind('workflow', me.id), ets: await store.listEventTypes(me.id), outbox: await store.listOutbox(me.id) }), [me.id])
  const [edit, setEdit] = useState<Workflow | null>(null)

  const triggerName: Record<WorkflowTrigger, string> = {
    booked: L('פגישה נקבעה', 'Booking created'),
    requested: L('בקשה ממתינה לאישור', 'Booking requested'),
    confirmed: L('בקשה אושרה', 'Request approved'),
    cancelled: L('פגישה בוטלה', 'Booking cancelled'),
    rescheduled: L('מועד שונה', 'Rescheduled'),
    before_start: L('לפני תחילת הפגישה', 'Before start'),
    after_end: L('אחרי סוף הפגישה', 'After end'),
    no_show: L('סומן לא הגיע', 'Marked no show'),
    paid: L('תשלום התקבל', 'Payment received'),
  }
  const actionName: Record<WorkflowAction, string> = {
    email_attendee: L('מייל למוזמן', 'Email invitee'),
    email_host: L('מייל אליי', 'Email me'),
    email_custom: L('מייל לכתובת', 'Email address'),
    whatsapp_attendee: L('WhatsApp למוזמן', 'WhatsApp invitee'),
    whatsapp_host: L('WhatsApp אליי', 'WhatsApp me'),
    sms_attendee: L('SMS למוזמן', 'SMS invitee'),
    webhook: 'Webhook',
  }

  const create = (presetKey?: string) => {
    const p = WORKFLOW_PRESETS.find((x) => x.key === presetKey)
    const base = p ? (locale === 'he' ? p.he : p.en) : null
    setEdit({
      id: uid(),
      ownerId: me.id,
      active: true,
      eventTypeIds: [],
      createdAt: nowISO(),
      name: base?.name ?? L('תהליך חדש', 'New workflow'),
      trigger: base?.trigger ?? 'booked',
      offsetMins: base?.offsetMins ?? 0,
      steps: base ? base.steps.map((s) => ({ ...s, id: uid(6) })) : [{ id: uid(6), action: 'email_attendee', subject: '', body: '' }],
    })
  }
  const wfs = data.data?.wfs ?? []
  const pendingWa = (data.data?.outbox ?? []).filter((m) => m.channel === 'whatsapp' && m.status === 'logged').slice(0, 8)

  return (
    <div className="stack" style={{ ['--gap' as string]: '24px' }}>
      <PageHead
        title={L('תהליכים אוטומטיים', 'Workflows')}
        sub={L('תזכורות, מעקב ועדכונים שיוצאים לבד לפי טריגר.', 'Reminders, follow ups and updates that go out on their own.')}
        actions={<button className="btn btn-accent" onClick={() => create()}><Icon name="plus" size={15} /> {L('תהליך חדש', 'New workflow')}</button>}
      />
      <div className="row wrap" style={{ gap: 8 }}>
        <span className="small muted">{L('תבניות:', 'Templates:')}</span>
        {WORKFLOW_PRESETS.map((p) => (
          <button key={p.key} className="chip" style={{ cursor: 'pointer' }} onClick={() => create(p.key)}>
            + {locale === 'he' ? p.he.name : p.en.name}
          </button>
        ))}
      </div>
      <div className="notice small">
        <Icon name="plug" />
        <div className="grow">
          {me.automationOnServer
            ? L('התהליכים רצים בשרת (Edge Functions) גם כשהדפדפן סגור.', 'Workflows run on the server (Edge Functions), even with the browser closed.')
            : L('בלי שרת, התהליכים רצים כשהדשבורד פתוח. הודעות WhatsApp ממתינות כאן לשליחה בלחיצה.', 'Without a server, workflows run while the dashboard is open. WhatsApp messages wait below for a one tap send.')}
        </div>
        {store.mode === 'supabase' && (
          <label className="row" style={{ gap: 8 }}>
            <Toggle label={L('הרצה בשרת', 'Run on server')} checked={!!me.automationOnServer} onChange={async (v) => { await store.saveUser({ ...me, automationOnServer: v }); refresh() }} />
            <span className="tiny">{L('הרצה בשרת', 'Run on server')}</span>
          </label>
        )}
      </div>

      {wfs.length === 0 ? (
        <Empty title={L('אין עדיין תהליכים', 'No workflows yet')} text={L('התחילו מתבנית: תזכורת 24 שעות ב-WhatsApp היא המועילה ביותר.', 'Start from a template: a 24h WhatsApp reminder helps the most.')} />
      ) : (
        <div className="timetable">
          {wfs.map((w) => (
            <div key={w.id} className="tt-row">
              <div className="tt-time">
                <b>{w.trigger === 'before_start' || w.trigger === 'after_end' ? fmtOffset(w.offsetMins, L) : '⚡'}</b>
                <span className="tiny">{triggerName[w.trigger]}</span>
              </div>
              <button className="link" style={{ textDecoration: 'none', textAlign: 'start' }} onClick={() => setEdit(w)}>
                <h3 style={{ fontSize: 20 }}>{w.name}</h3>
                <div className="tiny muted">{w.steps.map((s) => actionName[s.action]).join(' → ')} · {w.eventTypeIds.length ? w.eventTypeIds.length + L(' סוגי פגישות', ' event types') : L('כל סוגי הפגישות', 'All event types')}</div>
              </button>
              <div className="row" style={{ gap: 8 }}>
                <Toggle label={w.name} checked={w.active} onChange={(v) => store.saveKind('workflow', { ...w, active: v })} />
                <button className="icon-btn" onClick={async () => { if (window.confirm(L('למחוק?', 'Delete?'))) await store.deleteKind('workflow', w.id) }} aria-label={L('מחיקה', 'Delete')}><Icon name="trash" size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {pendingWa.length > 0 && (
        <section>
          <h3 style={{ marginBottom: 8 }}>{L('ממתינות לשליחה ב-WhatsApp', 'Waiting to send on WhatsApp')}</h3>
          <ul className="list-plain outbox">
            {pendingWa.map((m) => (
              <li key={m.id}>
                <span className="dot logged" />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="small ellipsis">{m.body}</div>
                  <div className="tiny muted ltr">{m.to}</div>
                </div>
                <a
                  className="btn btn-line btn-sm"
                  href={whatsappLink(m.to, m.body)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => store.addOutbox({ ...m, status: 'sent' })}
                >
                  <Icon name="whatsapp" size={14} /> {L('שליחה', 'Send')}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {edit && (
        <WorkflowEditor
          wf={edit}
          ets={data.data?.ets ?? []}
          triggerName={triggerName}
          actionName={actionName}
          onClose={() => setEdit(null)}
          onSave={async (w) => {
            if (!w.steps.length) return toast(L('צריך לפחות צעד אחד', 'Add at least one step'), true)
            await store.saveKind('workflow', w)
            setEdit(null)
            toast(L('נשמר', 'Saved'))
          }}
        />
      )}
    </div>
  )
}

function fmtOffset(m: number, L: (a: string, b: string) => string) {
  if (m % 1440 === 0) return `${m / 1440}${L(' ימ׳', 'd')}`
  if (m % 60 === 0) return `${m / 60}${L(' שע׳', 'h')}`
  return `${m}${L(' דק׳', 'm')}`
}

function WorkflowEditor({
  wf,
  ets,
  triggerName,
  actionName,
  onClose,
  onSave,
}: {
  wf: Workflow
  ets: { id: string; title: string }[]
  triggerName: Record<WorkflowTrigger, string>
  actionName: Record<WorkflowAction, string>
  onClose: () => void
  onSave: (w: Workflow) => void
}) {
  const { L } = useI18n()
  const [w, setW] = useState<Workflow>(wf)
  const [focus, setFocus] = useState<{ i: number; field: 'subject' | 'body' } | null>(null)
  const timed = w.trigger === 'before_start' || w.trigger === 'after_end'
  const setStep = (i: number, p: Partial<WorkflowStep>) => setW({ ...w, steps: w.steps.map((s, j) => (j === i ? { ...s, ...p } : s)) })
  const insertVar = (v: string) => {
    if (!focus) return
    const s = w.steps[focus.i]
    setStep(focus.i, { [focus.field]: (s[focus.field] || '') + `{${v}}` })
  }
  return (
    <Modal open onClose={onClose} wide>
      <div className="stack" style={{ ['--gap' as string]: '16px' }}>
        <div className="row between">
          <h3>{L('עריכת תהליך', 'Edit workflow')}</h3>
          <button className="icon-btn" onClick={onClose} aria-label={L('הסרה', 'Remove')}><Icon name="x" /></button>
        </div>
        <Field label={L('שם', 'Name')}>
          <input className="input" value={w.name} onChange={(e) => setW({ ...w, name: e.target.value })} />
        </Field>
        <div className="grid-2">
          <Field label={L('מתי', 'When')}>
            <select className="select" value={w.trigger} onChange={(e) => setW({ ...w, trigger: e.target.value as WorkflowTrigger, offsetMins: e.target.value === 'before_start' ? 1440 : e.target.value === 'after_end' ? 60 : 0 })}>
              {(Object.keys(triggerName) as WorkflowTrigger[]).map((t) => (
                <option key={t} value={t}>{triggerName[t]}</option>
              ))}
            </select>
          </Field>
          {timed && (
            <Field label={L('כמה זמן', 'How long')}>
              <select className="select" value={w.offsetMins} onChange={(e) => setW({ ...w, offsetMins: Number(e.target.value) })}>
                {[15, 30, 60, 120, 180, 360, 720, 1440, 2880, 4320, 10080].map((m) => (
                  <option key={m} value={m}>{fmtOffset(m, L)}</option>
                ))}
              </select>
            </Field>
          )}
        </div>
        <Field label={L('סוגי פגישות', 'Event types')} hint={L('בלי בחירה = כולם', 'None selected = all')}>
          <div className="row wrap" style={{ gap: 6 }}>
            {ets.map((e) => {
              const on = w.eventTypeIds.includes(e.id)
              return (
                <button key={e.id} type="button" className={`chip${on ? ' ink' : ''}`} style={{ cursor: 'pointer' }} onClick={() => setW({ ...w, eventTypeIds: on ? w.eventTypeIds.filter((x) => x !== e.id) : [...w.eventTypeIds, e.id] })}>
                  {e.title}
                </button>
              )
            })}
          </div>
        </Field>
        <div className="stack" style={{ ['--gap' as string]: '14px' }}>
          {w.steps.map((s, i) => (
            <div key={s.id} className="wf-step">
              <div className="row wrap" style={{ gap: 8 }}>
                <span className="mono tiny muted">{String(i + 1).padStart(2, '0')}</span>
                <select className="select input-sm" style={{ width: 200 }} value={s.action} onChange={(e) => setStep(i, { action: e.target.value as WorkflowAction })}>
                  {(Object.keys(actionName) as WorkflowAction[]).map((a) => (
                    <option key={a} value={a}>{actionName[a]}</option>
                  ))}
                </select>
                {(s.action === 'email_custom' || s.action === 'webhook') && (
                  <input className="input input-sm ltr grow" placeholder={s.action === 'webhook' ? 'https://' : 'team@company.com'} value={s.to || ''} onChange={(e) => setStep(i, { to: e.target.value })} />
                )}
                <button className="icon-btn" style={{ marginInlineStart: 'auto' }} onClick={() => setW({ ...w, steps: w.steps.filter((_, j) => j !== i) })} aria-label={L('מחיקה', 'Delete')}><Icon name="trash" size={14} /></button>
              </div>
              {s.action.startsWith('email') && (
                <input className="input input-sm" placeholder={L('נושא', 'Subject')} value={s.subject} onFocus={() => setFocus({ i, field: 'subject' })} onChange={(e) => setStep(i, { subject: e.target.value })} />
              )}
              {s.action !== 'webhook' && (
                <textarea className="textarea" placeholder={L('תוכן ההודעה', 'Message')} value={s.body} onFocus={() => setFocus({ i, field: 'body' })} onChange={(e) => setStep(i, { body: e.target.value })} />
              )}
            </div>
          ))}
          <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setW({ ...w, steps: [...w.steps, { id: uid(6), action: 'email_attendee', subject: '', body: '' }] })}>
            <Icon name="plus" size={14} /> {L('צעד נוסף', 'Add step')}
          </button>
        </div>
        <div>
          <div className="tiny muted" style={{ marginBottom: 6 }}>{L('משתנים (לחיצה מוסיפה לשדה הפעיל):', 'Variables (click to insert in the focused field):')}</div>
          <div className="var-chips">
            {TEMPLATE_VARS.map((v) => (
              <button key={v} type="button" onClick={() => insertVar(v)}>{`{${v}}`}</button>
            ))}
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-accent" onClick={() => onSave(w)}>{L('שמירה', 'Save')}</button>
          <button className="btn btn-ghost" onClick={onClose}>{L('ביטול', 'Cancel')}</button>
        </div>
      </div>
    </Modal>
  )
}
