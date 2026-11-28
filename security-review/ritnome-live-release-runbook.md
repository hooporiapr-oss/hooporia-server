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

## 14-day free trial (owner-approved 2026-11-28, pending "ok to push")
- Checkout adds `trial_period_days: 14` with a card required; if the card is missing at trial end Stripe cancels. Price, tax and portal settings are unchanged.
- Entitlement: a verified first trial (`trialing`, ≤14 days, no prior paid period) grants access until `trial_end`; the SQL commit allows that one non-active extension only (from NULL, ≤15 days ahead). Nothing else about the paid rules changed. Migration: `security-review/ritnome-trial.sql`.
- Owner step in the Stripe dashboard (not code): Settings → Billing → Subscriptions and emails → turn on the reminder email before a trial ends.
