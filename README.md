# Zmanly

Zman (זמן) means time in Hebrew. Zmanly is a complete scheduling platform that matches every capability of Calendly and Cal.com, with first class Google Calendar and Gmail integration, built for Hebrew (RTL) and English from day one.

Status: planning. This README is the product spec. No code yet.

---

## 1. Vision

- One link that ends the back and forth of scheduling.
- Full parity with Calendly and Cal.com: every event type, routing, workflows, payments, teams, analytics, API.
- Deep Google stack: Google Calendar two way sync, Google Meet auto links, sending from the host's own Gmail, Gmail side panel for sharing times.
- AI native: natural language scheduling, meeting prep briefs, notes and follow ups.
- Own the data: self hostable, exportable, API first.

## 2. Feature parity map

Legend: P0 = MVP, P1 = v1, P2 = growth, P3 = enterprise / later.

### 2.1 Accounts and profile

- [ ] P0 Sign up / login: Google OAuth, Microsoft OAuth, email magic link, email + password
- [ ] P0 Onboarding wizard: username, timezone, connect calendar, set working hours, create first event type
- [ ] P0 Public profile page (zmanly.app/username) with avatar, bio, list of public event types
- [ ] P0 Username change with redirects from old slug
- [ ] P1 Two factor auth (TOTP), backup codes
- [ ] P1 Account deletion and full data export (GDPR)
- [ ] P1 Profile languages: Hebrew, English, more via i18n files
- [ ] P1 Week start day, 12h / 24h format, date format preferences
- [ ] P2 Personal branding: logo, brand color, hide Zmanly branding (paid)
- [ ] P2 Custom domain for booking pages (book.mydomain.com), automatic SSL

### 2.2 Event types

- [ ] P0 One on one
- [ ] P0 Multiple duration options per event (15 / 30 / 60, invitee picks)
- [ ] P0 Title, slug, description (rich text, links), color, hidden / secret events
- [ ] P0 Locations: Google Meet, Zoom, Microsoft Teams, phone (host calls / invitee calls), in person address, custom link, let invitee choose from several
- [ ] P1 Group events (one host, many invitees, seat limit)
- [ ] P1 Seated events: show remaining seats, show / hide other attendees
- [ ] P1 Collective (all selected hosts must be free)
- [ ] P1 Round robin: equal distribution, priority, weights, maximize availability, reassign
- [ ] P1 Managed event types: admin defines template, locked and unlocked fields, pushed to members
- [ ] P1 Recurring events (weekly / monthly series, N occurrences)
- [ ] P1 One off meetings / single use links
- [ ] P1 Meeting polls (propose several slots, invitees vote)
- [ ] P1 Dynamic group links (zmanly.app/alice+bob)
- [ ] P2 Instant meetings (book now, host notified in real time)
- [ ] P2 Duplicate, archive, reorder event types, event type search
- [ ] P2 Event type specific availability schedule
- [ ] P2 Private links with expiry, password protected events

### 2.3 Availability engine

- [ ] P0 Weekly working hours, multiple ranges per day
- [ ] P0 Multiple named schedules (Work, Evenings, Summer)
- [ ] P0 Date overrides (special hours, day off)
- [ ] P0 Buffer before / after events
- [ ] P0 Minimum notice (e.g. not within next 4 hours)
- [ ] P0 Booking window: rolling N days, or fixed date range
- [ ] P0 Slot interval / start time increments (every 15 / 30 / 60 min)
- [ ] P0 Conflict check across all connected calendars
- [ ] P1 Limits: max bookings per day / week / month / year per event and globally
- [ ] P1 Limit total booked duration per day / week
- [ ] P1 Only show first slot of each day option
- [ ] P1 Lock timezone on booking page (for in person events)
- [ ] P1 Out of office with redirect to a teammate
- [ ] P1 Travel schedule (timezone changes on given dates)
- [ ] P1 Public holidays per country (Israel holidays included), auto block option
- [ ] P2 Treat tentative / free events as busy or free (per calendar setting)
- [ ] P2 Ignore all day events option
- [ ] P2 Per invitee booking limits (one booking per email per period)

### 2.4 Booking page (invitee experience)

- [ ] P0 Month view + time list, week view, column view
- [ ] P0 Auto detect invitee timezone, manual timezone picker
- [ ] P0 Booking form: name, email, notes, add guests
- [ ] P0 Confirmation page + email with ICS, add to Google / Outlook / Apple calendar buttons
- [ ] P0 Cancel and reschedule links (no login), cancellation reason, reschedule reason
- [ ] P0 Fully responsive, mobile first, RTL for Hebrew
- [ ] P0 Dark / light theme
- [ ] P1 Custom booking questions: short text, long text, number, email, phone (with country picker), select, multi select, radio, checkbox, boolean, URL, address, file upload
- [ ] P1 Required / optional fields, conditional questions
- [ ] P1 Hidden fields and URL prefill (name, email, any field), UTM capture
- [ ] P1 Redirect to external URL after booking, passing booking data
- [ ] P1 Requires confirmation: host approves or declines, auto decline after X hours
- [ ] P1 Invitee reconfirmation before the meeting
- [ ] P1 Spam protection: Turnstile / reCAPTCHA, blocked emails and domains, rate limiting
- [ ] P2 Embeds: inline, popup on click, floating button, all with theme and prefill params, embed events (postMessage)
- [ ] P2 Accessibility WCAG 2.2 AA
- [ ] P2 Booking page SEO, Open Graph image per event

### 2.5 Google Calendar integration (core, must be perfect)

- [ ] P0 OAuth with incremental scopes, encrypted refresh tokens, auto refresh, reconnect flow when revoked
- [ ] P0 Connect multiple Google accounts, pick which calendars to check for conflicts
- [ ] P0 Choose destination calendar for new bookings (per event type)
- [ ] P0 FreeBusy queries for availability with caching
- [ ] P0 Create / update / delete events on book, reschedule, cancel
- [ ] P0 Google Meet link auto created via conferenceData
- [ ] P0 Invitees and guests added as attendees, invitation emails via Google optional
- [ ] P1 Push notifications (watch channels) + incremental sync tokens, channel renewal job
- [ ] P1 Two way sync: event deleted or moved in Google updates the booking in Zmanly
- [ ] P1 Recurring event expansion, declined events ignored, private events shown as busy
- [ ] P1 Respect quotas: batching, exponential backoff
- [ ] P2 Google Workspace domain wide delegation for org admins
- [ ] P2 Working location and out of office events from Google read into availability

### 2.6 Gmail integration

- [ ] P0 Send all booking emails from the host's own Gmail (Gmail API send scope) with fallback to platform email
- [ ] P1 Reply threading: confirmation, reminder, reschedule land in the same thread
- [ ] P1 Gmail side panel / Workspace add on: insert booking link, insert specific available times as clickable slots into an email draft
- [ ] P1 Nudge: follow up email if a link was sent and nobody booked
- [ ] P2 Detect scheduling intent in incoming emails and suggest times (AI)
- [ ] P2 Chrome extension for Gmail and LinkedIn: share links and times anywhere

### 2.7 Other calendars and conferencing

- [ ] P1 Microsoft Outlook / Office 365 (Graph API), Teams meeting links
- [ ] P1 Apple iCloud (CalDAV with app specific password), generic CalDAV
- [ ] P1 Zoom (OAuth, auto meeting creation)
- [ ] P2 Webex, Whereby, Jitsi, built in video (WebRTC) as Zmanly Video
- [ ] P2 ICS feed subscription (read only busy calendars)

### 2.8 Notifications and workflows

- [ ] P0 Emails: booked, rescheduled, cancelled, to host and invitee, localized, timezone correct
- [ ] P0 Reminder email before meeting (configurable)
- [ ] P1 Workflow builder: trigger, timing, action, template
  - Triggers: booked, before start, after end, cancelled, rescheduled, no show, booking requested, payment received, routing form submitted
  - Actions: email to host / attendee / custom address, SMS, WhatsApp, webhook, Slack message
- [ ] P1 Template variables ({invitee_name}, {event_time}, {location}, {cancel_url} ...)
- [ ] P1 SMS via Twilio, WhatsApp via WhatsApp Business API, sender ID per country
- [ ] P1 Follow up email after meeting (thank you, feedback form, next booking link)
- [ ] P2 Workflow analytics (sent, delivered, opened, clicked)

### 2.9 Payments

- [ ] P1 Stripe: charge on booking, multiple currencies (ILS, USD, EUR), tax
- [ ] P1 Deposits, hold card and charge no show fee
- [ ] P1 Refund policy on cancel (full / partial / none by time window)
- [ ] P2 PayPal, local Israeli processors (e.g. Tranzila / Cardcom / Grow), invoices and receipts
- [ ] P2 Packages and memberships (buy 5 sessions)

### 2.10 Routing forms (lead qualification)

- [ ] P1 Form builder with conditional logic
- [ ] P1 Route to: event type, specific person, team round robin, external URL, custom message
- [ ] P1 Route by user attributes (region, language, seniority)
- [ ] P2 CRM owner routing: if lead exists in HubSpot / Salesforce, book with the account owner
- [ ] P2 Enrichment on submit (company size etc.) and disqualify rules
- [ ] P2 Routing analytics and test mode

### 2.11 Teams and organizations

- [ ] P1 Teams with roles: owner, admin, member
- [ ] P1 Team public page and team event types
- [ ] P1 Invite by email / link, pending invites
- [ ] P2 Organizations with subdomain (acme.zmanly.app), sub teams
- [ ] P2 Book on behalf of a teammate, delegated admin, assistants
- [ ] P2 Admin can view and manage members' bookings and event types
- [ ] P3 SSO (SAML, OIDC), SCIM provisioning, directory sync
- [ ] P3 Audit logs, data retention policies, impersonation with audit trail

### 2.12 Bookings management (host side)

- [ ] P0 Bookings list: upcoming, unconfirmed, past, cancelled, with filters and search
- [ ] P0 Booking details: answers, location, history, cancel, reschedule, request reschedule
- [ ] P1 Mark no show (host or invitee), add internal notes
- [ ] P1 Calendar view of all bookings inside the app
- [ ] P1 Contacts list built from invitees, booking history per contact
- [ ] P2 Bulk actions, CSV export

### 2.13 Insights and analytics

- [ ] P1 Bookings created, completed, cancelled, rescheduled, no show rate
- [ ] P1 Popular days and hours, per event type, per team member
- [ ] P2 Round robin distribution fairness report
- [ ] P2 Routing form funnel, conversion from link view to booking
- [ ] P2 Export to CSV and Google Sheets

### 2.14 Integrations and developer platform

- [ ] P1 Webhooks: all booking events, signed payloads (HMAC), retries with backoff, delivery log
- [ ] P1 REST API v1 with API keys, OpenAPI spec, rate limits
- [ ] P1 Zapier, Make, n8n apps
- [ ] P2 OAuth apps for third parties
- [ ] P2 MCP server so Claude and other agents can read availability and book
- [ ] P2 Embeddable React components (booker, availability editor)
- [ ] P2 CRMs: HubSpot, Salesforce, Pipedrive (create / update contact, log meeting)
- [ ] P2 Slack app: notifications, /zmanly share link
- [ ] P2 Google Analytics / Meta Pixel tracking on booking pages
- [ ] P3 App store architecture: each integration is a plugin with its own config

### 2.15 AI features

- [ ] P2 AI scheduling assistant: book, move, cancel with natural language (chat, WhatsApp, email)
- [ ] P2 Smart slot suggestions based on host habits and focus time protection
- [ ] P2 Pre meeting brief: who is the invitee, company, previous meetings, form answers
- [ ] P2 Notetaker: record (with consent), transcript, summary, action items
- [ ] P2 AI drafted follow up email after meeting, sent via Gmail on approval
- [ ] P3 AI phone agent that books meetings by voice

### 2.16 Apps and surfaces

- [ ] P1 PWA installable app
- [ ] P2 Native iOS / Android apps (Expo)
- [ ] P2 Browser extension
- [ ] P2 Mobile push notifications

## 3. Edge cases checklist (the small things that break schedulers)

- DST transitions in both host and invitee timezones, including Israel's DST dates
- Invitee and host on different calendar dates (slots crossing midnight)
- Double booking race: two invitees click the same slot at the same moment (DB level lock / unique constraint + idempotency key)
- Calendar connection revoked or token expired while bookings exist: alert host, fall back gracefully
- Event deleted directly in Google Calendar: mark booking cancelled and notify invitee (configurable)
- Overlapping busy times from several calendars and accounts
- All day events, multi day events, tentative and declined events
- Seats: last seat taken during checkout, waitlist
- Reschedule with payment: keep or move the charge
- Reschedule of a recurring series: one occurrence vs all
- Host changes timezone after events were booked
- Minimum notice measured in host timezone vs invitee timezone
- Email bounces and invalid phone numbers for SMS
- Webhook receivers that are down: retries, dead letter queue
- Duplicate submissions from double clicks and slow networks
- Booking links shared with prefilled data that no longer matches the form
- Locale formatting: Hebrew dates, RTL mixed with English names and URLs
- Google API quota limits during peak hours
- Leap years, 30 minute and 45 minute offset timezones (India, Nepal)

## 4. Proposed architecture (to be confirmed)

- Frontend: Next.js (App Router) + TypeScript + Tailwind + shadcn/ui, next-intl for i18n and RTL
- Backend: Next.js route handlers / tRPC, separate worker service for jobs
- Database: Postgres (Supabase or Cloud SQL), Prisma or Drizzle ORM
- Queue and scheduler: BullMQ + Redis, or Google Cloud Tasks, for reminders, sync and webhooks
- Auth: Auth.js or Supabase Auth, OAuth for Google and Microsoft
- Email: Gmail API (host mailbox) + Resend fallback
- SMS / WhatsApp: Twilio
- Payments: Stripe
- Hosting: Vercel for web, Cloud Run for workers, or full GCP
- Observability: Sentry, structured logs, uptime checks
- Testing: Vitest for the availability engine (heavy unit tests on timezone math), Playwright for booking flows

### Core data model (draft)

User, Account (OAuth), CalendarConnection, SelectedCalendar, DestinationCalendar, Schedule, AvailabilityRule, DateOverride, EventType, EventTypeHost, BookingQuestion, Booking, Attendee, BookingSeat, Payment, Workflow, WorkflowStep, ScheduledNotification, RoutingForm, RoutingRule, Team, Membership, Organization, Webhook, WebhookDelivery, ApiKey, AuditLog, Contact.

## 5. Roadmap

1. Phase 0: repo setup, CI, design system, auth, DB schema
2. Phase 1 (MVP): profile, one on one events, availability engine, Google Calendar + Meet, Gmail sending, booking page, cancel / reschedule, reminders
3. Phase 2: custom questions, workflows, Stripe, group / seated / recurring events, Outlook + Zoom, embeds, webhooks and API
4. Phase 3: teams, round robin, collective, routing forms, insights, polls
5. Phase 4: organizations, SSO / SCIM, CRMs, AI features, mobile apps, MCP server

## 6. Open questions

- Personal tool, internal tool for clients, or a SaaS product to sell?
- Hosting preference: Vercel + Supabase, or full GCP?
- Domain name for the product?
- Which payment processors are must have at launch (Stripe only, or Israeli processors too)?
- Hebrew first or English first for the default UI?
- Pricing model if sold: free tier, per seat, usage based?

## 7. Reference products

- Calendly (calendly.com)
- Cal.com (cal.com). Note: since April 2026 the main Cal.com codebase is closed source and the public community fork is Cal.diy (MIT).

Zmanly is an independent implementation. No code or assets are copied from these products.
