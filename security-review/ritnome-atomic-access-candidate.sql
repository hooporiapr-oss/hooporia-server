-- Sandbox only; separate live release review required. Auth session lookup is private and callable only by backend role.
BEGIN;
CREATE SCHEMA ritnome_private;
REVOKE ALL ON SCHEMA ritnome_private FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA ritnome_private TO service_role;
CREATE FUNCTION ritnome_private.session_valid(p_user uuid,p_session uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id=p_session AND s.user_id=p_user AND (s.not_after IS NULL OR s.not_after>now()));
$$;
REVOKE ALL ON FUNCTION ritnome_private.session_valid(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION ritnome_private.session_valid(uuid,uuid) TO service_role;
CREATE FUNCTION public.ritnome_institution_authorized(p_mode boolean,p_user uuid,p_session uuid,p_price text) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT p_mode IS NOT NULL AND p_user IS NOT NULL AND p_session IS NOT NULL AND p_price IS NOT NULL
 AND ritnome_private.session_valid(p_user,p_session)
 AND EXISTS(
 SELECT 1 FROM public.ritnome_institution_memberships m
 JOIN public.ritnome_subscription_registry b ON b.livemode=m.livemode AND b.facility_id=m.facility_id
 LEFT JOIN public.licenses l ON l.id=b.license_id
 WHERE m.livemode=p_mode AND m.user_id=p_user AND m.active
 AND b.stripe_price_id=p_price AND b.billing_status IN ('active','past_due','unpaid','canceled')
 AND b.paid_through>now()
 AND ((NOT p_mode AND b.license_id IS NULL) OR (p_mode AND l.id IS NOT NULL AND l.product='ritnome_institutional' AND l.active AND (l.expires_at IS NULL OR l.expires_at >= (now() AT TIME ZONE 'UTC')::date)))
 AND NOT EXISTS(SELECT 1 FROM public.ritnome_stripe_inbox i WHERE i.livemode=b.livemode AND i.subscription_id=b.stripe_subscription_id AND i.processed_at IS NULL AND i.event_type IN ('charge.refunded','charge.dispute.created'))
 );
$$;
REVOKE ALL ON FUNCTION public.ritnome_institution_authorized(boolean,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ritnome_institution_authorized(boolean,uuid,uuid,text) TO service_role;
COMMIT;
