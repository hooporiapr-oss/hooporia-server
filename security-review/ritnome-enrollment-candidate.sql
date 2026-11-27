-- Sandbox pilot: preapproved owner, one facility, one checkout. No live binding.
BEGIN;
CREATE TABLE public.ritnome_enrollment (
 livemode boolean NOT NULL,
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 facility_id uuid NOT NULL DEFAULT gen_random_uuid(),
 facility_name text NOT NULL CHECK(char_length(trim(facility_name)) BETWEEN 1 AND 100),
 facility_type text NOT NULL CHECK(facility_type IN ('residence','assisted','day')),
 enabled boolean NOT NULL DEFAULT true,
 checkout_started_at timestamptz,
 checkout_session_id text CHECK(checkout_session_id ~ '^cs_(test|live)_[A-Za-z0-9]+$'),
 stripe_customer_id text CHECK(stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(livemode,owner_id),UNIQUE(livemode,facility_id),UNIQUE(checkout_session_id),UNIQUE(livemode,stripe_customer_id)
);
ALTER TABLE public.ritnome_enrollment ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ritnome_enrollment FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.ritnome_enrollment TO service_role;
CREATE FUNCTION public.ritnome_owner_session(p_user uuid,p_session uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT ritnome_private.session_valid(p_user,p_session);
$$;
REVOKE ALL ON FUNCTION public.ritnome_owner_session(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ritnome_owner_session(uuid,uuid) TO service_role;
CREATE FUNCTION public.ritnome_claim_checkout(p_owner uuid,p_session uuid) RETURNS SETOF public.ritnome_enrollment LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NOT ritnome_private.session_valid(p_owner,p_session) THEN RETURN; END IF;
 RETURN QUERY UPDATE public.ritnome_enrollment e SET checkout_started_at=coalesce(e.checkout_started_at,now()) WHERE e.livemode=false AND e.owner_id=p_owner AND e.enabled AND NOT EXISTS(SELECT 1 FROM public.ritnome_subscription_registry b WHERE b.livemode=false AND b.facility_id=e.facility_id) RETURNING e.*;
END;
$$;
REVOKE ALL ON FUNCTION public.ritnome_claim_checkout(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ritnome_claim_checkout(uuid,uuid) TO service_role;
CREATE FUNCTION public.ritnome_bind_checkout(p_owner uuid,p_session uuid,p_checkout text,p_customer text,p_subscription text,p_price text) RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE e public.ritnome_enrollment%ROWTYPE; b public.ritnome_subscription_registry%ROWTYPE;
BEGIN
 IF NOT ritnome_private.session_valid(p_owner,p_session) THEN RETURN 'denied'; END IF;
 SELECT * INTO e FROM public.ritnome_enrollment WHERE livemode=false AND owner_id=p_owner FOR UPDATE;
 IF NOT FOUND OR NOT e.enabled OR e.checkout_session_id IS DISTINCT FROM p_checkout THEN RETURN 'denied'; END IF;
 SELECT * INTO b FROM public.ritnome_subscription_registry WHERE livemode=false AND facility_id=e.facility_id FOR UPDATE;
 IF FOUND THEN
 IF b.stripe_subscription_id=p_subscription AND b.stripe_customer_id=p_customer AND b.stripe_price_id=p_price AND e.stripe_customer_id=p_customer THEN RETURN 'already_bound'; END IF;
 RETURN 'conflict';
 END IF;
 IF EXISTS(SELECT 1 FROM public.ritnome_institution_memberships WHERE livemode=false AND user_id=p_owner) THEN RETURN 'conflict'; END IF;
 INSERT INTO public.ritnome_subscription_registry(livemode,facility_id,stripe_customer_id,stripe_subscription_id,stripe_price_id) VALUES(false,e.facility_id,p_customer,p_subscription,p_price);
 INSERT INTO public.ritnome_institution_memberships(livemode,user_id,facility_id,active) VALUES(false,p_owner,e.facility_id,true);
 UPDATE public.ritnome_enrollment SET stripe_customer_id=p_customer WHERE livemode=false AND owner_id=p_owner;
 RETURN 'bound';
END;
$$;
REVOKE ALL ON FUNCTION public.ritnome_bind_checkout(uuid,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ritnome_bind_checkout(uuid,uuid,text,text,text,text) TO service_role;
COMMIT;
