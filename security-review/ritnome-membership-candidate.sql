-- Candidate only. One explicit facility assignment per staff user per mode.
BEGIN;
CREATE TABLE public.ritnome_institution_memberships (
 livemode boolean NOT NULL,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 facility_id uuid NOT NULL,
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(livemode,user_id),
 FOREIGN KEY(livemode,facility_id) REFERENCES public.ritnome_subscription_registry(livemode,facility_id) ON DELETE RESTRICT
);
ALTER TABLE public.ritnome_institution_memberships ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ritnome_institution_memberships FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.ritnome_institution_memberships TO service_role;
COMMIT;
