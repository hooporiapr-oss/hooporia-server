-- Dedicated Ritnome live project ONLY. Do not run in the shared production or sandbox project.
BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_tables WHERE schemaname='public' AND tablename IN ('licenses','ritnome_subscription_registry','bm_players','bm_campaigns')) THEN RAISE EXCEPTION 'Expected a new dedicated Ritnome project'; END IF;
END $$;
CREATE TABLE public.licenses(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 code text NOT NULL UNIQUE,
 school_name text NOT NULL,
 product text NOT NULL CHECK(product='ritnome_institutional'),
 active boolean NOT NULL DEFAULT true,
 expires_at date,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.licenses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.licenses FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.licenses TO service_role;
COMMIT;
