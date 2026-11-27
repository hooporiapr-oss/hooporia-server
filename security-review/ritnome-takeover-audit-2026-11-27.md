# Ritnome take-over audit — 2026-11-27 (read-only)

Scope: the ten checks in the owner's master handoff, section 14. Nothing was changed during this audit.

## 1. Latest Ritnome frontend
- ritnome-bpm `main` HEAD = 040522e (PR #10, Institutional Demo Phase 5), same as the handoff. All ten PRs merged.
- Two branches newer than main, not in the handoff:
  - `institutional-onboarding-phase-9e` (+2): adds `institutional.html` (bilingual facility preview, $149/month + IVU, checkout button disabled) and links it from `senior-demo.html`. Preview only; nothing is sent or saved.
  - `security-license-phase-7a` (+4): review-only SQL (apply/rollback/verify) that would also restrict authenticated SELECT on `public.licenses` to admins. Not applied anywhere. Its own README requires dependency inspection first.
- Render static site `ritnome-bpm` deploys `main` (auto-deploy on commit).

## 2–3. Backend branches (hooporia-server)
- `ritnome-stripe-isolation-phase-9a` HEAD = 6e6a724 (sandbox). The Render sandbox runs 9aa966c, three commits behind: the two newer commits add documentation and `ritnome-enrollment-access-hold-candidate.sql` (disabled enrollment must not keep staff access); that SQL is already applied in the sandbox database as migration `sandbox_ritnome_disabled_enrollment_access_hold`.
- `ritnome-institutional-live-candidate` HEAD = daa9e08 = 9a + 12 commits. It adds a separate, fail-closed production entry point `ritnome-live-server.js` that:
  - stays in setup mode (503) unless `RITNOME_LIVE_ENABLED=true`;
  - **refuses** both the shared database (sdaphocueugzfvjovuxd) and the sandbox (ogmpndblmcmpqzjoxnfu) — it requires a new dedicated Supabase project;
  - requires live Stripe credentials, the fixed live price `price_1UgP8ZCuedlcmwMmeEZr9ev2` ($149/month, tax exclusive), a live portal configuration and a webhook signing secret;
  - checks the dedicated database with `ritnome_live_release_ready()` before serving.
  - Env names: RITNOME_LIVE_ENABLED, RITNOME_LIVE_SUPABASE_URL, RITNOME_LIVE_PROJECT_REF, RITNOME_LIVE_PUBLISHABLE_KEY, RITNOME_LIVE_SUPABASE_SERVICE_KEY, RITNOME_LIVE_STRIPE_KEY, RITNOME_LIVE_PRICE_ID, RITNOME_LIVE_PORTAL_CONFIG, RITNOME_LIVE_WEBHOOK_SECRET.
- Unit tests on the live-candidate branch: 10 suites, all pass (16 entitlement, 15 access-policy, 33 gate, 24 Stripe source, 24 worker scenarios, plus scheduler, reconciler, inbox, intake and runtime suites). Mock-based; no network.
- Not merged into `main`; `main` is unchanged and runs the unrelated production server.

## 4. Render sandbox
- Service `ritnome-sandbox-api` (free plan, Virginia), repo hooporia-server, branch `ritnome-stripe-isolation-phase-9a`, start `node ritnome-sandbox-server.js`, auto-deploy off.
- Live deploy: commit 9aa966c (17:02 UTC). Logs: "Ritnome sandbox ready"; at 17:02 the one-time browser pilot ran and "access self-test passed: 35 checks". Latest restart 18:51 UTC clean. No errors.
- Free plan: the service sleeps when idle.

## 5. Sandbox database (ritnome-sandbox, ogmpndblmcmpqzjoxnfu)
- 9 migrations, the last `sandbox_ritnome_disabled_enrollment_access_hold`.
- Tables: app_admins, licenses (1 synthetic fixture), ritnome_subscription_registry (7 rows, 4 active), ritnome_enrollment (2), ritnome_institution_memberships (1), ritnome_stripe_inbox (15 received / 15 processed), ritnome_decision_audit (15). RLS on every table. 3 auth users.

## 6. Completed Stripe sandbox purchase
- Enrollment "RITNOME BROWSER PILOT - TEST ONLY" (residence), enabled, checkout session bound, registry billing_status **active**, livemode false, paid through **2026-12-27 18:54 UTC**, revision 2, one active staff membership, two audit rows. Matches the acceptance record in `security-review/ritnome-hosted-checkout-acceptance-2026-11-27.md` ($149 + $17.14 IVU = $166.14). Nothing to repeat.
- A second enrollment "SYNTHETIC-ENROLLMENT-ONLY" is disabled with no subscription (expected).

## 7. Shared-database policy migration (reactific-licenses)
Current `public.licenses` policies, read directly from pg_policies:
- DELETE / INSERT / UPDATE for `authenticated`: `(select is_admin())` — as the handoff states.
- SELECT for `authenticated`: `true`; SELECT for `anon`: `true` — unchanged.
Verified now, inside a rolled-back transaction, as role `authenticated`:
- Registered admin (confirmed Auth account): `is_admin()` = true, can read licenses.
- Non-admin: `is_admin()` = false; UPDATE affected 0 rows; INSERT rejected ("new row violates row-level security policy") — this was the test the handoff listed as not demonstrated.
- Exactly one confirmed administrator account exists.

## 8. Was any active application affected?
- Last 24 h of API traffic on the shared project: no request to `/rest/v1/licenses` at all. Live apps validate through RPCs (`check_access`, `license_category`, `hooporia_coach`, `check_license`), and every one of them is SECURITY DEFINER owned by postgres, which bypasses RLS — the policy change cannot affect them. No 4xx responses in the window.
- License Admin (gostar.digital) is the only direct writer; it sends the signed-in admin's token, so `is_admin()` is true and its create/update/delete keep working.
- Basketball Money payments server (service-role client, bypasses RLS) is suspended on Render and the product is discontinued; no live dependency.
- Conclusion: the migration is safe for every active application found. Remaining exposure: licenses are still readable by any authenticated or anonymous caller (two SELECT policies); phase-7a SQL to close the authenticated side exists but is unapplied and needs its own dependency review (memory-mobi pages read the table directly).

## 9. Does the production candidate need the shared legacy database?
No. `ritnome-live-server.js` explicitly rejects it. Ritnome production touches only its own dedicated project; nothing in the live candidate reads or writes `public.licenses` on reactific-licenses.

## 10. Can the dedicated database give stronger isolation?
Yes, and the live candidate already assumes it: a brand-new Supabase project (neither sandbox nor shared), its own Auth, its own `ritnome_*` tables, service-role access only from the server, and a `ritnome_live_release_ready()` gate. Institutional customers never hold credentials to the shared project.

## Smallest safe path to release (proposed, not started)
1. Create the dedicated production Supabase project (new ref). Apply `security-review/ritnome-live-*.sql` from the live-candidate branch; run its readiness function.
2. Stripe live mode (owner's dashboard): confirm the live price `price_1UgP8ZCuedlcmwMmeEZr9ev2` is active with tax behaviour "exclusive"; create the live customer-portal configuration (cancel at period end, no plan changes, invoice history, payment-method update); add the live webhook endpoint for the new service and copy its signing secret into Render. Test/live keys stay separate.
3. New Render web service `ritnome-institutional` from hooporia-server branch `ritnome-institutional-live-candidate`, start `node ritnome-live-server.js`, with the nine RITNOME_LIVE_* variables, `RITNOME_LIVE_ENABLED=false` until the final check.
4. Frontend: merge `institutional-onboarding-phase-9e` and point its checkout at the live enrollment page served by the new service. Public demos stay public.
5. Verification without a real charge: setup-mode health check, readiness RPC, webhook signature rejection test, unauthorized access denial, cross-facility denial, expired-subscription denial, Spanish/English toggle, tablet layout.
6. Owner authorizes `RITNOME_LIVE_ENABLED=true`; smoke test; document deployment commit and rollback (flag back to false).

Needs the owner: Stripe live-mode steps (no Stripe connector here), approval to create the new Supabase project (billing), and the final activation.
