-- Run after the enrollment migration; verified in sandbox only.
BEGIN;
CREATE OR REPLACE FUNCTION public.ritnome_institution_authorized(p_mode boolean,p_user uuid,p_session uuid,p_price text) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT p_mode IS NOT NULL AND p_user IS NOT NULL AND p_session IS NOT NULL AND p_price IS NOT NULL
 AND ritnome_private.session_valid(p_user,p_session)
 AND EXISTS(
 SELECT 1 FROM public.ritnome_institution_memberships m
 JOIN public.ritnome_subscription_registry b ON b.livemode=m.livemode AND b.facility_id=m.facility_id
 LEFT JOIN public.licenses l ON l.id=b.license_id
 WHERE m.livemode=p_mode AND m.user_id=p_user AND m.active
 AND b.stripe_price_id=p_price AND b.billing_status IN ('active','past_due','unpaid','canceled')
 AND b.paid_through>now()
 AND NOT EXISTS(SELECT 1 FROM public.ritnome_enrollment e WHERE e.livemode=m.livemode AND e.facility_id=m.facility_id AND NOT e.enabled)
 AND ((NOT p_mode AND b.license_id IS NULL) OR (p_mode AND l.id IS NOT NULL AND l.product='ritnome_institutional' AND l.active AND (l.expires_at IS NULL OR l.expires_at >= (now() AT TIME ZONE 'UTC')::date)))
 AND NOT EXISTS(SELECT 1 FROM public.ritnome_stripe_inbox i WHERE i.livemode=b.livemode AND i.subscription_id=b.stripe_subscription_id AND i.processed_at IS NULL AND i.event_type IN ('charge.refunded','charge.dispute.created'))
 );
$$;
COMMIT;
