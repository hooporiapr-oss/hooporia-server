-- Live-only enrollment extension. Apply only after approved base Ritnome schema and legacy security release.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='licenses' AND 'authenticated'=ANY(roles) AND (qual='true' OR with_check='true')) THEN RAISE EXCEPTION 'Legacy license permissions must be hardened first'; END IF;
 IF has_table_privilege('anon','public.licenses','SELECT') OR has_any_column_privilege('anon','public.licenses','SELECT') THEN RAISE EXCEPTION 'Unexpected anonymous license grant'; END IF;
END $$;
ALTER TABLE public.ritnome_enrollment ADD COLUMN approved_license_id uuid UNIQUE REFERENCES public.licenses(id) ON DELETE RESTRICT;
ALTER TABLE public.ritnome_enrollment ADD CONSTRAINT ritnome_enrollment_live_license_required CHECK(NOT livemode OR approved_license_id IS NOT NULL);
CREATE FUNCTION public.ritnome_live_claim_checkout(p_owner uuid,p_session uuid) RETURNS SETOF public.ritnome_enrollment LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NOT ritnome_private.session_valid(p_owner,p_session) THEN RETURN; END IF;
 RETURN QUERY UPDATE public.ritnome_enrollment e SET checkout_started_at=coalesce(e.checkout_started_at,now())
 WHERE e.livemode=true AND e.owner_id=p_owner AND e.enabled
 AND EXISTS(SELECT 1 FROM public.licenses l WHERE l.id=e.approved_license_id AND l.product='ritnome_institutional' AND l.active AND (l.expires_at IS NULL OR l.expires_at >= (now() AT TIME ZONE 'UTC')::date))
 AND NOT EXISTS(SELECT 1 FROM public.ritnome_subscription_registry b WHERE b.livemode=true AND b.facility_id=e.facility_id)
 RETURNING e.*;
END;
$$;
REVOKE ALL ON FUNCTION public.ritnome_live_claim_checkout(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ritnome_live_claim_checkout(uuid,uuid) TO service_role;
CREATE FUNCTION public.ritnome_live_bind_checkout(p_owner uuid,p_session uuid,p_checkout text,p_customer text,p_subscription text,p_price text) RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE e public.ritnome_enrollment%ROWTYPE; b public.ritnome_subscription_registry%ROWTYPE;
BEGIN
 IF NOT ritnome_private.session_valid(p_owner,p_session) THEN RETURN 'denied'; END IF;
 IF p_checkout IS NULL OR p_checkout !~ '^cs_live_[A-Za-z0-9]+$' OR p_price IS DISTINCT FROM 'price_1UgP8ZCuedlcmwMmeEZr9ev2' THEN RETURN 'denied'; END IF;
 SELECT * INTO e FROM public.ritnome_enrollment WHERE livemode=true AND owner_id=p_owner FOR UPDATE;
 IF NOT FOUND OR NOT e.enabled OR e.checkout_session_id IS DISTINCT FROM p_checkout THEN RETURN 'denied'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.licenses l WHERE l.id=e.approved_license_id AND l.product='ritnome_institutional' AND l.active AND (l.expires_at IS NULL OR l.expires_at >= (now() AT TIME ZONE 'UTC')::date)) THEN RETURN 'denied'; END IF;
 SELECT * INTO b FROM public.ritnome_subscription_registry WHERE livemode=true AND facility_id=e.facility_id FOR UPDATE;
 IF FOUND THEN
 IF b.stripe_subscription_id=p_subscription AND b.stripe_customer_id=p_customer AND b.stripe_price_id=p_price AND b.license_id=e.approved_license_id AND e.stripe_customer_id=p_customer THEN RETURN 'already_bound'; END IF;
 RETURN 'conflict';
 END IF;
 IF EXISTS(SELECT 1 FROM public.ritnome_institution_memberships WHERE livemode=true AND user_id=p_owner) THEN RETURN 'conflict'; END IF;
 INSERT INTO public.ritnome_subscription_registry(livemode,facility_id,stripe_customer_id,stripe_subscription_id,stripe_price_id,license_id) VALUES(true,e.facility_id,p_customer,p_subscription,p_price,e.approved_license_id);
 INSERT INTO public.ritnome_institution_memberships(livemode,user_id,facility_id,active) VALUES(true,p_owner,e.facility_id,true);
 UPDATE public.ritnome_enrollment SET stripe_customer_id=p_customer WHERE livemode=true AND owner_id=p_owner;
 RETURN 'bound';
END;
$$;
REVOKE ALL ON FUNCTION public.ritnome_live_bind_checkout(uuid,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ritnome_live_bind_checkout(uuid,uuid,text,text,text,text) TO service_role;
COMMIT;
