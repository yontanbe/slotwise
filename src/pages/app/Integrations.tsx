import { useState } from 'react'
import { useAuth, useMe } from '../../auth/AuthProvider'
import PageHead from '../../components/PageHead'
import { Field, Icon, Toggle, useToast } from '../../components/ui'
import { useLoad, useStore } from '../../data/StoreProvider'
import { useI18n } from '../../i18n'
import { connectGoogle, disconnectGoogle, getUserEmail, hasScope, isGoogleConnected, listCalendars, SCOPES, type GCalendar } from '../../integrations/google'
import { runSync, type SyncReport } from '../../integrations/sync'
import { getConfig, setConfig } from '../../lib/config'
import { BackendModal } from '../Login'

export default function Integrations() {
  const me = useMe()
  const { mode, refresh } = useAuth()
  const store = useStore()
  const toast = useToast()
  const { L, fmtDate, fmtTime } = useI18n()
  const [clientId, setClientId] = useState(getConfig().googleClientId)
  const [connected, setConnected] = useState(isGoogleConnected())
  const [cals, setCals] = useState<GCalendar[]>([])
  const [report, setReport] = useState<SyncReport | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [backend, setBackend] = useState(false)
  const outbox = useLoad(() => store.listOutbox(me.id), [me.id])
  const g = me.google ?? { conflictCalendars: ['primary'], destinationCalendar: 'primary', sendWithGmail: true }

  const saveG = async (patch: Partial<typeof g>) => {
    await store.saveUser({ ...me, google: { ...g, ...patch } })
    await refresh()
  }

  const connect = async () => {
    try {
      if (clientId !== getConfig().googleClientId) setConfig({ googleClientId: clientId.trim() })
      await connectGoogle(true)
      setConnected(true)
      const [email, list] = await Promise.all([getUserEmail().catch(() => ''), listCalendars().catch(() => [])])
      setCals(list)
      await saveG({ email, conflictCalendars: g.conflictCalendars?.length ? g.conflictCalendars : ['primary'] })
      toast(L('Google מחובר', 'Google connected'))
    } catch (e) {
      const m = String((e as Error).message)
      toast(m === 'missing_client_id' ? L('חסר Client ID', 'Missing Client ID') : m, true)
    }
  }
  const loadCals = async () => setCals(await listCalendars().catch(() => []))
  const syncNow = async () => {
    setSyncing(true)
    const r = await runSync(store, me, { pullBusy: true })
    setReport(r)
    setSyncing(false)
  }

  const origin = window.location.origin

  return (
    <div className="stack" style={{ ['--gap' as string]: '26px' }}>
      <PageHead title={L('חיבורים', 'Integrations')} sub={L('יומנים, שליחת הודעות וחיבור לשרת.', 'Calendars, messaging and backend.')} />

      <section className="card stack integ" style={{ ['--gap' as string]: '16px' }}>
        <div className="row between">
          <div className="row" style={{ gap: 12 }}>
            <span className="integ-logo">G</span>
            <div>
              <h3>Google Calendar · Meet · Gmail</h3>
              <p className="small muted">{L('בדיקת התנגשויות, יצירת אירוע עם קישור Meet ושליחה מה-Gmail שלך.', 'Conflict checks, events with Meet links, and email from your Gmail.')}</p>
            </div>
          </div>
          {connected ? <span className="stamp ok">{L('מחובר', 'Connected')}</span> : <span className="stamp mute">{L('לא מחובר', 'Not connected')}</span>}
        </div>

        {!connected && (
          <>
            <Field label="OAuth Client ID" hint={<>{L('ב-Google Cloud: Credentials > OAuth client ID > Web. הוסיפו ל-Authorized JavaScript origins את', 'In Google Cloud: Credentials > OAuth client ID > Web. Add to Authorized JavaScript origins:')} <span className="mono ltr">{origin}</span>. {L('הפעילו Calendar API ו-Gmail API.', 'Enable Calendar API and Gmail API.')}</>}>
              <input className="input ltr" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="xxxx.apps.googleusercontent.com" />
            </Field>
            <button className="btn btn-accent" style={{ alignSelf: 'flex-start' }} onClick={connect} disabled={!clientId}>
              <Icon name="calendar" size={16} /> {L('חיבור Google', 'Connect Google')}
            </button>
          </>
        )}

        {connected && (
          <>
            <div className="row wrap" style={{ gap: 8 }}>
              {g.email && <span className="chip ltr">{g.email}</span>}
              {g.lastSyncAt && <span className="chip">{L('סנכרון אחרון', 'Last sync')} {fmtDate(g.lastSyncAt, me.timezone, { day: 'numeric', month: 'short' })} {fmtTime(g.lastSyncAt, me.timezone)}</span>}
              <button className="btn btn-line btn-sm" onClick={syncNow} disabled={syncing}><Icon name="refresh" size={14} /> {syncing ? L('מסנכרן…', 'Syncing…') : L('סנכרון עכשיו', 'Sync now')}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => { disconnectGoogle(); setConnected(false) }}>{L('ניתוק', 'Disconnect')}</button>
            </div>
            {report && (
              <div className="notice small">
                <div>
                  {L('נוצרו', 'Created')} {report.eventsCreated} · {L('נמחקו', 'Deleted')} {report.eventsDeleted} · {L('מיילים', 'Emails')} {report.emailed} · {L('בלוקים תפוסים', 'Busy blocks')} {report.busyBlocks ?? '—'}
                  {report.errors.length > 0 && <div style={{ color: 'var(--danger)' }}>{report.errors.slice(0, 3).join(' · ')}</div>}
                </div>
              </div>
            )}
            <div className="grid-2">
              <div className="stack" style={{ ['--gap' as string]: '8px' }}>
                <div className="row between">
                  <b>{L('יומנים לבדיקת התנגשויות', 'Calendars checked for conflicts')}</b>
                  <button className="link small" onClick={loadCals}>{L('טעינה', 'Load')}</button>
                </div>
                {(cals.length ? cals : [{ id: 'primary', summary: L('יומן ראשי', 'Primary'), accessRole: 'owner' }]).map((c) => (
                  <label key={c.id} className="check small">
                    <input type="checkbox" checked={g.conflictCalendars.includes(c.id) || (c.primary && g.conflictCalendars.includes('primary'))} onChange={(e) => saveG({ conflictCalendars: e.target.checked ? [...g.conflictCalendars, c.id] : g.conflictCalendars.filter((x) => x !== c.id && !(c.primary && x === 'primary')) })} />
                    <span className="dot" style={{ color: c.backgroundColor || 'var(--accent)' }} /> {c.summary}
                  </label>
                ))}
              </div>
              <div className="stack" style={{ ['--gap' as string]: '12px' }}>
                <Field label={L('יומן יעד לפגישות חדשות', 'Destination calendar')}>
                  <select className="select" value={g.destinationCalendar} onChange={(e) => saveG({ destinationCalendar: e.target.value })}>
                    <option value="primary">{L('יומן ראשי', 'Primary')}</option>
                    {cals.filter((c) => c.accessRole === 'owner' || c.accessRole === 'writer').filter((c) => !c.primary).map((c) => <option key={c.id} value={c.id}>{c.summary}</option>)}
                  </select>
                </Field>
                <label className="row" style={{ gap: 10 }}>
                  <Toggle checked={g.sendWithGmail} onChange={(v) => saveG({ sendWithGmail: v })} />
                  <span className="small">{L('לשלוח אישורים מה-Gmail שלי', 'Send confirmations from my Gmail')}{!hasScope(SCOPES.gmailSend) && <span className="muted"> · {L('דורש התחברות מחדש', 'requires reconnect')}</span>}</span>
                </label>
              </div>
            </div>
          </>
        )}
        <p className="tiny muted">
          {L(
            'בלי שרת, הסנכרון רץ בדפדפן שלך כשהדשבורד פתוח: מושך זמנים תפוסים, יוצר אירועים לפגישות חדשות ושולח מיילים. האסימון של Google נשמר רק בלשונית הזו ופג אחרי שעה.',
            'Without a server, sync runs in your browser while the dashboard is open: pulls busy times, creates events for new bookings and sends emails. The Google token lives in this tab only and expires after an hour.',
          )}
        </p>
      </section>

      <section className="card stack integ" style={{ ['--gap' as string]: '12px' }}>
        <div className="row between">
          <div className="row" style={{ gap: 12 }}>
            <span className="integ-logo wa"><Icon name="whatsapp" /></span>
            <div>
              <h3>WhatsApp</h3>
              <p className="small muted">{L('כרגע: שליחה בלחיצה (click to chat) עם הודעה מוכנה מכל פגישה. בהמשך: Cloud API עם תבניות, כפתורי אישור וקביעה בתוך הצ׳אט.', 'Now: one tap click-to-chat with a prefilled message from any booking. Next: Cloud API templates, confirm buttons and in-chat booking.')}</p>
            </div>
          </div>
          <span className="stamp ok">{L('פעיל', 'Active')}</span>
        </div>
      </section>

      <section className="card stack integ" style={{ ['--gap' as string]: '12px' }}>
        <div className="row between">
          <div className="row" style={{ gap: 12 }}>
            <span className="integ-logo sb">S</span>
            <div>
              <h3>{L('שרת נתונים (Supabase)', 'Backend (Supabase)')}</h3>
              <p className="small muted">{mode === 'demo' ? L('מצב דמו: הנתונים בדפדפן הזה. חברו Supabase כדי שמוזמנים מכל מכשיר יוכלו להזמין.', 'Demo mode: data lives in this browser. Connect Supabase so invitees on any device can book.') : L('מחובר. ההתחברות והנתונים עוברים דרך Supabase.', 'Connected. Auth and data go through Supabase.')}</p>
            </div>
          </div>
          <button className="btn btn-line btn-sm" onClick={() => setBackend(true)}>{L('הגדרה', 'Configure')}</button>
        </div>
      </section>

      <section>
        <h3 style={{ marginBottom: 10 }}>{L('בדרך', 'Coming next')}</h3>
        <div className="soon-grid">
          {[
            ['MCP', L('Slotwise לסוכני AI: זמינות, קביעה וביטול מכל לקוח MCP', 'Slotwise for AI agents: availability, booking and cancel from any MCP client')],
            ['Outlook / Teams', L('יומני Microsoft 365 וקישורי Teams', 'Microsoft 365 calendars and Teams links')],
            ['Zoom', L('יצירת פגישת Zoom אוטומטית', 'Auto created Zoom meetings')],
            ['Stripe · Bit', L('תשלום ומקדמה בזמן ההזמנה', 'Payments and deposits at booking')],
            ['Webhooks · API', L('Webhooks חתומים ו-REST API', 'Signed webhooks and a REST API')],
            [L('צוותים', 'Teams'), L('Round robin, collective וטפסי ניתוב', 'Round robin, collective and routing forms')],
          ].map(([t, d]) => (
            <div key={t} className="soon">
              <b>{t}</b>
              <p className="tiny muted">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 style={{ marginBottom: 10 }}>{L('דואר יוצא', 'Outbox')}</h3>
        <table className="data">
          <thead>
            <tr>
              <th>{L('נושא', 'Subject')}</th>
              <th>{L('אל', 'To')}</th>
              <th>{L('דרך', 'Via')}</th>
              <th>{L('מתי', 'When')}</th>
            </tr>
          </thead>
          <tbody>
            {(outbox.data ?? []).slice(0, 30).map((m) => (
              <tr key={m.id}>
                <td>
                  <details>
                    <summary style={{ cursor: 'pointer' }}>{m.subject}</summary>
                    <pre className="mail-body">{m.body}</pre>
                  </details>
                </td>
                <td className="ltr small">{m.to}</td>
                <td><span className={`stamp ${m.status === 'sent' ? 'ok' : m.status === 'failed' ? 'bad' : 'mute'}`}>{m.via === 'gmail' ? 'Gmail' : L('יומן', 'Log')}</span></td>
                <td className="small mono">{fmtTime(m.at, me.timezone)}</td>
              </tr>
            ))}
            {(outbox.data ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="muted small">{L('ריק', 'Empty')}</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
      <BackendModal open={backend} onClose={() => setBackend(false)} />
    </div>
  )
}
