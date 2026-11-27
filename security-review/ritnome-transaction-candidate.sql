-- Phase 10B candidate. Sandbox validation only. No license writes.
BEGIN;
ALTER TABLE public.ritnome_subscription_registry ADD COLUMN revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0);
CREATE TABLE public.ritnome_decision_audit (
 livemode boolean NOT NULL,
 stripe_event_id text NOT NULL,
 subscription_id text NOT NULL,
 revision bigint NOT NULL,
 billing_status text NOT NULL,
 paid_through timestamptz,
 decision text NOT NULL CHECK(decision IN ('reconcile','review')),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 128),
 recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(livemode,stripe_event_id),
 FOREIGN KEY(livemode,stripe_event_id) REFERENCES public.ritnome_stripe_inbox(livemode,stripe_event_id)
);
ALTER TABLE public.ritnome_decision_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ritnome_decision_audit FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.ritnome_decision_audit TO service_role;
CREATE FUNCTION public.ritnome_commit_decision(
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
 IF (p_decision='review' OR p_status IN ('past_due','unpaid','canceled','incomplete','incomplete_expired','trialing','paused')) AND p_paid_through IS DISTINCT FROM b.paid_through THEN RAISE EXCEPTION 'nonactive decision cannot extend'; END IF;
 UPDATE public.ritnome_subscription_registry SET billing_status=p_status,paid_through=p_paid_through,revision=revision+1 WHERE id=b.id;
 INSERT INTO public.ritnome_decision_audit(livemode,stripe_event_id,subscription_id,revision,billing_status,paid_through,decision,reason) VALUES(p_mode,p_event,p_subscription,b.revision+1,p_status,p_paid_through,p_decision,p_reason);
 UPDATE public.ritnome_stripe_inbox SET processed_at=now() WHERE livemode=p_mode AND stripe_event_id=p_event;
 RETURN 'committed';
END;
$$;
REVOKE ALL ON FUNCTION public.ritnome_commit_decision(boolean,text,text,bigint,text,timestamptz,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ritnome_commit_decision(boolean,text,text,bigint,text,timestamptz,text,text) TO service_role;
COMMIT;
