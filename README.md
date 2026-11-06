# Slotwise

The complete scheduling platform. Everything Calendly and Cal.com do, plus the best ideas from SavvyCal, Chili Piper, Reclaim, Motion, Doodle and Acuity, with Google Calendar, Gmail, WhatsApp and MCP built in from day one. Hebrew (RTL) and English from the start.

Status: planning. This README is the product spec. No code yet.
Visibility: private for now, may become public later (see section 9).

---

## 1. Vision

- One link that ends the back and forth of scheduling.
- Full parity with Calendly and Cal.com: every event type, routing, workflows, payments, teams, analytics, API.
- Invitee first: the person booking sees their own calendar on top of yours and picks a time in seconds.
- Meet people where they are: book, confirm, reschedule and cancel in WhatsApp, Gmail, or from any AI agent through MCP.
- Protect the host's time: ranked availability, focus time, meeting caps, smart buffers.
- AI native: natural language scheduling, meeting prep, notes and follow ups.
- Own the data: exportable, API first, self hostable.

## 2. Core parity map (Calendly + Cal.com)

Legend: P0 = MVP, P1 = v1, P2 = growth, P3 = enterprise / later.

### 2.1 Accounts and profile

- [ ] P0 Sign up / login: Google OAuth, Microsoft OAuth, email magic link, email + password
- [ ] P0 Onboarding wizard: username, timezone, connect calendar, set working hours, create first event type
- [ ] P0 Public profile page (slotwise.app/username) with avatar, bio, public event types
- [ ] P0 Username change with redirects from old slug
- [ ] P1 Two factor auth (TOTP), backup codes
- [ ] P1 Account deletion and full data export (GDPR)
- [ ] P1 Languages: Hebrew, English, more via i18n files
- [ ] P1 Week start day, 12h / 24h, date format preferences
- [ ] P2 Branding: logo, brand color, hide Slotwise branding
- [ ] P2 Custom domain for booking pages with automatic SSL

### 2.2 Event types

- [ ] P0 One on one
- [ ] P0 Multiple duration options per event (invitee picks)
- [ ] P0 Title, slug, rich description, color, hidden / secret events
- [ ] P0 Locations: Google Meet, Zoom, Microsoft Teams, phone (host calls / invitee calls), WhatsApp call, in person address, custom link, invitee chooses
- [ ] P1 Group events with seat limit
- [ ] P1 Seated events: remaining seats, show / hide other attendees, waitlist when full
- [ ] P1 Collective (all selected hosts must be free)
- [ ] P1 Round robin: equal distribution, priority, weights, maximize availability, reassign
- [ ] P1 Managed event types: admin template with locked / unlocked fields pushed to members
- [ ] P1 Recurring events (weekly / monthly series, N occurrences)
- [ ] P1 One off meetings / single use links
- [ ] P1 Meeting polls (Doodle style: propose slots, invitees vote, book the winner)
- [ ] P1 Dynamic group links (slotwise.app/alice+bob)
- [ ] P2 Instant meetings (book now, host notified in real time)
- [ ] P2 Duplicate, archive, reorder, search event types
- [ ] P2 Event type specific schedule and destination calendar
- [ ] P2 Private links with expiry, password protected events

### 2.3 Availability engine

- [ ] P0 Weekly working hours, multiple ranges per day
- [ ] P0 Multiple named schedules (Work, Evenings, Summer). Never remove this, a top Calendly complaint
- [ ] P0 Date overrides (special hours, day off) with a month calendar view
- [ ] P0 Buffer before / after events
- [ ] P0 Minimum notice
- [ ] P0 Booking window: rolling N days or fixed date range
- [ ] P0 Slot interval / start time increments
- [ ] P0 Conflict check across all connected calendars
- [ ] P1 Limits: max bookings per day / week / month / year, per event and globally
- [ ] P1 Limit total booked duration per day / week
- [ ] P1 Only first slot of each day option
- [ ] P1 Lock timezone on booking page (in person events)
- [ ] P1 Out of office with redirect to a teammate
- [ ] P1 Travel schedule (timezone changes on given dates)
- [ ] P1 Public holidays per country, auto block option
- [ ] P2 Treat tentative / free events as busy or free (per calendar)
- [ ] P2 Ignore all day events option
- [ ] P2 Per invitee limits (one booking per email per period)

### 2.4 Booking page (invitee experience)

- [ ] P0 Month view + time list, week view, column view
- [ ] P0 Auto detect invitee timezone, manual picker
- [ ] P0 Booking form: name, email, phone (for WhatsApp), notes, guests
- [ ] P0 Confirmation page + email with ICS, add to Google / Outlook / Apple buttons
- [ ] P0 Cancel and reschedule links (no login), reasons captured
- [ ] P0 Responsive, mobile first, RTL for Hebrew, dark / light
- [ ] P1 Custom questions: short text, long text, number, email, phone, select, multi select, radio, checkbox, boolean, URL, address, file upload
- [ ] P1 Required / optional fields, conditional questions
- [ ] P1 Hidden fields, URL prefill, UTM capture
- [ ] P1 Redirect after booking with booking data, no interstitial warning pages
- [ ] P1 Requires confirmation: host approves / declines, auto decline after X hours
- [ ] P1 Invitee reconfirmation before the meeting
- [ ] P1 Spam protection: Turnstile, blocked emails / domains, rate limiting
- [ ] P2 Embeds: inline, popup, floating button, with theme and prefill params and postMessage events
- [ ] P2 Accessibility WCAG 2.2 AA
- [ ] P2 SEO and Open Graph image per event

### 2.5 Google Calendar integration (core, must be perfect)

- [ ] P0 OAuth with incremental scopes, encrypted refresh tokens, auto refresh, reconnect flow when revoked
- [ ] P0 Multiple Google accounts, choose which calendars to check for conflicts
- [ ] P0 Destination calendar per event type
- [ ] P0 FreeBusy queries with caching
- [ ] P0 Create / update / delete events on book, reschedule, cancel
- [ ] P0 Google Meet link auto created via conferenceData
- [ ] P0 Invitees and guests as attendees
- [ ] P1 Push notifications (watch channels) + sync tokens, channel renewal job
- [ ] P1 Two way sync: change or delete in Google updates the booking
- [ ] P1 Recurring event expansion, declined events ignored, private events shown as busy
- [ ] P1 Quota handling: batching, exponential backoff
- [ ] P2 Workspace domain wide delegation for org admins
- [ ] P2 Read Google working location and out of office events

### 2.6 Gmail integration

- [ ] P0 Send booking emails from the host's own Gmail (send scope), fallback to platform email
- [ ] P1 Reply threading: confirmation, reminders and changes in one thread
- [ ] P1 Gmail side panel / Workspace add on: insert link or specific clickable times into a draft
- [ ] P1 Nudge: follow up if a link was sent and nobody booked
- [ ] P2 Detect scheduling intent in incoming emails and suggest times (AI)
- [ ] P2 Chrome extension for Gmail, LinkedIn and any text box

### 2.7 Other calendars and conferencing

- [ ] P1 Outlook / Office 365 (Graph API), Teams links
- [ ] P1 iCloud and generic CalDAV
- [ ] P1 Zoom (OAuth, auto meeting creation)
- [ ] P2 Webex, Whereby, Jitsi, built in video
- [ ] P2 ICS feed subscription (read only busy calendars)

### 2.8 Notifications and workflows

- [ ] P0 Emails: booked, rescheduled, cancelled, to host and invitee, localized, timezone correct
- [ ] P0 Reminder before meeting (email and WhatsApp, see section 4)
- [ ] P1 Workflow builder: trigger, timing, channel, template
  - Triggers: booked, before start, after end, cancelled, rescheduled, no show, booking requested, payment received, routing form submitted, link sent but not booked
  - Actions: email (host / attendee / custom), WhatsApp, SMS, webhook, Slack
- [ ] P1 Template variables ({invitee_name}, {event_time}, {location}, {cancel_url} ...)
- [ ] P1 Follow up after meeting (thank you, feedback form, next booking link)
- [ ] P2 Workflow analytics (sent, delivered, read, clicked)

### 2.9 Payments

- [ ] P1 Stripe: charge on booking, ILS / USD / EUR, tax
- [ ] P1 Deposits, hold card and charge no show fee
- [ ] P1 Refund policy on cancel by time window
- [ ] P2 PayPal, Israeli processors (Grow, Cardcom, Tranzila), Bit
- [ ] P2 Automatic receipts / invoices (e.g. Green Invoice / Morning integration)
- [ ] P2 Packages, memberships, gift cards, coupons

### 2.10 Routing forms

- [ ] P1 Form builder with conditional logic
- [ ] P1 Route to event type, person, team round robin, external URL, custom message
- [ ] P1 Route by user attributes (region, language, seniority)
- [ ] P2 CRM owner routing (HubSpot / Salesforce account owner)
- [ ] P2 Enrichment on submit and disqualify rules
- [ ] P2 Routing analytics and test mode

### 2.11 Teams and organizations

- [ ] P1 Teams with roles: owner, admin, member
- [ ] P1 Team page and team event types
- [ ] P1 Invite by email / link
- [ ] P2 Organizations with subdomain, sub teams
- [ ] P2 Book on behalf of a teammate, assistants, delegated admin
- [ ] P2 Admin manages members' bookings and event types
- [ ] P3 SSO (SAML, OIDC), SCIM, directory sync
- [ ] P3 Audit logs, retention policies, impersonation with audit trail

### 2.12 Bookings management (host side)

- [ ] P0 Bookings list: upcoming, unconfirmed, past, cancelled, filters
- [ ] P0 Search by name, email, phone, company, answer text (not only email)
- [ ] P0 Host can book manually from the dashboard and override availability
- [ ] P1 Mark no show, internal notes, booking history
- [ ] P1 Calendar view (day / week / month) of all bookings
- [ ] P1 Contacts list with history per contact
- [ ] P2 Bulk actions, CSV export

### 2.13 Insights

- [ ] P1 Created, completed, cancelled, rescheduled, no show rate
- [ ] P1 Popular days and hours, per event type, per member
- [ ] P2 Round robin fairness report
- [ ] P2 Funnel: link view, slot click, booked
- [ ] P2 Export to CSV and Google Sheets

### 2.14 Integrations and developer platform

- [ ] P1 Webhooks: signed (HMAC), retries, delivery log
- [ ] P1 REST API with API keys, OpenAPI spec, rate limits
- [ ] P1 MCP server (see section 5)
- [ ] P1 Zapier, Make, n8n
- [ ] P2 OAuth apps for third parties
- [ ] P2 Embeddable React components (booker, availability editor)
- [ ] P2 CRMs: HubSpot, Salesforce, Pipedrive
- [ ] P2 Slack app
- [ ] P2 GA4 / Meta Pixel on booking pages
- [ ] P2 Reserve with Google: Book button on Google Business Profile and Maps
- [ ] P2 Instagram and Facebook Book button
- [ ] P3 App store architecture: each integration is a plugin

### 2.15 AI features

- [ ] P2 AI scheduling assistant in natural language (chat, WhatsApp, email)
- [ ] P2 Pre meeting brief: who is the invitee, company, past meetings, form answers
- [ ] P2 Notetaker: record with consent, transcript, summary, action items
- [ ] P2 AI drafted follow up email, sent via Gmail on approval
- [ ] P2 No show prediction and smart overbooking for service businesses
- [ ] P3 AI phone agent that books by voice

### 2.16 Apps and surfaces

- [ ] P1 PWA
- [ ] P2 Native iOS / Android (Expo)
- [ ] P2 Browser extension
- [ ] P2 Mobile push notifications

## 3. Beyond parity: best features from adjacent products

### 3.1 From SavvyCal (invitee experience)

- [ ] P1 Calendar overlay: invitee connects their Google / Outlook calendar on the booking page and sees their own events on top of the host's availability (read only, nothing stored)
- [ ] P1 Ranked availability: host marks preferred times, shown as highlighted, other times still bookable
- [ ] P1 Personalized links per recipient (slotwise.app/yoni/dana) with name, greeting and prefilled details
- [ ] P1 Per link calendar settings (different conflict calendars per link)
- [ ] P2 Overlay works on any Slotwise link once the invitee connected once

### 3.2 From Chili Piper (revenue teams)

- [ ] P2 Form concierge: embed on any website form (HubSpot, Webflow, Typeform, custom), qualified leads see a calendar immediately after submit instead of a thank you page
- [ ] P2 Lead to account matching before routing
- [ ] P2 Live connect: route a hot lead to an available rep by phone, video or WhatsApp right now
- [ ] P2 Handoff: SDR books for an AE during the call with one click, AE availability and rules applied
- [ ] P3 Distro: route CRM leads to reps by territory, size, ownership, with fairness rules

### 3.3 From Reclaim and Motion (protect the host's time)

- [ ] P2 Priority aware links: high priority links may take over low priority blocks (focus time, habits)
- [ ] P2 Focus time goal: auto defend N hours per week of deep work
- [ ] P2 No meeting days
- [ ] P2 Smart recurring meetings: find the best weekly slot for all attendees and auto move on conflicts
- [ ] P2 Calendar sync: mirror busy blocks between work and personal calendars (private titles)
- [ ] P2 Auto travel buffers for in person meetings using Google Maps travel time from previous location
- [ ] P2 Decompression breaks after long meetings

### 3.4 From Doodle and When2meet (groups)

- [ ] P1 Polls without accounts for participants
- [ ] P2 Group availability heatmap: everyone paints when they are free, best overlap highlighted

### 3.5 From Acuity, Setmore, Booksy (service businesses)

- [ ] P2 Services and staff model (service X can be done by staff A or B)
- [ ] P2 Resources: rooms, chairs, equipment as bookable constraints
- [ ] P2 Waitlist: auto offer freed slots to the waitlist via WhatsApp
- [ ] P2 Intake forms and client records (notes, history, files)
- [ ] P2 Packages, memberships, gift cards, coupons
- [ ] P2 Class / workshop booking with capacity
- [ ] P2 Add ons to a service (extra 15 min, extra product)

### 3.6 Fixing common Calendly complaints

- [ ] P0 Keep multiple schedules and a visual month view for availability
- [ ] P0 Host can book and override from the dashboard
- [ ] P0 Search bookings by name and any field
- [ ] P1 Redirects without warning pages that hurt conversion
- [ ] P1 Transparent pricing, no billing for empty seats
- [ ] P1 Real human support channel (WhatsApp support line)

### 3.7 Israel first (our edge)

- [ ] P1 Shabbat and holidays: auto block from candle lighting to havdalah by the host's city, Jewish holidays and eves, optional Hebrew date on booking page
- [ ] P1 Hebrew RTL everywhere: booking page, emails, WhatsApp templates, ICS titles
- [ ] P1 Israeli phone formats and WhatsApp as default contact
- [ ] P2 Bit, Grow, Cardcom payments and Green Invoice receipts
- [ ] P2 Sunday to Thursday default work week, Friday half day presets

## 4. WhatsApp: a first class channel

WhatsApp is where Israelis (and much of the world) actually answer. Slotwise treats it as a primary channel, not an add on.

### 4.1 Infrastructure

- [ ] P0 Official WhatsApp Business Cloud API (Meta) only. No unofficial web based libraries, to avoid number bans
- [ ] P0 BSP option: direct Meta Cloud API, or Twilio / 360dialog
- [ ] P0 Approved message templates (utility category) in Hebrew and English for confirmation, reminder, reschedule, cancel
- [ ] P0 Opt in capture on the booking form, opt out handling (STOP)
- [ ] P1 Respect the 24 hour service window: templates outside it, free form inside it
- [ ] P1 Cost tracking per conversation, per workspace limits
- [ ] P1 SMS fallback when the number has no WhatsApp
- [ ] P2 Bring your own number per business / team, multiple numbers per org

### 4.2 Notifications with action buttons

- [ ] P0 Confirmation with Add to calendar link and location / Meet link
- [ ] P0 Reminder 24h / 2h before with quick reply buttons: Confirm, Reschedule, Cancel
- [ ] P1 Button replies update the booking instantly, host notified
- [ ] P1 Host notifications on WhatsApp: new booking, cancellation, approve / decline pending requests with a button
- [ ] P1 Daily agenda message to the host every morning
- [ ] P2 Waitlist offers: a slot opened, tap to grab it
- [ ] P2 Payment links and deposit requests inside the chat

### 4.3 Booking inside WhatsApp

- [ ] P1 Click to WhatsApp links and QR codes for each event type
- [ ] P1 Guided booking with interactive list messages: pick service, pick day, pick time, confirm
- [ ] P2 WhatsApp Flows: native forms for booking questions without leaving the chat
- [ ] P2 AI agent in Hebrew and English: free text and voice notes (transcribed), understands "next Tuesday after 5", reschedules and cancels
- [ ] P2 Handover to a human inside the same chat

## 5. MCP: Slotwise for AI agents

Slotwise exposes a remote MCP server so Claude, ChatGPT, Cursor and any MCP client can schedule on the user's behalf.

### 5.1 Server

- [ ] P1 Remote MCP over Streamable HTTP, OAuth 2.1 login, per tool scopes
- [ ] P1 Thin layer on top of the public REST API (one source of truth)
- [ ] P1 Tools:
  - list_event_types, get_event_type
  - get_availability (date range, timezone, event type, multiple hosts)
  - create_booking, reschedule_booking, cancel_booking
  - list_bookings, get_booking (filters, search)
  - create_single_use_link, create_poll
  - update_availability (date override, out of office)
  - get_insights (counts, no show rate, busiest days)
  - send_reminder (email / WhatsApp)
- [ ] P1 Destructive actions (cancel, bulk changes) require explicit confirmation flag
- [ ] P1 Every MCP action written to the audit log with the client name
- [ ] P2 Resources: upcoming agenda, event type catalog
- [ ] P2 Prompts: plan my week, find time with X, prepare me for my next meeting
- [ ] P2 Publish to the MCP registry and Claude connector directory

### 5.2 Agent friendly platform

- [ ] P1 OpenAPI spec and llms.txt for the docs
- [ ] P2 Agent to agent booking: an external AI assistant can query availability and book through a public, rate limited endpoint with the invitee's consent
- [ ] P2 Slotwise AI agent can call other MCP servers (CRM, Notion, Drive) to build meeting briefs

## 6. Edge cases checklist

- DST transitions in both host and invitee timezones, including Israel's DST dates
- Invitee and host on different calendar dates (slots crossing midnight)
- Double booking race: two invitees take the same slot at the same moment (DB lock / unique constraint + idempotency key)
- Calendar token revoked or expired while bookings exist: alert host by email and WhatsApp
- Event deleted directly in Google Calendar: cancel booking and notify invitee (configurable)
- Overlapping busy times from several calendars and accounts
- All day, multi day, tentative and declined events
- Seats: last seat taken during checkout
- Reschedule with payment: keep or move the charge
- Reschedule a recurring series: one occurrence vs all
- Host changes timezone after events were booked
- Minimum notice in host vs invitee timezone
- Email bounces, invalid phone numbers, WhatsApp template rejected or number blocked
- WhatsApp button pressed after the meeting already changed (stale actions)
- Shabbat block computed per city and season, user traveling abroad
- Webhook receivers down: retries, dead letter queue
- Double clicks and slow networks creating duplicates
- Prefill links that no longer match the form
- Hebrew and English mixed in the same line (bidi), names, URLs
- Google and Meta API quota limits
- MCP client retries a create_booking call (idempotency keys required)
- Leap years, 30 / 45 minute offset timezones

## 7. Proposed architecture (to be confirmed)

- Frontend: Next.js (App Router) + TypeScript + Tailwind + shadcn/ui, next-intl for i18n and RTL
- Backend: Next.js route handlers / tRPC, public REST API, separate worker service
- Database: Postgres (Supabase or Cloud SQL), Prisma or Drizzle
- Jobs: BullMQ + Redis or Google Cloud Tasks (reminders, sync, webhooks, WhatsApp sends)
- Auth: Auth.js or Supabase Auth
- Email: Gmail API (host mailbox) + Resend fallback
- WhatsApp: Meta Cloud API (or Twilio / 360dialog), SMS via Twilio
- MCP: TypeScript MCP SDK, remote server with OAuth 2.1
- Payments: Stripe first, Israeli processors after
- Hosting: Vercel for web, Cloud Run for workers, or full GCP
- Observability: Sentry, structured logs, uptime checks
- Testing: Vitest for the availability engine (heavy timezone tests), Playwright for booking flows

### Core data model (draft)

User, Account (OAuth), CalendarConnection, SelectedCalendar, DestinationCalendar, Schedule, AvailabilityRule, DateOverride, RankedWindow, EventType, EventTypeHost, BookingQuestion, Booking, Attendee, BookingSeat, Waitlist, Payment, Workflow, WorkflowStep, ScheduledNotification, MessageChannel, WhatsAppTemplate, WhatsAppConversation, RoutingForm, RoutingRule, Team, Membership, Organization, Service, Resource, Webhook, WebhookDelivery, ApiKey, OAuthClient, McpSession, AuditLog, Contact.

## 8. Roadmap

1. Phase 0: repo setup, CI, design system, auth, DB schema
2. Phase 1 (MVP): profile, one on one events, availability engine, Google Calendar + Meet, Gmail sending, booking page, cancel / reschedule, email + WhatsApp confirmations and reminders with buttons, Shabbat / holiday blocking
3. Phase 2: custom questions, workflows, Stripe, group / seated / recurring events, polls, calendar overlay, ranked availability, Outlook + Zoom, embeds, webhooks, REST API, MCP server
4. Phase 3: teams, round robin, collective, routing forms, insights, WhatsApp booking bot, Gmail add on
5. Phase 4: form concierge, handoff, focus time and smart meetings, service business mode, Israeli payments, AI features, mobile apps
6. Phase 5: organizations, SSO / SCIM, CRMs, marketplace

## 9. Repo visibility and license

- Private now. Before going public: choose license (MIT, AGPL or source available), remove secrets from history, add CONTRIBUTING and SECURITY files.
- Never commit API keys or tokens. Use .env files and a secrets manager from the first commit.

## 10. Open questions

- Personal tool, client tool, or SaaS to sell?
- Hosting: Vercel + Supabase, or full GCP?
- Domain name?
- Payment processors required at launch?
- Default UI language: Hebrew or English?
- WhatsApp provider: direct Meta Cloud API or a BSP?
- Pricing model if sold?

## 11. Reference products

Calendly, Cal.com (since April 2026 closed source, community fork Cal.diy), SavvyCal, Chili Piper, Reclaim, Motion, Doodle, When2meet, Acuity, Setmore, Booksy.

Slotwise is an independent implementation. No code or assets are copied from these products.
