-- Ritnome institutional — R3: Recreation Program Record (owner/manager/facilitator may read; facility scoped). Chronological, Puerto Rico time,
-- same calculation layer as the executive report. Settings come from the run's own events (setting / group_bpm / levels) when the activity recorded them.
CREATE FUNCTION public.ritnome_rep_record(p_session uuid,p_price text,p_from date,p_to_excl date)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c record; today date; cut date; partial boolean; fname text; ftype text; out jsonb;
BEGIN
 SELECT * INTO c FROM public.ritnome_rep_session_check(p_session,p_price,true);
 IF NOT c.ok THEN RETURN jsonb_build_object('ok',false,'reason',c.reason); END IF;
 IF p_from IS NULL OR p_to_excl IS NULL OR p_to_excl<=p_from OR p_to_excl-p_from>400 THEN RETURN jsonb_build_object('ok',false,'reason','invalid'); END IF;
 today:=public.ritnome_pr_today();
 partial:=p_to_excl>today; cut:=CASE WHEN partial THEN least(p_to_excl,today+1) ELSE p_to_excl END;
 IF cut<=p_from THEN RETURN jsonb_build_object('ok',false,'reason','future'); END IF;
 SELECT e.facility_name,e.facility_type INTO fname,ftype FROM public.ritnome_enrollment e WHERE e.livemode=c.livemode AND e.facility_id=c.facility_id;
 SELECT jsonb_build_object('ok',true,'facility',fname,'facility_type',ftype,'generated_at',now(),'timezone','America/Puerto_Rico','role',c.role,
  'from',p_from,'to',p_to_excl-1,'through',cut-1,'partial',partial,
  'summary',public.ritnome_rep_period(c.livemode,c.facility_id,p_from,cut,c.handles_enabled),
  'sessions',(SELECT coalesce(jsonb_agg(jsonb_build_object('key',s.session_key,'day',s.day,'started_at',s.started_at,'ended_at',s.ended_at,'source',s.source,'status',s.status,'estimated',s.estimated,
      'minutes',s.minutes,'runs',s.runs,'participations',s.participations,'headcount',s.headcount,
      'activities',(SELECT coalesce(jsonb_agg(jsonb_build_object('run_id',r.run_id,'activity',r.activity_key,'mode',r.mode,'started_at',r.started_at,'ended_at',r.ended_at,'minutes',r.minutes,'headcount',r.headcount,'participations',r.participations,'status',r.status,
          'settings',(SELECT jsonb_strip_nulls(jsonb_build_object('setting',max(e.payload->>'setting'),'group_bpm',max((e.payload->>'group_bpm')::numeric),'levels',max((e.payload->>'levels')::numeric),'language',max(e.payload->>'language'))) FROM public.ritnome_activity_event e WHERE e.run_id=r.run_id)) ORDER BY r.started_at),'[]'::jsonb)
        FROM public.ritnome_rep_runs_calc(c.livemode,c.facility_id) r WHERE (s.recreation_session_id IS NOT NULL AND r.recreation_session_id=s.recreation_session_id) OR (s.recreation_session_id IS NULL AND r.recreation_session_id IS NULL AND r.started_at>=s.started_at AND r.started_at<=s.ended_at AND r.session_id::text=split_part(s.session_key,':',2)))
     ) ORDER BY s.started_at),'[]'::jsonb)
   FROM public.ritnome_rep_sessions_calc(c.livemode,c.facility_id) s WHERE s.day>=p_from AND s.day<cut),
  'days',(SELECT coalesce(jsonb_agg(jsonb_build_object('day',d::date,'planned_per_week',public.ritnome_plan_on(c.livemode,c.facility_id,d::date),
      'sessions',(SELECT count(*) FROM public.ritnome_rep_sessions_calc(c.livemode,c.facility_id) s WHERE s.day=d::date),
      'runs',(SELECT count(*) FROM public.ritnome_rep_runs_calc(c.livemode,c.facility_id) r WHERE r.day=d::date),
      'minutes',(SELECT coalesce(sum(s.minutes),0) FROM public.ritnome_rep_sessions_calc(c.livemode,c.facility_id) s WHERE s.day=d::date),
      'participations',(SELECT coalesce(sum(r.participations),0) FROM public.ritnome_rep_runs_calc(c.livemode,c.facility_id) r WHERE r.day=d::date)) ORDER BY d),'[]'::jsonb)
   FROM generate_series(p_from,cut-1,interval '1 day') d),
  'weekly',(SELECT coalesce(jsonb_agg(jsonb_build_object('week',wk::date,'from',greatest(wk::date,p_from),'to',least(wk::date+7,cut)-1,
      'sessions',(SELECT count(*) FROM public.ritnome_rep_sessions_calc(c.livemode,c.facility_id) s WHERE s.day>=greatest(wk::date,p_from) AND s.day<least(wk::date+7,cut)),
      'planned',public.ritnome_rep_planned(c.livemode,c.facility_id,greatest(wk::date,p_from),least(wk::date+7,cut)),'partial',(wk::date<p_from OR wk::date+7>cut)) ORDER BY wk),'[]'::jsonb)
   FROM generate_series(date_trunc('week',p_from::timestamp),date_trunc('week',(cut-1)::timestamp),interval '7 days') wk),
  'plan_history',(SELECT coalesce(jsonb_agg(jsonb_build_object('effective_from',h.effective_from,'sessions_per_week',h.sessions_per_week) ORDER BY h.effective_from),'[]'::jsonb) FROM public.ritnome_facility_plan_history h WHERE h.livemode=c.livemode AND h.facility_id=c.facility_id AND h.effective_from<cut)
 ) INTO out;
 RETURN out;
END $$;
REVOKE ALL ON FUNCTION public.ritnome_rep_record(uuid,text,date,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ritnome_rep_record(uuid,text,date,date) TO service_role;
