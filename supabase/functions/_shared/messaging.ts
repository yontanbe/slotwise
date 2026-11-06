/**
 * Outbound email (Resend) and WhatsApp (Meta Cloud API). Every attempt is written to the
 * owner's outbox as a delivery log. Without provider secrets the message is only logged.
 */
import type { Repo } from './db.ts'
import type { OutboxMessage } from './types.ts'
import { env, normalizePhone, nowISO, safeEmail, uid } from './util.ts'

export interface MessagingDeps {
  repo: Repo
  fetch?: typeof fetch
}

export interface SendResult {
  status: 'sent' | 'logged' | 'failed'
  provider: 'resend' | 'whatsapp_cloud' | 'none'
  outboxId: string
  error?: string
  providerId?: string
}

const GRAPH = 'https://graph.facebook.com/v21.0'

async function log(deps: MessagingDeps, m: Omit<OutboxMessage, 'id' | 'at' | 'via'> & Record<string, unknown>): Promise<string> {
  const id = uid()
  const rec = { ...m, id, via: 'outbox' as const, at: nowISO() }
  try {
    await deps.repo.insert('outbox', m.ownerId, id, rec)
  } catch (e) {
    console.error('outbox write failed', e)
  }
  return id
}

export async function sendEmail(
  deps: MessagingDeps,
  m: { ownerId: string; to: string; subject: string; body: string; bookingId?: string; replyTo?: string },
): Promise<SendResult> {
  const key = env('RESEND_API_KEY')
  const from = env('RESEND_FROM')
  const to = safeEmail(m.to)
  if (!to) {
    const outboxId = await log(deps, { ...m, channel: 'email', status: 'failed', error: 'missing or invalid recipient' })
    return { status: 'failed', provider: 'none', outboxId, error: 'missing or invalid recipient' }
  }
  const replyTo = safeEmail(m.replyTo)
  // subjects end up in a header on the provider side: no CR/LF
  const subject = m.subject.replace(/[\r\n]+/g, ' ').slice(0, 250)
  if (!key || !from) {
    const outboxId = await log(deps, { ...m, channel: 'email', status: 'logged' })
    return { status: 'logged', provider: 'none', outboxId }
  }
  const f = deps.fetch ?? fetch
  try {
    const res = await f('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text: m.body, ...(replyTo ? { reply_to: replyTo } : {}) }),
      signal: AbortSignal.timeout(10_000),
    })
    const out = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`resend ${res.status}: ${JSON.stringify(out).slice(0, 300)}`)
    const outboxId = await log(deps, { ...m, channel: 'email', status: 'sent', provider: 'resend', providerId: out.id })
    return { status: 'sent', provider: 'resend', outboxId, providerId: out.id }
  } catch (e) {
    const error = String((e as Error).message ?? e)
    const outboxId = await log(deps, { ...m, channel: 'email', status: 'failed', provider: 'resend', error })
    return { status: 'failed', provider: 'resend', outboxId, error }
  }
}

/** Template body parameters may not contain newlines, tabs or 4+ consecutive spaces. */
export function templateParam(text: string): string {
  return text.replace(/[\t\r]/g, ' ').replace(/\n+/g, ' · ').replace(/ {4,}/g, '   ').slice(0, 1000)
}

export function whatsappTemplatePayload(
  to: string,
  body: string,
  opts: { template: string; locale: 'he' | 'en'; bookingToken?: string; withButtons?: boolean },
) {
  const components: unknown[] = [{ type: 'body', parameters: [{ type: 'text', text: templateParam(body) }] }]
  if (opts.withButtons && opts.bookingToken) {
    ;['confirm', 'reschedule', 'cancel'].forEach((action, index) =>
      components.push({
        type: 'button',
        sub_type: 'quick_reply',
        index: String(index),
        parameters: [{ type: 'payload', payload: `${action}:${opts.bookingToken}` }],
      }),
    )
  }
  return {
    messaging_product: 'whatsapp',
    to: normalizePhone(to),
    type: 'template',
    template: { name: opts.template, language: { code: opts.locale === 'he' ? 'he' : 'en' }, components },
  }
}

/**
 * Business-initiated WhatsApp message. The 24h customer service window is not knowable
 * server side, so this always uses an approved template (WHATSAPP_TEMPLATE_REMINDER)
 * whose single body variable receives the rendered text.
 */
export async function sendWhatsApp(
  deps: MessagingDeps,
  m: { ownerId: string; to: string; body: string; bookingId?: string; bookingToken?: string; locale?: 'he' | 'en'; template?: string },
): Promise<SendResult> {
  const token = env('WHATSAPP_TOKEN')
  const phoneId = env('WHATSAPP_PHONE_NUMBER_ID')
  const template = m.template || env('WHATSAPP_TEMPLATE_REMINDER')
  const base = { ownerId: m.ownerId, to: m.to, subject: '', body: m.body, bookingId: m.bookingId, channel: 'whatsapp' as const }
  if (!normalizePhone(m.to)) {
    const outboxId = await log(deps, { ...base, status: 'failed', error: 'no phone number' })
    return { status: 'failed', provider: 'none', outboxId, error: 'no phone number' }
  }
  if (!token || !phoneId || !template) {
    const outboxId = await log(deps, { ...base, status: 'logged' })
    return { status: 'logged', provider: 'none', outboxId }
  }
  const payload = whatsappTemplatePayload(m.to, m.body, {
    template,
    locale: m.locale ?? 'he',
    bookingToken: m.bookingToken,
    withButtons: env('WHATSAPP_TEMPLATE_HAS_BUTTONS') === 'true',
  })
  const f = deps.fetch ?? fetch
  try {
    const res = await f(`${GRAPH}/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    })
    const out = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`whatsapp ${res.status}: ${JSON.stringify(out).slice(0, 300)}`)
    const providerId = out?.messages?.[0]?.id
    const outboxId = await log(deps, { ...base, status: 'sent', provider: 'whatsapp_cloud', providerId })
    return { status: 'sent', provider: 'whatsapp_cloud', outboxId, providerId }
  } catch (e) {
    const error = String((e as Error).message ?? e)
    const outboxId = await log(deps, { ...base, status: 'failed', provider: 'whatsapp_cloud', error })
    return { status: 'failed', provider: 'whatsapp_cloud', outboxId, error }
  }
}

/** Free-form reply. Only valid inside the 24h window, i.e. right after the user wrote to us. */
export async function replyWhatsAppText(to: string, text: string, f: typeof fetch = fetch): Promise<boolean> {
  const token = env('WHATSAPP_TOKEN')
  const phoneId = env('WHATSAPP_PHONE_NUMBER_ID')
  if (!token || !phoneId) {
    console.log('[whatsapp reply, not sent: no credentials]', to, text)
    return false
  }
  const res = await f(`${GRAPH}/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: normalizePhone(to), type: 'text', text: { body: text } }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) console.error('whatsapp reply failed', res.status, await res.text().catch(() => ''))
  return res.ok
}
