-- Applied to sandbox only; production requires separate release.
BEGIN;
ALTER TABLE public.ritnome_stripe_inbox DROP CONSTRAINT ritnome_stripe_inbox_event_type_check, ADD CONSTRAINT ritnome_stripe_inbox_event_type_check CHECK(event_type IN ('invoice.paid','invoice.payment_failed','customer.subscription.updated','customer.subscription.deleted','charge.refunded','charge.dispute.created'));
COMMIT;
