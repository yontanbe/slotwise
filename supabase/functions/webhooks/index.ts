// Outgoing webhook dispatcher. Invoked by a Supabase Database Webhook on public.records INSERT/UPDATE.
// Deploy: supabase functions deploy webhooks --no-verify-jwt   (authenticated by DB_WEBHOOK_SECRET or the service role key)
import { serviceRepo, type Repo } from '../_shared/db.ts'
import { authorizedInternal, errorResponse, json, preflight } from '../_shared/http.ts'
import type { User } from '../_shared/types.ts'
import { claimBookingEvents, type DbWebhookPayload, deriveEvents, dispatchEvent } from '../_shared/webhooks.ts'

export function createWebhooksHandler(deps: { repo: () => Repo; fetch?: typeof fetch; authorize?: (req: Request) => boolean }) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return preflight()
    if (req.method !== 'POST') return errorResponse('method_not_allowed', 'POST only')
    if (!(deps.authorize ?? authorizedInternal)(req)) return errorResponse('unauthorized', 'not allowed')
    let payload: DbWebhookPayload
    try {
      payload = await req.json()
    } catch {
      return errorResponse('invalid_request', 'body must be JSON')
    }
    if (payload.table && payload.table !== 'records') return json({ ignored: true, reason: 'table' })
    let events = deriveEvents(payload)
    if (!events.length) return json({ events: [] })
    const repo = deps.repo()
    const bookingEvents = events.filter((e) => e.bookingId)
    if (bookingEvents.length) {
      // Booking webhooks belong to the server only when the host switched automation to the server;
      // otherwise the host's browser sync delivers them (src/integrations/sync.ts).
      const ownerId = bookingEvents[0].ownerId
      const prof = (await repo.find<User>('profile', { owner: ownerId, limit: 1 }))[0]?.data
      let won: string[] = []
      if (prof?.automationOnServer) won = await claimBookingEvents(repo, ownerId, bookingEvents[0].bookingId!, bookingEvents.map((e) => e.event))
      events = events.filter((e) => !e.bookingId || won.includes(e.event))
    }
    const results = []
    for (const ev of events) {
      const deliveries = await dispatchEvent({ repo, fetch: deps.fetch }, ev)
      results.push({ event: ev.event, deliveries: deliveries.map((d) => ({ id: d.id, status: d.status, code: d.code })) })
    }
    return json({ events: results })
  }
}

if (import.meta.main) {
  let repo: Repo | null = null
  Deno.serve(createWebhooksHandler({ repo: () => (repo ??= serviceRepo()) }))
}
