# Stripe sandbox closeout — 2026-11-27

## Provider setup
- Test account acct_1Teo3BEAmtgiDmNe only. Live account unchanged.
- Price price_1UgPTpEAmtgiDmNe60RtgJ5B: USD 149/month, fixed one per facility, tax exclusive. Current Puerto Rico sandbox registration active. Earlier current-date payment and recovery verified USD 166.14 including IVU 17.14.
- Genuine hosted Checkout Session created in subscription mode: fixed quantity one, automatic tax enabled, required billing address, no promotions. Session open/unpaid; correct line item verified via Stripe API. Hosted browser completion and automatic binding to an institutional account are not tested or connected to the website.
- Dedicated sandbox customer billing portal configuration bpc_1UgRuWEAmtgiDmNeARCnClkg created and verified. This is the first/default sandbox configuration. Invoice history, payment method updates, customer details and cancellation at period end without proration enabled; price/quantity changes disabled. Synthetic facility 004 portal session created. Browser interaction not tested.

## Deployed renewal and replay
- Facility 006 used a Stripe test clock frozen 2026-10-25. Initial paid invoice yielded paid-through 2026-11-25 12:00 UTC. Advancing clock generated a genuine subscription_cycle renewal invoice. The draft was explicitly finalized and then paid through a restricted sandbox SDK harness; fully unattended collection was not proven. The existing unrelated sandbox webhook had pending deliveries and was not modified.
- Historical clock invoice totals were USD 149, taxability not_collecting, because simulated periods predated the tax registration. This does not replace the already verified current-date IVU calculation.
- Stripe invoice in_1UgRwREAmtgiDmNesUrf3RLr verified paid; actual invoice.paid automatically reconciled with audit reason verified_paid_period and paid-through 2026-12-25 12:00 UTC (registry revision 3).
- The existing genuine facility 003 paid event was retrieved from Stripe, signed inside the sandbox server with the SDK test-signature helper and replayed twice through the real HTTP endpoint. Both accepted; processed timestamp, audit revision, subscription revision and review hold remained unchanged. This is a signed HTTP replay, not a provider-initiated Stripe resend.
- Final observed database: 13 received, 13 processed, 13 audit records. Zero pending. Temporary renewal/replay startup hook removed; test flag disabled; cleanup deploy dep-dc4quu49v7es7382hrvg.
- Earlier actual refund, dispute, decline, recovery, cancellation and authenticated staff access results are in ritnome-sandbox-release-evidence-2026-11-27.md.

## Handoff
Do not enable live checkout until the actual institutional onboarding/Checkout completion binding, billing-owner portal link, production access enforcement, terms and security review are complete. Hosted browser checkout and portal interaction, fully unattended renewal (including late/out-of-order events), and live release checks remain outstanding. No production deployment, real charge or legacy webhook change. Prefer hosted Stripe components rather than more custom payment UI.
