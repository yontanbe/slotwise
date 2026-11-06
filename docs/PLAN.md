# Slotwise build plan

This is the working plan for the first runnable version. The product spec stays in the root README.

## Goal of v0.1

A version that runs entirely from GitHub Pages, with a clean seam for the real backend later.

- Static SPA: Vite + React + TypeScript, HashRouter (works on any Pages path, no 404 tricks).
- Two data modes behind one interface (`src/data/store.ts`):
  - Demo: localStorage, seeded data, works with zero setup.
  - Supabase: Postgres + Auth + RLS + security definer RPCs (`supabase/schema.sql`). Switch by setting keys at build time or at runtime in Settings.
- Real Google Calendar from the browser (Google Identity Services token client): FreeBusy, create event with Meet link, delete on cancel, Gmail send.

## Login (designed now, enforced later)

`src/auth/` exposes one `AuthApi`:

| Method | Demo mode | Supabase mode |
| --- | --- | --- |
| enterDemo | one click, seeded host | hidden |
| signInWithPassword / signUp | any email works, local account | Supabase email + password |
| signInWithMagicLink | instant local login | Supabase OTP email |
| signInWithGoogle / Microsoft | local login with a note | Supabase OAuth (google, azure) |
| signOut | clears session | Supabase signOut |

Routes under `/app` and `/onboarding` sit behind `RequireAuth`. Flip to production by providing Supabase keys; the bypass button disappears automatically. Planned later: TOTP 2FA (Supabase MFA), SSO.

## Static limitations and how v0.1 handles them

| Need | Without a server | Later with a server |
| --- | --- | --- |
| Invitee sees host's Google busy times | Host's browser syncs busy blocks into the store when the dashboard is open | Server side sync with watch channels |
| Create Google event + Meet on booking | Created immediately when booking happens in host's browser, otherwise picked up by the sync queue next time the host opens the dashboard | Worker on booking insert |
| Emails | Gmail API from host's browser when connected, otherwise outbox log in the dashboard | Worker + Resend fallback |
| WhatsApp | Click to chat links with prefilled text (wa.me) | Meta Cloud API templates with buttons |
| Race on the same slot | Local: check then write. Supabase: advisory lock + overlap check inside RPC | same |

## Scope status (v0.2)

Built and covered by tests:

- P0: profile, onboarding, event types, multiple schedules with date overrides, availability engine, booking page (month, week, timezones), booking form, confirmation with ICS and calendar links, cancel and reschedule by link, bookings list with search across every field, manual booking with override, Hebrew RTL and English, dark mode.
- P1: custom questions with conditions, URL prefill and UTM, redirect after booking, requires confirmation with auto decline, limits per day, week, month and minutes, first slot only, seats, recurring series, single use links, personalized links, meeting polls with private voters, preferred hours, Shabbat and holidays by city, out of office with redirect, travel timezones, reconfirmation, per invitee limits, workflows (email, WhatsApp, webhook steps), routing forms with rules, teams with round robin (priority and weight) and collective, dynamic group links (alice+bob), webhooks with HMAC, API keys, REST API and MCP server (Edge Functions), Stripe payments (Payment Link or Checkout), invitee calendar overlay, embeds (inline, popup, floating), 2FA (Supabase MFA), PWA.
- Server (Supabase Edge Functions): api, mcp, cron (workflows, auto decline, webhook retries, Shabbat blocks), webhooks, whatsapp (Cloud API, button replies, STOP), stripe. See docs/SERVER.md.

Not built yet: Outlook and CalDAV, Zoom OAuth, organizations and SSO, CRM routing and enrichment, form concierge, focus time and smart meetings, service business mode (resources, packages), Israeli payment processors, AI features, native apps, Gmail add on, Reserve with Google, MCP OAuth 2.1.

## Tests

| Suite | Command | What it covers |
| --- | --- | --- |
| Unit | `npm test` | availability engine (DST, offsets, limits, seats, travel), Shabbat and holiday classification, workflow engine, routing rules, sync helpers |
| SQL | `npm run test:sql` | schema and every public RPC against Postgres (PGlite): rules, allow-listed fields, series, teams, polls, privileges |
| Edge Functions | `cd supabase/functions && deno test --allow-env tests/` | API routing and auth, MCP protocol, webhook and Stripe signatures, service layer |
| End to end | `npm run test:e2e` | 30 browser flows, desktop and mobile |

## Design direction

References in `design/refs` (generated with Gemini). Printed timetable on cream paper: ink navy, vermilion accent, sage secondary, Frank Ruhl Libre for display, IBM Plex Sans Hebrew for UI, IBM Plex Mono for times. Time slots are ticket stubs, lists are timetable rows with hairline rules, event types are index cards with a colored tab. Riso illustrations in `public/illustrations`.

## Code map

```
src/lib/availability.ts   pure slot engine (tested)
src/lib/holidays.ts       Shabbat / chag blocks via @hebcal/core
src/lib/ics.ts, links.ts  ICS, add to calendar, WhatsApp links
src/data/                 store interface, local + supabase implementations, seed
src/auth/                 AuthApi, providers, RequireAuth
src/integrations/google.ts GIS token client, Calendar, Gmail
src/integrations/sync.ts  busy pull + pending event push + email send
src/pages/public/         profile, booker, manage booking, poll vote
src/pages/app/            dashboard screens
```

## Deploy

GitHub Actions workflow `.github/workflows/deploy.yml` builds and publishes to Pages on push to main. Optional repo variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_GOOGLE_CLIENT_ID`.
