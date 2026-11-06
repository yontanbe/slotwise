# Slotwise server (Supabase Edge Functions)

The static app keeps working without any of this. These functions add the REST API, the MCP server, server side workflows and webhooks, WhatsApp Cloud API and Stripe Checkout. All code is under `supabase/functions/`; database additions are in `supabase/migrations/002_server.sql`.

| Function | Purpose | Auth |
| --- | --- | --- |
| `api` | REST API v1 (`/api/v1/...`, OpenAPI at `/api/v1/openapi.json`) | `Authorization: Bearer sw_...` API key |
| `mcp` | Remote MCP server, Streamable HTTP (POST, JSON responses, no SSE) | same API key |
| `cron` | workflows, auto decline, webhook retries, Shabbat busy blocks, idempotency cleanup | service role key (pg_cron) |
| `webhooks` | outgoing signed webhooks, called by a Database Webhook on `records` | `x-slotwise-db-secret` or service role key |
| `whatsapp` | Meta webhook (verify + inbound buttons / STOP), internal `POST /whatsapp/send` | Meta signature / service role key |
| `stripe` | `POST /stripe/checkout`, `POST /stripe/webhook` | public / Stripe signature |

Shared code: `_shared/service.ts` (service layer used by api and mcp), `db.ts` (Repo over `records`), `webhooks.ts`, `messaging.ts` (Resend, WhatsApp), `stripe.ts`, plus the browser-shared `availability.ts`, `holidays.ts`, `workflows.ts`.

## 1. Database

Shortcut: `bash scripts/setup-supabase.sh` does sections 1 to 3 (`supabase db push` applies `migrations/001_schema.sql` and `002_server.sql`), see [DEPLOY.md](DEPLOY.md). By hand:

1. Run `supabase/schema.sql` (if not already).
2. Edit `supabase/migrations/002_server.sql`: replace `<PROJECT_REF>`. Store the service role key in Vault once:
   ```sql
   select vault.create_secret('<SERVICE_ROLE_KEY>', 'slotwise_service_role_key');
   ```
3. Run `002_server.sql`. It adds indexes, enables `pg_cron` + `pg_net` and schedules `slotwise-cron` every 5 minutes. It is idempotent and does not touch anything defined in `schema.sql`. While `<PROJECT_REF>` is still in the file the job is skipped with a NOTICE.

## 2. Secrets

```sh
supabase secrets set APP_URL=https://slotwise.pages.dev/ \
  DB_WEBHOOK_SECRET=$(openssl rand -hex 24) \
  RESEND_API_KEY=re_... RESEND_FROM="Slotwise <noreply@yourdomain>" \
  WHATSAPP_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=... WHATSAPP_APP_SECRET=... WHATSAPP_VERIFY_TOKEN=$(openssl rand -hex 16) \
  WHATSAPP_TEMPLATE_REMINDER=slotwise_reminder WHATSAPP_TEMPLATE_HAS_BUTTONS=true \
  STRIPE_SECRET_KEY=sk_live_... STRIPE_WEBHOOK_SECRET=whsec_...
```

| Secret | Needed by | Without it |
| --- | --- | --- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | all (set by Supabase automatically) | functions fail |
| `APP_URL` | links in messages, Stripe return URLs | `http://localhost:5173/` |
| `DB_WEBHOOK_SECRET` | webhooks, cron, whatsapp `/send` (alternative to service key) | only the service role key is accepted |
| `RESEND_API_KEY`, `RESEND_FROM` | email steps and reminders | written to outbox with status `logged` |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_REMINDER` | WhatsApp sends | written to outbox with status `logged` |
| `WHATSAPP_TEMPLATE_HAS_BUTTONS` | adds quick reply payloads `confirm:/reschedule:/cancel:<token>` (template must have 3 quick reply buttons in that order) | no buttons |
| `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | inbound webhook | inbound rejected |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | payments | checkout / webhook return an error |
| `API_RATE_LIMIT_PER_MIN` | api and mcp (per key) | 120 |

WhatsApp business-initiated messages always use the approved template named by `WHATSAPP_TEMPLATE_REMINDER` with one body variable (`{{1}}`) that receives the rendered text, because the 24h window is not knowable server side. Free text is only used to reply to an inbound message.

## 3. Deploy

```sh
supabase functions deploy api --no-verify-jwt
supabase functions deploy mcp --no-verify-jwt
supabase functions deploy cron --no-verify-jwt
supabase functions deploy webhooks --no-verify-jwt
supabase functions deploy whatsapp --no-verify-jwt
supabase functions deploy stripe --no-verify-jwt
```

`--no-verify-jwt` is used everywhere because none of the callers send a Supabase JWT: API and MCP use `sw_` keys, Meta and Stripe sign their own requests, and the internal callers are checked against the service role key or `DB_WEBHOOK_SECRET` inside the function.

## 4. Wiring

- **Database Webhook** (Dashboard > Database > Webhooks > Create): table `public.records`, events Insert + Update, type Supabase Edge Function `webhooks`, method POST, header `x-slotwise-db-secret: <DB_WEBHOOK_SECRET>`. It fires for every row; the function only acts on `booking`, `poll` and `routing_form`. A filtered trigger alternative is commented at the end of `002_server.sql`.
- **Automation switch**: booking webhooks and workflows run on the server only for hosts whose profile has `automationOnServer: true`; otherwise the host's browser sync keeps doing them. Both sides claim booking events in `booking.webhooksSent` and steps in `booking.workflowDone`, so flipping the switch does not double send. Poll and routing events are always server side.
- **Cron**: `select * from cron.job_run_details order by start_time desc limit 20;`. Manual run: `curl -X POST -H "Authorization: Bearer $SERVICE_ROLE_KEY" "https://<ref>.supabase.co/functions/v1/cron?tasks=workflows,auto_decline,webhook_retry"`.
- **Meta** (App > WhatsApp > Configuration): callback `https://<ref>.supabase.co/functions/v1/whatsapp`, verify token `WHATSAPP_VERIFY_TOKEN`, subscribe to `messages`.
- **Stripe** (Developers > Webhooks): endpoint `https://<ref>.supabase.co/functions/v1/stripe/webhook`, events `checkout.session.completed` and `checkout.session.async_payment_succeeded`. The booking page starts a payment with `POST https://<ref>.supabase.co/functions/v1/stripe/checkout {"token":"<booking token>"}` and redirects to the returned `url`. Return URLs: `${APP_URL}#/b/<token>?paid=1` (success) and `?paid=0` (cancel).

## 5. REST API

Create a key in the app (Settings > Developer). The record stores `sha256(key)` and scopes `read` / `write`.

```sh
BASE=https://<ref>.supabase.co/functions/v1/api/v1
curl -H "Authorization: Bearer sw_..." $BASE/event-types
curl -H "Authorization: Bearer sw_..." "$BASE/availability?eventTypeId=<id>&from=2026-11-10&to=2026-11-14&timezone=Asia/Jerusalem"
curl -X POST -H "Authorization: Bearer sw_..." -H "Idempotency-Key: $(uuidgen)" -H "Content-Type: application/json" \
  -d '{"eventTypeId":"<id>","start":"2026-11-10T07:00:00.000Z","attendee":{"name":"Dana","email":"dana@example.com"}}' $BASE/bookings
curl -X POST -H "Authorization: Bearer sw_..." -d '{"confirm":true,"reason":"sick"}' $BASE/bookings/<id>/cancel
```

Routes: `GET /me`, `GET /event-types`, `GET /event-types/:id`, `GET /availability`, `POST /availability/overrides`, `GET /bookings?status=&from=&to=&q=`, `GET /bookings/:id`, `POST /bookings`, `POST /bookings/:id/cancel`, `POST /bookings/:id/reschedule`, `POST /bookings/:id/reminders`, `POST /links`, `POST /polls`, `GET /insights`, `GET /openapi.json` (public). Errors are `{"error":{"code","message"}}`. Every write appends an `audit` record `{at, actor, client, action, target}`.

Booking creation checks the slot against `computeSlots` (hours, notice, window, limits, Shabbat) and then calls `public_create_booking`, which takes the per-host advisory lock and re-checks conflicts and rules. Retries with the same `Idempotency-Key` return the first booking (`Idempotent-Replayed: true`); a different body with the same key is a 422.

Rate limit: 120 requests per minute per key, in memory per isolate (sliding window). Edge Functions run several isolates, so the real limit is per instance; move it to Postgres or Redis if it must be strict.

## 6. MCP (Claude and other clients)

URL: `https://<ref>.supabase.co/functions/v1/mcp`. In Claude: Settings > Connectors > Add custom connector, paste the URL and add the header `Authorization: Bearer sw_...` (clients that cannot set headers need the OAuth step below). Protocol `2025-06-18` (also accepts `2025-03-26`, `2024-11-05`), JSON responses, batches, `GET` returns 405 (no SSE stream).

Tools: `list_event_types`, `get_event_type`, `get_availability`, `create_booking` (requires `idempotency_key`), `reschedule_booking`, `cancel_booking` and `update_availability` (both require `confirm: true`, otherwise a tool error asks for confirmation), `list_bookings`, `get_booking`, `create_single_use_link`, `create_poll`, `get_insights`, `send_reminder`. Resources `slotwise://agenda`, `slotwise://event-types`; prompts `plan_my_week`, `find_time_with`, `prepare_next_meeting`. Audit entries use actor `mcp` and the `clientInfo.name/version` from `initialize` (kept per `Mcp-Session-Id`, and encoded in the id so a cold isolate still knows it).

Next step: OAuth 2.1 (authorization server metadata, dynamic client registration, PKCE, per tool scopes) so users connect without pasting a key.

## 7. Security model

**RLS on `records`.** Hosts `select` all of their own rows (plus bookings that list them in `coHostIds`). `insert` / `update` / `delete` of their own rows is allowed only for client kinds: `profile, event_type, schedule, booking, poll, link, busy, outbox, workflow, routing_form, personal_link, team, team_member, webhook, api_key`. `webhook_delivery`, `audit` and `idempotency` are server only (service role, which bypasses RLS). `outbox` stays host writable (the static app logs there) but a row is capped at 16 KB. Invitees never touch rows: they use the `public_*` security definer RPCs.

**`records_guard` trigger** (BEFORE INSERT OR UPDATE, security definer). It checks writes made by the PostgREST roles `anon` / `authenticated` directly on the table; the service role and the `public_*` RPCs (which mark their transaction with `slotwise.rpc = on`) are not checked. Rules: `data.id`, when present, equals the row `id`, and `data.ownerId`, when present, equals `owner_id`; booking `coHostIds` must pass the team rule below; `attendee.whatsappOptIn` cannot be turned on by a host write (only the invitee opts in, through `public_create_booking`); `team_member` rows must be `id = teamId:userId` owned by `userId`.

**Team consent.** A user may host an event type when they own it, or when the event type has `teamId`, lists them in `hosts`, the team record lists them and the event type owner as accepted members, and they wrote their own consent record:

```json
{ "id": "<teamId>:<userId>", "owner_id": "<userId>", "kind": "team_member", "data": { "teamId": "<teamId>", "userId": "<userId>", "accepted": true } }
```

This applies to the booking owner (round robin) and to every co-host. `coHostIds` are kept only on `schedulingType: 'collective'` team event types; for dynamic group links (no `teamId`) the server drops co-hosts, so those bookings belong to the first host only. Deleting the consent record (or setting `accepted: false`) withdraws it; later bookings and reschedules ignore that member.

**Public data.** `public_profile` lists visible event types only. Hidden types come back only through `public_event_type(p_username, p_slug)` (by slug, or the event type of the personal link with that slug), `public_link` (the link's type) and `public_routing_form` (types the form routes to), always without `price.paymentLink`. Schedules expose `id, name, timezone, weekly, overrides[{date, ranges}]` only. Host `email` / `phone` are returned as `''` unless the profile sets `showContact: true`.

**Limits.** API and MCP: 120 requests / minute per key (each JSON-RPC request in a batch counts), MCP batches at most 20 messages and run sequentially. Reminders (`send_reminder`, `POST /bookings/:id/reminders`): custom text at most 500 characters and 50 reminders per owner per 24h (counted from audit). Bookings created through the API or MCP always have `attendee.whatsappOptIn: false`. Routing responses: at most 8 KB, only answers keyed by the form's field ids are stored.

**Outbound requests.** Webhook and workflow webhook URLs must be `https`, not localhost / `*.local` / `*.internal` / single label hosts, and not a private, loopback, link-local, CGNAT or metadata address, as a literal or (when `Deno.resolveDns` is available) after resolving. Redirects are not followed, and delivery logs keep only `blocked destination`, `network error` or `HTTP <code>`. DNS rebinding between the check and the connection is not fully excluded.

**Signing.** Webhooks are signed with their own secret. Workflow `webhook` steps whose URL is not a registered webhook are signed with the owner's `profile.workflowSecret`, generated by the server on first use (keep it when saving the profile).

**Stripe.** Checkout uses the booking row id and token in metadata and stores `payment.checkout {sessionId, amountMinor, currency}` on the booking. The webhook marks a booking paid only when `metadata.booking_token` matches, the session id is the stored one, the currency matches and `amount_total` is at least the stored amount; otherwise it answers 200 with `ignored: <reason>` and logs it.

Upgrading an existing project: run `schema.sql` again (idempotent; it drops the old `records_owner` policy and the 2 argument `_profile_bundle`).

## 8. Tests

```sh
cd supabase/functions
deno check api/index.ts mcp/index.ts cron/index.ts webhooks/index.ts whatsapp/index.ts stripe/index.ts
deno test --allow-env tests/
```

`npm run test:sql` runs `schema.sql` in PGlite and checks the RPCs, RLS and the trigger as the `anon` / `authenticated` roles.

Tests use an in-memory Repo and a fake service, so they need no network or database (only the npm/jsr module cache).

## 9. Not tested yet (honest list)

- Nothing has been deployed. No call has gone through PostgREST: the supabase-js query building in `_shared/db.ts` (json path filters `data->>x`, `contains` on `data->coHostIds`, the `updated_at` compare-and-swap, paging) is only type checked.
- The RPC payloads were run against `schema.sql` in a local Postgres 16 (create, conflict, busy, reschedule, reconfirm, cancel), but not through the network. RLS and the records_guard trigger are checked in PGlite as the anon / authenticated roles (`npm run test:sql`), not against a real Supabase PostgREST.
- Resend, Meta Graph API and Stripe calls were never made against the real services; payload shapes follow their docs. The WhatsApp template must exist and be approved with one body variable (and 3 quick reply buttons if `WHATSAPP_TEMPLATE_HAS_BUTTONS=true`).
- pg_cron, pg_net and Vault were stubbed locally; the real `cron.schedule` / `net.http_post` behaviour is untested.
- Not tested with a real MCP client (Claude, MCP Inspector).
- `luxon` has no bundled types, so code using it is effectively untyped under `deno check`.
- Scale: list, insights and cron load all of an owner's bookings (cron scans all workflow owners, pending bookings and profiles) and filter in memory. Fine for small accounts; needs SQL side filtering later.
- Host bookings made through the API/MCP follow the event type rules (`requiresConfirmation` makes them pending) because they go through `public_create_booking`; the history entry is then rewritten to `created_by_host`.
- SMS steps are only logged to the outbox (no SMS provider).
