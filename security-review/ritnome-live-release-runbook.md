# Ritnome institutional — live release runbook (2026-11-27)

Status 2026-11-27 20:41 UTC: **released**. Service active (`RITNOME_LIVE_ENABLED=true`, log "Ritnome institutional ready"), custom domain institutional.ritnome.com verified with certificate, website main at commit 183ff97 (facility page live). Zero facilities enrolled; the market is being created. All nine variables set. Live portal configuration and webhook endpoint exist in Stripe (ids in Render env). The Stripe sandbox has not been deleted yet (owner's dashboard action).

## What exists
| Piece | Where | State |
|---|---|---|
| Production database | Supabase project `ritnome-production`, ref `suoxqbimnfgjlkypziuf`, us-east-1 | 7 migrations applied from `security-review/` on branch `ritnome-institutional-live-candidate` (dedicated bootstrap → storage → transaction → membership + reversal + atomic access → enrollment + access hold → live enrollment extension → readiness). `ritnome_live_release_ready()` = true. Security advisor: only "RLS enabled, no policy" notices, which is the design (no browser access; service role only). |
| Production service | Render web service `ritnome-institutional` (srv-dc4tvolg1s2s73fqq2sg), Virginia, starter plan, repo hooporia-server, branch `ritnome-institutional-live-candidate`, start `node ritnome-live-server.js`, auto-deploy **off** | Live at https://ritnome-institutional.onrender.com in setup mode: `/healthz` → `{"mode":"setup","running":false}`, everything else 503 `institutional_not_enabled`. |
| Website | ritnome-bpm branch `institutional-release` = main + onboarding page + enrollment link | Not merged. `institutional.html` links to https://institutional.ritnome.com/enroll. |
| Sandbox | Supabase `ritnome-sandbox` **paused** (data kept); Render `ritnome-sandbox-api` still exists but its database is paused; Stripe sandbox to be deleted by the owner | Evidence preserved in `security-review/ritnome-*-2026-11-27.md`. |

## Environment variables on the production service
Set by the release (non-secret): `RITNOME_LIVE_ENABLED=false`, `RITNOME_LIVE_SUPABASE_URL`, `RITNOME_LIVE_PROJECT_REF`, `RITNOME_LIVE_PUBLISHABLE_KEY` (sb_publishable_… of ritnome-production), `RITNOME_LIVE_PRICE_ID=price_1UgP8ZCuedlcmwMmeEZr9ev2`.

To be entered by the owner directly in the Render dashboard (never in chat):
- `RITNOME_LIVE_SUPABASE_SERVICE_KEY` — Supabase → ritnome-production → Project Settings → API keys → service_role (secret).
- `RITNOME_LIVE_STRIPE_KEY` — Stripe **live** secret key (`sk_live_…`) or a restricted key (`rk_live_…`) with access to Checkout Sessions, Customers, Subscriptions, Prices, Invoices, Billing Portal, Events.
- `RITNOME_LIVE_WEBHOOK_SECRET` — signing secret (`whsec_…`) of the live webhook endpoint below.
- `RITNOME_LIVE_PORTAL_CONFIG` — id (`bpc_…`) of the live customer-portal configuration below (an id, not a secret).

## Stripe live mode (owner)
1. Price `price_1UgP8ZCuedlcmwMmeEZr9ev2` must be: active, USD 149.00, monthly, tax behaviour **exclusive**. The server refuses to start otherwise.
2. Billing → Customer portal → create a configuration: invoice history ON, payment-method update ON, customer details editable, cancellation **at period end** without proration, subscription update (plan/quantity changes) **OFF**. Copy its `bpc_…` id.
3. Developers → Webhooks → add endpoint `https://ritnome-institutional.onrender.com/ritnome/stripe/webhook` with events: `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`, `charge.refunded`, `charge.dispute.created`. Copy its signing secret.
4. Tax: Puerto Rico registration active so IVU is calculated on live checkouts.
5. Delete the Stripe sandbox used for testing.

## DNS (owner)
`institutional.ritnome.com` → CNAME `ritnome-institutional.onrender.com`, and add that custom domain to the Render service. The server's Stripe return URL is fixed to https://institutional.ritnome.com/enroll, so this hostname is required.

## Inviting a facility (operator procedure, per customer)
Enrollment is by invitation; the browser can never pick a price, customer or facility.
1. Supabase → ritnome-production → Authentication → Users → **Add user** with the facility owner's email and a temporary password (or invite). Note the user's id.
2. SQL (service role):
   ```sql
   insert into public.licenses(code, school_name, product) values ('<unique code>', '<facility name>', 'ritnome_institutional') returning id;
   insert into public.ritnome_enrollment(livemode, owner_id, facility_name, facility_type, approved_license_id)
   values (true, '<auth user id>', '<facility name>', 'residence'|'assisted'|'day', '<license id>');
   ```
3. The owner opens https://institutional.ritnome.com/enroll, signs in, and clicks checkout → Stripe hosted checkout → returns to /enroll. The webhook binds the subscription; staff access to the activity desk follows from `ritnome_institution_authorized()`.
4. To end access: set `enabled=false` on the enrollment (access is denied immediately) or let the subscription lapse.

## Activation (requires the owner's explicit authorization)
1. All nine variables set. Trigger a manual deploy. Log must say "Ritnome institutional ready" (startup verifies the live price, the portal configuration and the database readiness; any mismatch blocks startup and the log says "startup blocked").
2. Checks without a real charge: `/healthz` running:true; unsigned POST to the webhook → 400; `/enrollment/status` without a token → 401; a signed-in owner with no approved enrollment → 409 `enrollment_unavailable`; Spanish/English toggle on /enroll.
3. `RITNOME_LIVE_ENABLED=true` + redeploy only when the owner says so.

## Rollback
`RITNOME_LIVE_ENABLED=false` + redeploy returns the service to setup mode (503) with no data change. Nothing in this release touches reactific-licenses or any other service.

## Institutional reporting and desk (Phases 1–3)
- Phase 1 (reporting foundation) is applied to ritnome-production and deployed (2026-11-27). Migration: `security-review/ritnome-reporting-foundation.sql`.
- Phase 2 (shared script `ritnome-institutional.js` + Conga Party integration) and Phase 3 (desk at `/desk`, staff management) are on branch `ritnome-institutional-live-candidate`; staff management SQL `security-review/ritnome-staff-management.sql` is **not yet applied** to production.
- Release steps for Phases 2–3 (after "ok to push"): (1) apply `ritnome-staff-management.sql` to ritnome-production; (2) deploy `ritnome-institutional` from the branch; (3) merge ritnome-bpm `conga-institutional` → main (static site auto-deploys); (4) set `available:true` for `conga-party` in `ritnome-activity-catalog.js` and redeploy; (5) verify: `/desk` sign-in with a facility account, Start Conga Party from the library, run appears in Facilitator View.
- Evidence per checkpoint: SQL suite 64/64, service suite 35/35, script browser suite 14/14, desk browser suite 21/21 (local, disposable Postgres; see `security-review/test/README.md`).
- Rollback: `RITNOME_LIVE_ENABLED=false` disables the whole institutional service; the reporting tables keep their data (never dropped).

## 14-day free trial (released 2026-11-28 09:29 UTC)
- Checkout adds `trial_period_days: 14` with a card required; if the card is missing at trial end Stripe cancels. Price, tax and portal settings are unchanged.
- Entitlement: a verified first trial (`trialing`, ≤14 days, no prior paid period) grants access until `trial_end`; the SQL commit allows that one non-active extension only (from NULL, ≤15 days ahead). Nothing else about the paid rules changed. Migration: `security-review/ritnome-trial.sql`.
- Owner step in the Stripe dashboard (not code): Settings → Billing → Subscriptions and emails → turn on the reminder email before a trial ends.

## Phase 4 released (2026-11-28)
- All 15 activities verified by the activity gate (106 checks) and marked available in the library. Game sites merged to main: ritnome-bpm (auto-deploy), reaction-velocity = vreaction-velocity on GitHub (same repo, auto-deploy), fortress-mobi (manual deploy).
- Institutional mode on the game sites is entered only by the launch code in the URL fragment; athlete/school use is unchanged.

## Phase 5 — participant handles at the station (released 2026-11-28 09:54 UTC)
- When a facility has handles on, the station asks "who is at this station" after the headcount (labels only, six characters derived from the id; no names anywhere) and the banner lets the facilitator switch participant. Each finished game adds a progress row for that handle (setting, personal BPM or level, result). Facility totals are unchanged.
- Desk: handles show the same labels; Individual Progress lists runs, minutes, activities, personal BPM over time, and per activity + setting the first sessions (baseline) and the latest.
- Migration: `security-review/ritnome-phase5.sql` (one read-only function for the station's handle list). Release: apply, deploy the service, deploy the three game sites (glue sends progress).

## Phase 6 — public pages (released 2026-11-28)
- ritnome.com/library.html: the 16 activities by category with descriptions and badges; ritnome.com/institutional.html: areas, reporting levels, price, trial, enrollment steps. Static site, auto-deploy from main.

## Status after the six phases
All six approved phases are live. Operating notes: the activity gate (`ritnome-activities.browser.test.js`) is the rule for any new activity — it is marked `available:true` in `ritnome-activity-catalog.js` only after its block passes. Invitations remain the entry point (`## Inviting a facility`); a facility's first entitlement is the 14-day trial.

## Progress View R1–R3 (2026-11-28)
- R1 (released 11:06 UTC): facilitated session identity, Puerto Rico periods, plan history, single calculation layer. Migration `ritnome-r1-sessions.sql`.
- R2 (released 11:39 UTC): Institutional Executive Report at `/report` (owner/manager), one Letter page, Spanish/English, management-only utilization excluded from print by default. Migration `ritnome-r2-executive.sql`. Visual standard for all Progress View reports.
- R3 (live 2026-11-28): Recreation Program Record at `/record` (any facility role, facility scoped): date range, period summary, planned vs delivered by week with target history, daily summary, chronological record (sessions → activity runs, settings where recorded), scope/privacy statement, signature line, page numbering, CSV. Migration `ritnome-r3-record.sql`.
- R4 (live 2026-11-28): Trial Value Report — the executive report in trial mode (`/report?period=trial`; owner/manager): window from enrollment to trial end, day counter and days left, no comparisons or utilization, onboarding steps when nothing has been recorded; linked from the enrollment status page while trialing. Migration `ritnome-r4-trial-report.sql` (read-only window function; no billing change).
- R5 (live 2026-11-28; official personal reporting component): Mi Trayectoria — printable individual journey per pseudonymous handle (`/journey?handle=<id>`; owner/manager; linked from the desk handles table). Two print options from the same engine: Personal Summary (`view=summary`, one Letter page, full scope statement in the footer, for the participant and facility-authorized family sharing) and Detailed History (`view=detailed`, the summary page followed by activity-by-activity tables and the chronological history, abbreviated scope on later pages, history CSV). Personal BPM is only ever an individual measurement sent by the activity (Reaction Velocity); the group's configured tempo is reported separately as "Tempo del grupo" and never attributed to the person. The history states "showing N of M records" (cap 2000). No public links and no automatic distribution: access stays behind the facility session and role. Participation history, personal tempo (BPM) as recorded at each activity's setting, activities explored, accomplishments stated as facts, chronological history, Letter pagination, Spanish-first with English. A typical tempo is shown only with at least three observations at the same activity and setting; no rankings, no clinical terms, a higher or lower tempo is never presented as better. Migration `ritnome-r5-journey.sql` (read-only function `ritnome_rep_journey`; no new tables). Apply order after R4: `ritnome-r5-journey.sql`.

## Demonstration facility (operator testing and sales presentations)
- Script: `security-review/ritnome-demo-facility.sql` (run once, service role). Owner = the Supabase Auth user with the email at the top of the script, created first by the operator with their own password (Authentication → Users → Add user → Create new user, Auto Confirm on).
- Creates "Residencia Demostración Ritnome (ficticia)": license RITNOME-DEMO-01, owner membership, plan 5/week with participant handles on, eight weeks of fictional history (sessions, 16 activities, six pseudonymous participants), access through a registry row with placeholder ids `cus_RitnomeDemo01` / `sub_RitnomeDemo01` that do not exist in Stripe (no checkout, no charge, never referenced by a webhook), paid through 2030-12-31.
- Isolated by its own facility_id; refuses to run twice. Do not use the billing button on /enroll for this facility. Retire: `update public.ritnome_enrollment set enabled=false where approved_license_id=(select id from public.licenses where code='RITNOME-DEMO-01');`
- Created in production 2026-11-28 (owner gostardigital@gmail.com; 44 sessions, 124 runs, 16 activities, 6 participants). Verified: owner sign-in authorized, executive/management/facilitator/record/trial/journey reports, launch→exchange→run for all 16 activities.
- Commercial exclusion rule: the demo never exists in Stripe, so Stripe revenue, customer and trial-conversion figures cannot include it. Any database count of customers, subscriptions, trials or revenue must exclude license codes `RITNOME-DEMO-%` (equivalently `stripe_subscription_id LIKE 'sub_RitnomeDemo%'`).

## R6 — Progress View landing and desk accuracy (live 2026-11-28)
- Migration `ritnome-r6-desk.sql` (desk weekly count limited to the selected month; read-only function) applied; service deployed at commit b644845.
- Progress View tab = landing with six role-filtered cards; managers see Facility Settings read-only; facilitators see Facilitator View and Program Record only.
- Production verified with the demo facility (owner, manager, facilitator; cancelled transaction): desk weekly = desk month = Executive Report = Program Record for 2026-09/10/11; role refusals unchanged.
- Future (non-blocking): roomier Facility Settings form and Mi Trayectoria buttons on phones.
