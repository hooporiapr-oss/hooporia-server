-- Ritnome institutional — 14-day free trial (owner-approved 2026-11-28). Dedicated live project only.
-- A trial is a first entitlement only: billing_status 'trialing' may set paid_through once, from NULL, to at most 15 days ahead.
-- Paid rules are unchanged: nothing else may extend a non-active entitlement.
CREATE OR REPLACE FUNCTION public.ritnome_institution_authorized(p_mode boolean,p_user uuid,p_session uuid,p_price text) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT p_mode IS NOT NULL AND p_user IS NOT NULL AND p_session IS NOT NULL AND p_price IS NOT NULL
 AND ritnome_private.session_valid(p_user,p_session)
 AND EXISTS(
 SELECT 1 FROM public.ritnome_institution_memberships m
 JOIN public.ritnome_subscription_registry b ON b.livemode=m.livemode AND b.facility_id=m.facility_id
 LEFT JOIN public.licenses l ON l.id=b.license_id
 WHERE m.livemode=p_mode AND m.user_id=p_user AND m.active
 AND b.stripe_price_id=p_price AND b.billing_status IN ('active','past_due','unpaid','canceled','trialing')
 AND b.paid_through>now()
 AND NOT EXISTS(SELECT 1 FROM public.ritnome_enrollment e WHERE e.livemode=m.livemode AND e.facility_id=m.facility_id AND NOT e.enabled)
 AND ((NOT p_mode AND b.license_id IS NULL) OR (p_mode AND l.id IS NOT NULL AND l.product='ritnome_institutional' AND l.active AND (l.expires_at IS NULL OR l.expires_at >= (now() AT TIME ZONE 'UTC')::date)))
 AND NOT EXISTS(SELECT 1 FROM public.ritnome_stripe_inbox i WHERE i.livemode=b.livemode AND i.subscription_id=b.stripe_subscription_id AND i.processed_at IS NULL AND i.event_type IN ('charge.refunded','charge.dispute.created'))
 );
$$;
CREATE OR REPLACE FUNCTION public.ritnome_commit_decision(
 p_mode boolean,p_event text,p_subscription text,p_revision bigint,
 p_status text,p_paid_through timestamptz,p_decision text,p_reason text
) RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE b public.ritnome_subscription_registry%ROWTYPE;
 e public.ritnome_stripe_inbox%ROWTYPE;
BEGIN
 IF p_mode IS NULL OR p_event IS NULL OR p_subscription IS NULL OR p_revision IS NULL
 OR p_decision IS NULL OR p_status IS NULL OR p_reason IS NULL THEN RAISE EXCEPTION 'missing decision input'; END IF;
 SELECT * INTO b FROM public.ritnome_subscription_registry WHERE livemode=p_mode AND stripe_subscription_id=p_subscription FOR UPDATE;
 IF NOT FOUND THEN RETURN 'await_admin_binding'; END IF;
 SELECT * INTO e FROM public.ritnome_stripe_inbox WHERE livemode=p_mode AND stripe_event_id=p_event FOR UPDATE;
 IF NOT FOUND OR e.subscription_id<>p_subscription THEN RAISE EXCEPTION 'event binding mismatch'; END IF;
 IF e.processed_at IS NOT NULL THEN RETURN 'duplicate'; END IF;
 IF b.revision<>p_revision THEN RETURN 'retry'; END IF;
 IF p_decision NOT IN ('reconcile','review') OR (p_decision='review' AND p_status<>'review') OR (p_decision='reconcile' AND p_status NOT IN ('active','past_due','unpaid','canceled','incomplete','incomplete_expired','trialing','paused')) THEN RAISE EXCEPTION 'invalid decision'; END IF;
 IF b.paid_through IS NOT NULL AND (p_paid_through IS NULL OR p_paid_through<b.paid_through) THEN RAISE EXCEPTION 'paid period regression'; END IF;
 -- Trial: the one allowed non-active extension — first entitlement only (from NULL), at most 15 days ahead, status 'trialing'.
 IF p_decision='reconcile' AND p_status='trialing' AND b.paid_through IS NULL AND p_paid_through IS NOT NULL AND p_paid_through<=now()+interval '15 days' THEN NULL;
 ELSIF (p_decision='review' OR p_status IN ('past_due','unpaid','canceled','incomplete','incomplete_expired','trialing','paused')) AND p_paid_through IS DISTINCT FROM b.paid_through THEN RAISE EXCEPTION 'nonactive decision cannot extend'; END IF;
 UPDATE public.ritnome_subscription_registry SET billing_status=p_status,paid_through=p_paid_through,revision=revision+1 WHERE id=b.id;
 INSERT INTO public.ritnome_decision_audit(livemode,stripe_event_id,subscription_id,revision,billing_status,paid_through,decision,reason) VALUES(p_mode,p_event,p_subscription,b.revision+1,p_status,p_paid_through,p_decision,p_reason);
 UPDATE public.ritnome_stripe_inbox SET processed_at=now() WHERE livemode=p_mode AND stripe_event_id=p_event;
 RETURN 'committed';
END;
$$;
