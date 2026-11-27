-- REVIEW ONLY. Not applied. New tables only; no existing table changes.
BEGIN;
CREATE TABLE public.ritnome_subscription_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  livemode boolean NOT NULL,
  facility_id uuid NOT NULL,
  stripe_customer_id text NOT NULL CHECK (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  stripe_subscription_id text NOT NULL CHECK (stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  stripe_price_id text NOT NULL CHECK (stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  license_id uuid REFERENCES public.licenses(id) ON DELETE RESTRICT,
  billing_status text NOT NULL DEFAULT 'pending' CHECK (billing_status IN ('pending','active','past_due','unpaid','canceled','incomplete','incomplete_expired','trialing','paused','review')),
  paid_through timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (livemode, stripe_subscription_id),
  UNIQUE (livemode, facility_id),
  UNIQUE (license_id),
  CHECK (livemode OR license_id IS NULL)
);
CREATE TABLE public.ritnome_stripe_inbox (
  livemode boolean NOT NULL,
  stripe_event_id text NOT NULL CHECK (stripe_event_id ~ '^evt_[A-Za-z0-9]+$'),
  subscription_id text NOT NULL CHECK (subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  event_type text NOT NULL CHECK (event_type IN ('invoice.paid','invoice.payment_failed','customer.subscription.updated','customer.subscription.deleted')),
  event_created bigint NOT NULL CHECK (event_created >= 0),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  PRIMARY KEY(livemode,stripe_event_id)
);
CREATE INDEX ritnome_inbox_pending_idx ON public.ritnome_stripe_inbox(received_at) WHERE processed_at IS NULL;
ALTER TABLE public.ritnome_subscription_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ritnome_stripe_inbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ritnome_subscription_registry,public.ritnome_stripe_inbox FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.ritnome_subscription_registry,public.ritnome_stripe_inbox TO service_role;
COMMIT;
