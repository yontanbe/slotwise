import { useState } from 'react'
import { useMe } from '../../auth/AuthProvider'
import PageHead from '../../components/PageHead'
import { Field, Icon, Modal, Toggle, useCopy, useToast } from '../../components/ui'
import { useLoad, useStore } from '../../data/StoreProvider'
import { useI18n } from '../../i18n'
import { deliverWebhook } from '../../integrations/sync'
import { functionsUrl } from '../../lib/config'
import { nowISO, uid } from '../../lib/id'
import { appUrl } from '../../lib/links'
import type { ApiKey, Webhook, WebhookEvent } from '../../lib/types'

const EVENTS: WebhookEvent[] = ['booking.created', 'booking.cancelled', 'booking.rescheduled', 'booking.confirmed', 'booking.rejected', 'booking.paid', 'poll.voted', 'routing.submitted']

function randomKey(len: number) {
  const a = new Uint8Array(len)
  crypto.getRandomValues(a)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  return Array.from(a, (x) => chars[x % chars.length]).join('')
}
export async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, '0')).join('')
}

export default function Developer() {
  const me = useMe()
  const store = useStore()
  const copy = useCopy()
  const toast = useToast()
  const { L, fmtDate } = useI18n()
  const data = useLoad(async () => ({
    keys: await store.listKind('api_key', me.id),
    hooks: await store.listKind('webhook', me.id),
    deliveries: (await store.listKind('webhook_delivery', me.id)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20),
    ets: await store.listEventTypes(me.id),
  }), [me.id])
  const [newKey, setNewKey] = useState<string | null>(null)
  const [keyName, setKeyName] = useState('')
  const [hook, setHook] = useState<Webhook | null>(null)
  const fn = functionsUrl()
  const apiBase = fn ? `${fn}/api/v1` : `https://<project>.supabase.co/functions/v1/api/v1`
  const mcpUrl = fn ? `${fn}/mcp` : `https://<project>.supabase.co/functions/v1/mcp`

  const createKey = async () => {
    const key = 'sw_' + randomKey(32)
    const k: ApiKey = { id: uid(), ownerId: me.id, name: keyName || L('מפתח', 'Key'), prefix: key.slice(0, 8), hash: await sha256Hex(key), scopes: ['read', 'write'], createdAt: nowISO() }
    await store.saveKind('api_key', k)
    setNewKey(key)
    setKeyName('')
  }
  const firstEt = data.data?.ets[0]
  const embedUrl = firstEt ? appUrl(`/${me.username}/${firstEt.slug}`) : appUrl(`/${me.username}`)
  const scriptUrl = appUrl('/').split('#')[0] + 'embed.js'

  return (
    <div className="stack" style={{ ['--gap' as string]: '26px' }}>
      <PageHead title={L('מפתחים', 'Developers')} sub={L('API, MCP לסוכני AI, Webhooks והטמעה באתר.', 'API, MCP for AI agents, webhooks and website embeds.')} />

      <section className="settings-sec">
        <div>
          <h3>{L('מפתחות API', 'API keys')}</h3>
          <p className="small muted">{L('לשימוש ב-REST API ובשרת ה-MCP. המפתח מוצג פעם אחת בלבד.', 'For the REST API and the MCP server. Shown once.')}</p>
        </div>
        <div className="card stack" style={{ ['--gap' as string]: '12px' }}>
          {newKey && (
            <div className="stack" style={{ ['--gap' as string]: '6px' }}>
              <div className="key-reveal">{newKey}</div>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn-sm" onClick={() => copy(newKey)}><Icon name="copy" size={14} /> {L('העתקה', 'Copy')}</button>
                <span className="tiny muted">{L('שמרו אותו עכשיו. לא נוכל להציג אותו שוב.', 'Save it now. We cannot show it again.')}</span>
              </div>
            </div>
          )}
          <div className="row" style={{ gap: 8 }}>
            <input className="input input-sm" style={{ maxWidth: 240 }} placeholder={L('שם (למשל Claude)', 'Name (e.g. Claude)')} value={keyName} onChange={(e) => setKeyName(e.target.value)} />
            <button className="btn btn-line btn-sm" onClick={createKey}><Icon name="plus" size={14} /> {L('יצירת מפתח', 'Create key')}</button>
          </div>
          <table className="data">
            <tbody>
              {(data.data?.keys ?? []).map((k) => (
                <tr key={k.id}>
                  <td>{k.name}</td>
                  <td className="mono small ltr">{k.prefix}…</td>
                  <td className="small muted">{k.lastUsedAt ? L('שימוש אחרון ', 'Last used ') + fmtDate(k.lastUsedAt, me.timezone, { day: 'numeric', month: 'short' }) : L('לא בשימוש', 'Never used')}</td>
                  <td style={{ textAlign: 'end' }}><button className="icon-btn" onClick={async () => { if (window.confirm(L('לבטל את המפתח?', 'Revoke this key?'))) await store.deleteKind('api_key', k.id) }}><Icon name="trash" size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {store.mode === 'local' && <p className="tiny muted">{L('ה-API וה-MCP רצים ב-Edge Functions ודורשים Supabase. במצב דמו המפתחות נשמרים רק לניסיון.', 'The API and MCP run on Edge Functions and need Supabase. In demo mode keys are for trying only.')}</p>}
        </div>
      </section>

      <section className="settings-sec">
        <div>
          <h3>MCP</h3>
          <p className="small muted">{L('חברו את Claude, ChatGPT או Cursor ליומן שלכם: זמינות, קביעה, ביטול וסיכומים.', 'Connect Claude, ChatGPT or Cursor: availability, booking, cancel and insights.')}</p>
        </div>
        <div className="card stack" style={{ ['--gap' as string]: '10px' }}>
          <Field label={L('כתובת שרת MCP (Streamable HTTP)', 'MCP server URL (Streamable HTTP)')}>
            <div className="row" style={{ gap: 6 }}>
              <div className="code-block grow">{mcpUrl}</div>
              <button className="icon-btn" onClick={() => copy(mcpUrl)}><Icon name="copy" size={14} /></button>
            </div>
          </Field>
          <p className="tiny muted">{L('אימות: Authorization: Bearer <מפתח API>. כלים: list_event_types, get_availability, create_booking, reschedule_booking, cancel_booking (עם confirm), list_bookings, create_poll, get_insights ועוד.', 'Auth: Authorization: Bearer <API key>. Tools: list_event_types, get_availability, create_booking, reschedule_booking, cancel_booking (needs confirm), list_bookings, create_poll, get_insights and more.')}</p>
          <Field label="REST API">
            <div className="code-block">{`curl -H "Authorization: Bearer sw_..." ${apiBase}/event-types\n# OpenAPI: ${apiBase}/openapi.json`}</div>
          </Field>
        </div>
      </section>

      <section className="settings-sec">
        <div>
          <h3>Webhooks</h3>
          <p className="small muted">{L('חתומים ב-HMAC SHA-256 בכותרת X-Slotwise-Signature.', 'Signed with HMAC SHA-256 in the X-Slotwise-Signature header.')}</p>
        </div>
        <div className="card stack" style={{ ['--gap' as string]: '12px' }}>
          {(data.data?.hooks ?? []).map((h) => (
            <div key={h.id} className="row between wrap" style={{ gap: 8, borderBottom: '1px solid var(--rule)', paddingBottom: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div className="mono small ltr ellipsis">{h.url}</div>
                <div className="tiny muted">{h.events.join(', ')}</div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <Toggle checked={h.active} onChange={(v) => store.saveKind('webhook', { ...h, active: v })} />
                <button className="icon-btn" title={L('בדיקה', 'Test')} onClick={async () => {
                  const r = await deliverWebhook(h.url, h.secret, 'ping', { hello: 'slotwise' })
                  await store.saveKind('webhook_delivery', { id: uid(), ownerId: me.id, webhookId: h.id, event: 'booking.created', status: r.status, code: r.code, attempts: 1, at: nowISO(), payload: { ping: true } })
                  toast(r.status === 'failed' ? L('השליחה נכשלה', 'Delivery failed') : L('נשלח', 'Sent'), r.status === 'failed')
                }}><Icon name="arrow" size={14} /></button>
                <button className="icon-btn" onClick={() => setHook(h)}><Icon name="edit" size={14} /></button>
                <button className="icon-btn" onClick={() => store.deleteKind('webhook', h.id)}><Icon name="trash" size={14} /></button>
              </div>
            </div>
          ))}
          <button className="btn btn-line btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setHook({ id: uid(), ownerId: me.id, url: 'https://', secret: 'whsec_' + randomKey(28), events: ['booking.created', 'booking.cancelled', 'booking.rescheduled'], active: true, createdAt: nowISO() })}>
            <Icon name="plus" size={14} /> {L('Webhook חדש', 'New webhook')}
          </button>
          {(data.data?.deliveries ?? []).length > 0 && (
            <details>
              <summary className="small muted" style={{ cursor: 'pointer' }}>{L('משלוחים אחרונים', 'Recent deliveries')}</summary>
              <table className="data">
                <tbody>
                  {data.data!.deliveries.map((d) => (
                    <tr key={d.id}>
                      <td className="mono tiny">{fmtDate(d.at, me.timezone, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                      <td className="small">{d.event}</td>
                      <td><span className={`stamp ${d.status === 'ok' ? 'ok' : d.status === 'failed' ? 'bad' : 'mute'}`}>{d.status}{d.code ? ' ' + d.code : ''}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
          <p className="tiny muted">{L('מהדפדפן: אם השרת המקבל לא מאפשר CORS, נשלחת גרסה אטומה שבה החתימה בגוף ההודעה. עם Edge Functions השליחה מלאה עם ניסיונות חוזרים.', 'From the browser: if the receiver does not allow CORS, an opaque request carries the signature in the body. With Edge Functions delivery is full, with retries.')}</p>
        </div>
      </section>

      <section className="settings-sec">
        <div>
          <h3>{L('הטמעה באתר', 'Embed on a website')}</h3>
          <p className="small muted">{L('בתוך הדף, חלון קופץ או כפתור צף.', 'Inline, popup or a floating button.')}</p>
        </div>
        <div className="card stack" style={{ ['--gap' as string]: '10px' }}>
          <div className="code-block">{`<div data-slotwise="${embedUrl}"></div>\n<script src="${scriptUrl}" async></script>`}</div>
          <div className="code-block">{`<script src="${scriptUrl}"></script>\n<script>Slotwise.floating("${embedUrl}", { text: "קביעת פגישה" })</script>`}</div>
          <button className="btn btn-line btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => copy(`<div data-slotwise="${embedUrl}"></div>\n<script src="${scriptUrl}" async></script>`)}><Icon name="copy" size={14} /> {L('העתקה', 'Copy')}</button>
        </div>
      </section>

      {hook && (
        <Modal open onClose={() => setHook(null)}>
          <div className="stack" style={{ ['--gap' as string]: '14px' }}>
            <h3>Webhook</h3>
            <Field label="URL"><input className="input ltr" value={hook.url} onChange={(e) => setHook({ ...hook, url: e.target.value })} /></Field>
            <Field label={L('סוד חתימה', 'Signing secret')}>
              <div className="row" style={{ gap: 6 }}><div className="code-block grow">{hook.secret}</div><button className="icon-btn" onClick={() => copy(hook.secret)}><Icon name="copy" size={14} /></button></div>
            </Field>
            <Field label={L('אירועים', 'Events')}>
              <div className="stack" style={{ ['--gap' as string]: '4px' }}>
                {EVENTS.map((ev) => (
                  <label key={ev} className="check small">
                    <input type="checkbox" checked={hook.events.includes(ev)} onChange={(e) => setHook({ ...hook, events: e.target.checked ? [...hook.events, ev] : hook.events.filter((x) => x !== ev) })} />
                    <span className="mono">{ev}</span>
                  </label>
                ))}
              </div>
            </Field>
            <button className="btn btn-accent" onClick={async () => {
              if (!/^https:\/\/[^/]+\.[^/]+/.test(hook.url)) return toast(L('כתובת https תקינה בלבד', 'A valid https URL is required'), true)
              await store.saveKind('webhook', hook)
              setHook(null)
            }}>{L('שמירה', 'Save')}</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
