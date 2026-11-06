# Slotwise build plan (static first)

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

## Scope v0.1

P0: profile page, onboarding wizard, event types (durations, locations, buffers, notice, window, interval, hidden), multiple schedules with weekly ranges and date overrides on a month view, availability engine, booking page (month + list, week view, timezone detect and picker), booking form, confirmation with ICS and add to Google / Outlook, cancel and reschedule without login, bookings list with search across every field, manual booking with override, RTL Hebrew + English, dark / light.

P1 that fits static: custom questions (all types, required, simple conditions), URL prefill + UTM capture, redirect after booking, requires confirmation, limits per day / week and duration per day, first slot only, seats, single use links, meeting polls, ranked (preferred) hours, Shabbat and holidays auto block by city with Hebrew date, no show and internal notes, booking history, week calendar view, contacts, insights, data export / import, week start, 12h / 24h, PWA manifest.

Deferred until there is a server: teams, round robin, collective, routing forms, workflows, webhooks, payments, REST API, MCP server, WhatsApp Cloud API, 2FA.

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
