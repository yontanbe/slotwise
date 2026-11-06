/**
 * Periodic jobs (every 5 minutes via pg_cron + pg_net):
 *  - workflows: run _shared/workflows.ts dueSteps over recent bookings and execute the steps
 *  - auto decline pending bookings older than eventType.autoDeclineHours
 *  - retry failed webhook deliveries (exponential backoff, dead letter after 5 attempts)
 *  - hourly: write Shabbat / holiday busy blocks (source 'shabbat') from _shared/holidays.ts
 *  - hourly: drop idempotency records older than 24h
 */
import { mutate, type Repo } from '../_shared/db.ts'
import { shabbatBlocks } from '../_shared/holidays.ts'
import { sendEmail, sendWhatsApp, type SendResult } from '../_shared/messaging.ts'
import type { Booking, BusyBlock, EventType, IdempotencyEntry, User, Webhook, Workflow } from '../_shared/types.ts'
import { postOutbound, retryDueDeliveries, signatureHeader } from '../_shared/webhooks.ts'
import type { DnsResolver } from '../_shared/ssrf.ts'
import { bookingVars, dueSteps, renderTemplate, stepRecipient, type WfBooking, type WfStep, type WfWorkflow } from '../_shared/workflows.ts'
import { appUrl, newToken, nowISO, uid } from '../_shared/util.ts'

export type CronTask = 'workflows' | 'auto_decline' | 'webhook_retry' | 'shabbat' | 'cleanup'
export const ALL_TASKS: CronTask[] = ['workflows', 'auto_decline', 'webhook_retry', 'shabbat', 'cleanup']

export interface CronDeps {
  repo: Repo
  fetch?: typeof fetch
  now?: () => Date
  /** DNS lookup for the SSRF check on webhook URLs (defaults to Deno.resolveDns when available) */
  resolveDns?: DnsResolver | null
}

/**
 * The owner's own secret for signing workflow webhook steps (profile data.workflowSecret).
 * Generated on first use; the host sees it in their profile and verifies with it.
 */
export async function ownerWorkflowSecret(repo: Repo, ownerId: string): Promise<string> {
  const rec = (await repo.find<User & { workflowSecret?: string }>('profile', { owner: ownerId, limit: 1 }))[0]
  if (!rec) throw new Error('profile not found')
  if (typeof rec.data.workflowSecret === 'string' && rec.data.workflowSecret.length >= 24) return rec.data.workflowSecret
  const fresh = 'wfs_' + newToken() + newToken()
  const out = await mutate<User & { workflowSecret?: string }>(repo, 'profile', rec.id, ownerId, (p) =>
    typeof p.workflowSecret === 'string' && p.workflowSecret.length >= 24 ? p : { ...p, workflowSecret: fresh },
  )
  return out?.workflowSecret ?? fresh
}

const DAY = 86_400_000

function hostOf(u: User) {
  return { name: u.name, email: u.email, phone: u.phone, timezone: u.timezone, locale: u.locale }
}

function isRecent(b: Booking, now: number): boolean {
  const s = Date.parse(b.start)
  if (s > now - 2 * DAY && s < now + 31 * DAY) return true
  if (Date.parse(b.createdAt) > now - 2 * DAY) return true
  return (b.history ?? []).some((h) => Date.parse(h.at) > now - 2 * DAY)
}

async function runStep(deps: CronDeps, ownerId: string, user: User, b: Booking, w: WfWorkflow, step: WfStep): Promise<SendResult | { status: string }> {
  const forHost = step.action === 'email_host' || step.action === 'whatsapp_host'
  const vars = bookingVars(b as unknown as WfBooking, hostOf(user), appUrl(), forHost)
  const to = stepRecipient(step, b as unknown as WfBooking, hostOf(user))
  const subject = renderTemplate(step.subject || w.name, vars)
  const body = renderTemplate(step.body, vars)
  const msg = { repo: deps.repo, fetch: deps.fetch }
  switch (step.action) {
    case 'email_attendee':
    case 'email_host':
    case 'email_custom':
      return await sendEmail(msg, { ownerId, to, subject, body, bookingId: b.id, replyTo: forHost ? undefined : user.email })
    case 'whatsapp_attendee':
      if (!b.attendee.whatsappOptIn) return { status: 'skipped_no_opt_in' }
      return await sendWhatsApp(msg, { ownerId, to, body, bookingId: b.id, bookingToken: b.token, locale: b.attendee.locale })
    case 'whatsapp_host':
      return await sendWhatsApp(msg, { ownerId, to, body, bookingId: b.id, locale: user.locale })
    case 'sms_attendee': {
      // no SMS provider yet: keep a record so the host sees what would have been sent
      const id = uid()
      await deps.repo.insert('outbox', ownerId, id, { id, ownerId, channel: 'sms', to, subject: '', body, bookingId: b.id, status: 'logged', via: 'outbox', at: nowISO() })
      return { status: 'logged' }
    }
    case 'webhook': {
      if (!/^https:\/\//.test(to)) return { status: 'failed_invalid_url' }
      // signed with a secret of this owner: the matching registered webhook's, else profile.workflowSecret
      const hooks = await deps.repo.find<Webhook>('webhook', { owner: ownerId })
      const secret = hooks.find((h) => h.data.url === to)?.data.secret || (await ownerWorkflowSecret(deps.repo, ownerId))
      const { internalNotes: _n, ...booking } = b
      const payload = JSON.stringify({ id: uid(16), event: 'workflow.step', createdAt: nowISO(), data: { workflowId: w.id, stepId: step.id, trigger: w.trigger, subject, body, booking } })
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Slotwise-Event': 'workflow.step',
        'X-Slotwise-Signature': await signatureHeader(secret, payload),
      }
      const out = await postOutbound(deps, to, headers, payload)
      if (!out.error) return { status: 'sent' }
      return { status: out.code ? `failed_http_${out.code}` : `failed: ${out.error}` }
    }
  }
  return { status: 'unknown_action' }
}

export async function runWorkflows(deps: CronDeps) {
  const now = (deps.now?.() ?? new Date()).getTime()
  const nowIso = new Date(now).toISOString()
  const all = await deps.repo.find<Workflow>('workflow')
  const byOwner = new Map<string, WfWorkflow[]>()
  for (const r of all) {
    if (!r.data.active) continue
    const arr = byOwner.get(r.owner_id) ?? []
    arr.push(r.data as unknown as WfWorkflow)
    byOwner.set(r.owner_id, arr)
  }
  let executed = 0
  const errors: string[] = []
  for (const [ownerId, workflows] of byOwner) {
    try {
      const prof = (await deps.repo.find<User>('profile', { owner: ownerId, limit: 1 }))[0]?.data
      // the browser sync runs workflows unless the host moved automation to the server
      if (!prof?.automationOnServer) continue
      const bookings = (await deps.repo.find<Booking>('booking', { owner: ownerId })).map((r) => r.data).filter((b) => isRecent(b, now))
      for (const b of bookings) {
        const due = dueSteps(b as unknown as WfBooking, workflows, nowIso)
        if (!due.length) continue
        // claim first (at most once): a concurrent run will see the keys and skip them
        const keys = due.map((d) => d.key)
        let claimed: string[] = []
        await mutate<Booking>(deps.repo, 'booking', b.id, ownerId, (x) => {
          const done = new Set(x.workflowDone ?? [])
          claimed = keys.filter((k) => !done.has(k))
          if (!claimed.length) return null
          return { ...x, workflowDone: [...done, ...claimed] }
        })
        for (const d of due.filter((x) => claimed.includes(x.key))) {
          const res = await runStep(deps, ownerId, prof, b, d.workflow, d.step)
          executed++
          if (!['sent', 'logged'].includes(res.status) && !res.status.startsWith('skipped')) errors.push(`${b.id} ${d.key}: ${res.status}`)
        }
      }
    } catch (e) {
      errors.push(`${ownerId}: ${(e as Error).message}`)
    }
  }
  return { owners: byOwner.size, executed, errors }
}

export async function autoDecline(deps: CronDeps) {
  const now = (deps.now?.() ?? new Date()).getTime()
  const pending = await deps.repo.find<Booking>('booking', { eq: { 'data->>status': 'pending' } })
  const ets = new Map<string, EventType | null>()
  let declined = 0
  for (const r of pending) {
    const b = r.data
    if (!ets.has(b.eventTypeId)) ets.set(b.eventTypeId, (await deps.repo.get<EventType>('event_type', b.eventTypeId))?.data ?? null)
    const hours = ets.get(b.eventTypeId)?.autoDeclineHours
    if (!hours || hours <= 0) continue
    if (now - Date.parse(b.createdAt) < hours * 3_600_000) continue
    const out = await mutate<Booking>(deps.repo, 'booking', b.id, r.owner_id, (x) => {
      if (x.status !== 'pending') return null
      return {
        ...x,
        status: 'rejected',
        history: [...(x.history ?? []), { at: new Date(now).toISOString(), action: 'rejected', by: 'system', note: `auto-declined: not confirmed within ${hours}h` }],
      }
    })
    if (out) declined++
  }
  return { checked: pending.length, declined }
}

export async function syncShabbatBusy(deps: CronDeps) {
  const now = deps.now?.() ?? new Date()
  const from = new Date(now.getTime() - DAY).toISOString()
  const to = new Date(now.getTime() + 60 * DAY).toISOString()
  const profiles = await deps.repo.find<User>('profile')
  let written = 0
  for (const p of profiles) {
    const s = p.data.shabbat
    if (!s || (!s.enabled && !s.blockHolidays)) continue
    const fresh: BusyBlock[] = shabbatBlocks(s, from, to).map((x) => ({ start: x.start, end: x.end, source: 'shabbat' as BusyBlock['source'] }))
    const id = 'busy-' + p.owner_id
    const rec = await deps.repo.get<{ blocks: BusyBlock[] }>('busy', id, p.owner_id)
    const keep = (rec?.data.blocks ?? []).filter((b) => (b.source as string) !== 'shabbat')
    const next = { blocks: [...keep, ...fresh].sort((a, b) => a.start.localeCompare(b.start)) }
    if (rec && JSON.stringify(rec.data.blocks) === JSON.stringify(next.blocks)) continue
    if (rec) await deps.repo.update(rec, next)
    else await deps.repo.insert('busy', p.owner_id, id, next)
    written++
  }
  return { written }
}

export async function cleanupIdempotency(deps: CronDeps) {
  const cutoff = (deps.now?.() ?? new Date()).getTime() - DAY
  const rows = await deps.repo.find<IdempotencyEntry>('idempotency')
  let removed = 0
  for (const r of rows) {
    if (Date.parse(r.data.createdAt) < cutoff) {
      await deps.repo.remove(r.id)
      removed++
    }
  }
  return { removed }
}

export async function runCron(deps: CronDeps, tasks: CronTask[]) {
  const out: Record<string, unknown> = { at: (deps.now?.() ?? new Date()).toISOString() }
  for (const t of tasks) {
    try {
      if (t === 'workflows') out.workflows = await runWorkflows(deps)
      else if (t === 'auto_decline') out.autoDecline = await autoDecline(deps)
      else if (t === 'webhook_retry') out.webhookRetry = await retryDueDeliveries(deps)
      else if (t === 'shabbat') out.shabbat = await syncShabbatBusy(deps)
      else if (t === 'cleanup') out.cleanup = await cleanupIdempotency(deps)
    } catch (e) {
      console.error(t, e)
      out[t] = { error: (e as Error).message }
    }
  }
  return out
}
