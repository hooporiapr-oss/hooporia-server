# Ritnome sandbox release evidence — 2026-11-27

## Boundary
Test-mode Stripe, dedicated sandbox Supabase and isolated Render branch only. No live licenses, real charges, or legacy server changes. Latest deployed code: 7d567ae4096cfd55785d53533a70c149ac6dcc1c; Render deploy dep-dc4qqmff3r2c73cdnagg live. Recovery and access self-test startup flags disabled. Synthetic Auth user cleanup verified (zero remaining).

## Verified
- Actual Stripe subscription creation: USD 149.00 + PR IVU 17.14 = 166.14.
- Fresh invoice.paid and subscription.updated processed automatically.
- Cancellation: previously purchased paid-through preserved; no new invoice.
- Duplicate decision on actual processed event returned duplicate under service_role; one audit row. Direct DB test, not Stripe webhook replay.
- Genuine partial refund: charge.refunded processed, review hold, paid-through unchanged.
- Initial decline: invoice.payment_failed processed, incomplete and no paid-through.
- Recovery: same previously declined invoice paid using sandbox SDK; registry active with verified paid period.
- Genuine dispute: both invoice.paid and charge.dispute.created processed, review hold, no entitlement.
- Later cancellation of disputed subscription: existing_review_hold preserved.
- 218 simulated assertions across intake, source, worker; 26 recovery harness checks; 17 real Auth/HTTP access integration checks.
- Access test: malformed/missing token, no assignment, inactive membership, review holds denied; paid and recovered fixtures allowed; signed-out session denied.
- DB atomic session/membership/access RPC only callable by service_role; private session helper not available to anon/authenticated. Pending reversal event blocks eligibility.
- Inbox: 10 real events, 10 processed, 10 audit rows; zero pending at final check.

## Remaining release gates
No production release or main merge. Actual customer checkout, facility onboarding and staff assignment, paid content/API enforcement, live environment separation/release, and operational review remain necessary. Deployed renewal and out-of-order paid/failed invoice handling still need verification; current source reads latest invoice. Direct duplicate transaction verified; actual Stripe redelivery not independently tested. Review release/hold policy, async refund outcomes and dispute resolution handling before live activation. Manual license expiry is inclusive UTC date. Security advisors report expected backend-only RLS/no-policy information, existing fixture is_admin definer warnings and disabled leaked-password protection. Review and resolve relevant production security findings separately. Existing unrelated Basketball Money sandbox webhook not modified.
