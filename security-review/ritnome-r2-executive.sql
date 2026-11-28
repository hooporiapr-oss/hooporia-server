-- Ritnome institutional — R2: Institutional Executive Report data (owner/manager). Any Puerto Rico date range; same calculation layer as every other view.
CREATE FUNCTION public.ritnome_rep_executive(p_session uuid,p_price text,p_from date,p_to_excl date)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c record; today date; cut date; partial boolean; len int; prev0 date; prev1 date; prevcut date; out jsonb; fname text;
BEGIN
 SELECT * INTO c FROM public.ritnome_rep_session_check(p_session,p_price,true);
 IF NOT c.ok THEN RETURN jsonb_build_object('ok',false,'reason',c.reason); END IF;
 IF c.role NOT IN ('owner','manager') THEN RETURN jsonb_build_object('ok',false,'reason','role'); END IF;
 IF p_from IS NULL OR p_to_excl IS NULL OR p_to_excl<=p_from OR p_to_excl-p_from>400 THEN RETURN jsonb_build_object('ok',false,'reason','invalid'); END IF;
 today:=public.ritnome_pr_today();
 partial:=p_to_excl>today; cut:=CASE WHEN partial THEN least(p_to_excl,today+1) ELSE p_to_excl END;
 IF cut<=p_from THEN RETURN jsonb_build_object('ok',false,'reason','future'); END IF;
 len:=p_to_excl-p_from; prev0:=p_from-len; prev1:=p_from; prevcut:=prev0+(cut-p_from);
 SELECT e.facility_name INTO fname FROM public.ritnome_enrollment e WHERE e.livemode=c.livemode AND e.facility_id=c.facility_id;
 SELECT jsonb_build_object('ok',true,'facility',fname,'generated_at',now(),'timezone','America/Puerto_Rico','role',c.role,
  'from',p_from,'to',p_to_excl-1,'through',cut-1,'partial',partial,'days',cut-p_from,
  'planned_sessions_per_week',public.ritnome_plan_on(c.livemode,c.facility_id,cut-1),
  'summary',public.ritnome_rep_period(c.livemode,c.facility_id,p_from,cut,c.handles_enabled),
  'previous_equivalent',public.ritnome_rep_period(c.livemode,c.facility_id,prev0,prevcut,c.handles_enabled),
  'previous_full',public.ritnome_rep_period(c.livemode,c.facility_id,prev0,prev1,c.handles_enabled),
  'monthly',(SELECT coalesce(jsonb_agg(jsonb_build_object('month',to_char(mo,'YYYY-MM'),
     'sessions',(SELECT count(*) FROM public.ritnome_rep_sessions_calc(c.livemode,c.facility_id) s WHERE s.day>=mo::date AND s.day<(mo+interval '1 month')::date),
     'participations',(SELECT coalesce(sum(r.participations),0) FROM public.ritnome_rep_runs_calc(c.livemode,c.facility_id) r WHERE r.day>=mo::date AND r.day<(mo+interval '1 month')::date),
     'recreation_minutes',(SELECT coalesce(sum(s.minutes),0) FROM public.ritnome_rep_sessions_calc(c.livemode,c.facility_id) s WHERE s.day>=mo::date AND s.day<(mo+interval '1 month')::date),
     'planned_sessions',public.ritnome_rep_planned(c.livemode,c.facility_id,mo::date,least((mo+interval '1 month')::date,today+1))) ORDER BY mo),'[]'::jsonb)
   FROM generate_series(date_trunc('month',(cut-1)::timestamp)-interval '5 months',date_trunc('month',(cut-1)::timestamp),interval '1 month') mo),
  'weekly',(SELECT coalesce(jsonb_agg(jsonb_build_object('week',wk::date,
     'sessions',(SELECT count(*) FROM public.ritnome_rep_sessions_calc(c.livemode,c.facility_id) s WHERE s.day>=greatest(wk::date,p_from) AND s.day<least(wk::date+7,cut)),
     'participations',(SELECT coalesce(sum(r.participations),0) FROM public.ritnome_rep_runs_calc(c.livemode,c.facility_id) r WHERE r.day>=greatest(wk::date,p_from) AND r.day<least(wk::date+7,cut)),
     'planned',public.ritnome_rep_planned(c.livemode,c.facility_id,greatest(wk::date,p_from),least(wk::date+7,cut)),'partial',(wk::date<p_from OR wk::date+7>cut)) ORDER BY wk),'[]'::jsonb)
   FROM generate_series(date_trunc('week',p_from::timestamp),date_trunc('week',(cut-1)::timestamp),interval '7 days') wk),
  'activities',(SELECT coalesce(jsonb_agg(jsonb_build_object('activity',q.activity_key,'runs',q.n,'participations',q.pp,'minutes',q.mins) ORDER BY q.n DESC,q.pp DESC),'[]'::jsonb)
   FROM (SELECT r.activity_key,count(*) n,sum(r.participations) pp,round(sum(r.minutes),0) mins FROM public.ritnome_rep_runs_calc(c.livemode,c.facility_id) r WHERE r.day>=p_from AND r.day<cut GROUP BY r.activity_key) q),
  'by_mode',(SELECT coalesce(jsonb_object_agg(q.mode,q.n),'{}'::jsonb) FROM (SELECT r.mode,count(*) n FROM public.ritnome_rep_runs_calc(c.livemode,c.facility_id) r WHERE r.day>=p_from AND r.day<cut GROUP BY r.mode) q),
  'sessions_by_source',(SELECT coalesce(jsonb_object_agg(q.source,q.n),'{}'::jsonb) FROM (SELECT s.source,count(*) n FROM public.ritnome_rep_sessions_calc(c.livemode,c.facility_id) s WHERE s.day>=p_from AND s.day<cut GROUP BY s.source) q),
  'avg_session_minutes',(SELECT coalesce(round(avg(s.minutes),1),0) FROM public.ritnome_rep_sessions_calc(c.livemode,c.facility_id) s WHERE s.day>=p_from AND s.day<cut),
  'avg_headcount',(SELECT coalesce(round(avg(s.headcount),1),0) FROM public.ritnome_rep_sessions_calc(c.livemode,c.facility_id) s WHERE s.day>=p_from AND s.day<cut),
  'busiest_weekday',(SELECT q.dow FROM (SELECT extract(isodow FROM s.day)::int dow,count(*) n FROM public.ritnome_rep_sessions_calc(c.livemode,c.facility_id) s WHERE s.day>=p_from AND s.day<cut GROUP BY 1 ORDER BY n DESC,dow LIMIT 1) q)
 ) INTO out;
 RETURN out;
END $$;
REVOKE ALL ON FUNCTION public.ritnome_rep_executive(uuid,text,date,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ritnome_rep_executive(uuid,text,date,date) TO service_role;
