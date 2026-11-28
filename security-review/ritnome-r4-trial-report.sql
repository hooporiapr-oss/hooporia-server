-- Ritnome institutional — R4: the facility's trial window for the Trial Value Report (owner/manager). No billing change: read-only.
CREATE FUNCTION public.ritnome_rep_trial_window(p_session uuid,p_price text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c record; b record; d0 date; d1 date; trialing boolean;
BEGIN
 SELECT * INTO c FROM public.ritnome_rep_session_check(p_session,p_price,false);
 IF NOT c.ok THEN RETURN jsonb_build_object('ok',false,'reason',c.reason); END IF;
 IF c.role NOT IN ('owner','manager') THEN RETURN jsonb_build_object('ok',false,'reason','role'); END IF;
 SELECT * INTO b FROM public.ritnome_subscription_registry x WHERE x.livemode=c.livemode AND x.facility_id=c.facility_id AND x.stripe_price_id=p_price;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','no_subscription'); END IF;
 trialing:=b.billing_status='trialing';
 d0:=public.ritnome_pr_date(b.created_at);
 d1:=CASE WHEN trialing AND b.paid_through IS NOT NULL THEN public.ritnome_pr_date(b.paid_through) ELSE d0+14 END;
 RETURN jsonb_build_object('ok',true,'trialing',trialing,'from',d0,'to_excl',d1,'trial_end',CASE WHEN trialing THEN b.paid_through ELSE NULL END,'days_left',CASE WHEN trialing THEN greatest(0,d1-public.ritnome_pr_today()) ELSE 0 END);
END $$;
REVOKE ALL ON FUNCTION public.ritnome_rep_trial_window(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ritnome_rep_trial_window(uuid,text) TO service_role;
