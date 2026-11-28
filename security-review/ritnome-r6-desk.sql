-- Ritnome institutional — R6: desk weekly table limited to the selected month (same rule as the Executive Report and the Program Record).
-- Before: a week crossing the month boundary counted completed sessions from outside the month (planned was already limited),
-- so weekly rows could add up to more than the monthly total. Read-only function; no data change.
CREATE OR REPLACE FUNCTION public.ritnome_rep_management(p_session uuid,p_price text,p_month date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c record; m0 date; m1 date; today date; cut date; partial boolean; prev0 date; prev1 date; prevcut date; out jsonb;
BEGIN
 SELECT * INTO c FROM public.ritnome_rep_session_check(p_session,p_price,true);
 IF NOT c.ok THEN RETURN jsonb_build_object('ok',false,'reason',c.reason); END IF;
 IF c.role NOT IN ('owner','manager') THEN RETURN jsonb_build_object('ok',false,'reason','role'); END IF;
 today:=public.ritnome_pr_today();
 m0:=date_trunc('month',coalesce(p_month,today))::date; m1:=(m0+interval '1 month')::date;
 partial:=m1>today; cut:=CASE WHEN partial THEN least(m1,today+1) ELSE m1 END;
 prev0:=(m0-interval '1 month')::date; prev1:=m0; prevcut:=CASE WHEN partial THEN least(prev1,prev0+(cut-m0)) ELSE prev1 END;
 SELECT jsonb_build_object('ok',true,'month',to_char(m0,'YYYY-MM'),'timezone','America/Puerto_Rico','partial',partial,'through',cut-1,
  'planned_sessions_per_week',public.ritnome_plan_on(c.livemode,c.facility_id,cut-1),
  'summary',public.ritnome_rep_period(c.livemode,c.facility_id,m0,cut,c.handles_enabled),
  'previous_equivalent',public.ritnome_rep_period(c.livemode,c.facility_id,prev0,prevcut,c.handles_enabled),
  'previous_month',public.ritnome_rep_period(c.livemode,c.facility_id,prev0,prev1,c.handles_enabled),
  'trend',(SELECT coalesce(jsonb_agg(jsonb_build_object('month',to_char(mo,'YYYY-MM'),'sessions',(SELECT count(*) FROM public.ritnome_rep_sessions_calc(c.livemode,c.facility_id) s WHERE s.day>=mo::date AND s.day<(mo+interval '1 month')::date),
     'participations',(SELECT coalesce(sum(r.participations),0) FROM public.ritnome_rep_runs_calc(c.livemode,c.facility_id) r WHERE r.day>=mo::date AND r.day<(mo+interval '1 month')::date),
     'recreation_minutes',(SELECT coalesce(sum(s.minutes),0) FROM public.ritnome_rep_sessions_calc(c.livemode,c.facility_id) s WHERE s.day>=mo::date AND s.day<(mo+interval '1 month')::date),
     'planned_sessions',public.ritnome_rep_planned(c.livemode,c.facility_id,mo::date,least((mo+interval '1 month')::date,today+1))) ORDER BY mo),'[]'::jsonb)
   FROM generate_series(m0-interval '5 months',m0,interval '1 month') mo),
  'popular_activities',(SELECT coalesce(jsonb_agg(jsonb_build_object('activity',q.activity_key,'runs',q.n,'participations',q.pp) ORDER BY q.n DESC,q.pp DESC),'[]'::jsonb)
   FROM (SELECT r.activity_key,count(*) n,sum(r.participations) pp FROM public.ritnome_rep_runs_calc(c.livemode,c.facility_id) r WHERE r.day>=m0 AND r.day<cut GROUP BY r.activity_key ORDER BY n DESC LIMIT 10) q),
  'categories',(SELECT coalesce(jsonb_agg(DISTINCT r.activity_key),'[]'::jsonb) FROM public.ritnome_rep_runs_calc(c.livemode,c.facility_id) r WHERE r.day>=m0 AND r.day<cut),
  'weekly',(SELECT coalesce(jsonb_agg(jsonb_build_object('week',wk::date,'from',greatest(wk::date,m0),'to',least(wk::date+7,cut)-1,
     'sessions',(SELECT count(*) FROM public.ritnome_rep_sessions_calc(c.livemode,c.facility_id) s WHERE s.day>=greatest(wk::date,m0) AND s.day<least(wk::date+7,cut)),
     'planned',public.ritnome_rep_planned(c.livemode,c.facility_id,greatest(wk::date,m0),least(wk::date+7,cut)),'partial',(wk::date<m0 OR wk::date+7>cut)) ORDER BY wk),'[]'::jsonb)
   FROM generate_series(date_trunc('week',m0::timestamp),date_trunc('week',(cut-1)::timestamp),interval '7 days') wk)) INTO out;
 RETURN out;
END $$;
REVOKE ALL ON FUNCTION public.ritnome_rep_management(uuid,text,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ritnome_rep_management(uuid,text,date) TO service_role;
