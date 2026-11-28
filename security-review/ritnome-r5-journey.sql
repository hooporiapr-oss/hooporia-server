-- Ritnome institutional — R5: Mi Trayectoria / My Personal Journey (owner/manager; facility's own handles only; handles must be enabled).
-- A recreational history: participation, activities explored, personal tempo over time, factual accomplishments. No interpretation.
CREATE FUNCTION public.ritnome_rep_journey(p_session uuid,p_price text,p_handle uuid,p_from date,p_to_excl date)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c record; h record; today date; cut date; fname text; out jsonb;
BEGIN
 SELECT * INTO c FROM public.ritnome_rep_session_check(p_session,p_price,true);
 IF NOT c.ok THEN RETURN jsonb_build_object('ok',false,'reason',c.reason); END IF;
 IF c.role NOT IN ('owner','manager') THEN RETURN jsonb_build_object('ok',false,'reason','role'); END IF;
 IF NOT c.handles_enabled THEN RETURN jsonb_build_object('ok',false,'reason','handles_off'); END IF;
 SELECT * INTO h FROM public.ritnome_participant_handle x WHERE x.handle_id=p_handle AND x.livemode=c.livemode AND x.facility_id=c.facility_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','no_handle'); END IF;
 IF p_from IS NULL OR p_to_excl IS NULL OR p_to_excl<=p_from OR p_to_excl-p_from>400 THEN RETURN jsonb_build_object('ok',false,'reason','invalid'); END IF;
 today:=public.ritnome_pr_today(); cut:=least(p_to_excl,today+1);
 IF cut<=p_from THEN RETURN jsonb_build_object('ok',false,'reason','future'); END IF;
 SELECT e.facility_name INTO fname FROM public.ritnome_enrollment e WHERE e.livemode=c.livemode AND e.facility_id=c.facility_id;
 WITH p AS (
  SELECT pr.*, public.ritnome_pr_date(pr.recorded_at) AS day, r.mode, r.recreation_session_id
  FROM public.ritnome_participant_progress pr JOIN public.ritnome_activity_run r ON r.run_id=pr.run_id
  WHERE pr.handle_id=p_handle AND r.livemode=c.livemode AND r.facility_id=c.facility_id AND r.status<>'abandoned'
 ), inp AS (SELECT * FROM p WHERE day>=p_from AND day<cut)
 SELECT jsonb_build_object('ok',true,'facility',fname,'generated_at',now(),'timezone','America/Puerto_Rico',
  'handle_id',p_handle,'handle_created',h.created_at,'retired_at',h.retired_at,
  'from',p_from,'to',p_to_excl-1,'through',cut-1,'partial',p_to_excl>today,
  'lifetime',(SELECT jsonb_build_object('first',min(day),'last',max(day),'sessions',count(DISTINCT coalesce(recreation_session_id::text,run_id::text)),'activities',count(DISTINCT activity_key),'entries',count(*)) FROM p),
  'summary',(SELECT jsonb_build_object('entries',count(*),'sessions',count(DISTINCT coalesce(recreation_session_id::text,run_id::text)),'active_days',count(DISTINCT day),'activities',count(DISTINCT activity_key),
     'minutes',coalesce(round(sum(minutes)::numeric,1),0),'new_activities',(SELECT count(DISTINCT i.activity_key) FROM inp i WHERE NOT EXISTS(SELECT 1 FROM p o WHERE o.activity_key=i.activity_key AND o.day<p_from)),
     'tempo_min',min(personal_bpm),'tempo_max',max(personal_bpm),'tempo_n',count(personal_bpm)) FROM inp),
  'months',(SELECT coalesce(jsonb_agg(jsonb_build_object('month',to_char(mo,'YYYY-MM'),'sessions',(SELECT count(DISTINCT coalesce(x.recreation_session_id::text,x.run_id::text)) FROM p x WHERE x.day>=mo::date AND x.day<(mo+interval '1 month')::date),'entries',(SELECT count(*) FROM p x WHERE x.day>=mo::date AND x.day<(mo+interval '1 month')::date)) ORDER BY mo),'[]'::jsonb)
   FROM generate_series(date_trunc('month',(cut-1)::timestamp)-interval '5 months',date_trunc('month',(cut-1)::timestamp),interval '1 month') mo),
  'tempo',(SELECT coalesce(jsonb_agg(jsonb_build_object('at',recorded_at,'day',day,'activity',activity_key,'setting',setting,'bpm',personal_bpm) ORDER BY recorded_at),'[]'::jsonb) FROM inp WHERE personal_bpm IS NOT NULL),
  'by_activity',(SELECT coalesce(jsonb_agg(jsonb_build_object('activity',q.activity_key,'setting',q.setting,'entries',q.n,'first_day',q.d0,'last_day',q.d1,
      'tempo_first',q.t_first,'tempo_typical',q.t_med,'tempo_latest',q.t_last,'tempo_n',q.tn,'first_result',q.r_first,'latest_result',q.r_last,'max_level',q.lv) ORDER BY q.n DESC,q.activity_key,q.setting),'[]'::jsonb)
   FROM (SELECT a.activity_key,a.setting,count(*) n,min(a.day) d0,max(a.day) d1,count(a.personal_bpm) tn,
       (SELECT x.personal_bpm FROM inp x WHERE x.activity_key=a.activity_key AND x.setting=a.setting AND x.personal_bpm IS NOT NULL ORDER BY x.recorded_at LIMIT 1) t_first,
       (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY x.personal_bpm) FROM inp x WHERE x.activity_key=a.activity_key AND x.setting=a.setting AND x.personal_bpm IS NOT NULL) t_med,
       (SELECT x.personal_bpm FROM inp x WHERE x.activity_key=a.activity_key AND x.setting=a.setting AND x.personal_bpm IS NOT NULL ORDER BY x.recorded_at DESC LIMIT 1) t_last,
       (SELECT x.result FROM inp x WHERE x.activity_key=a.activity_key AND x.setting=a.setting ORDER BY x.recorded_at LIMIT 1) r_first,
       (SELECT x.result FROM inp x WHERE x.activity_key=a.activity_key AND x.setting=a.setting ORDER BY x.recorded_at DESC LIMIT 1) r_last,
       (SELECT max((x.result->>'level')::numeric) FROM inp x WHERE x.activity_key=a.activity_key AND x.setting=a.setting AND jsonb_typeof(x.result->'level')='number') lv
      FROM inp a GROUP BY a.activity_key,a.setting) q),
  'history',(SELECT coalesce(jsonb_agg(jsonb_build_object('at',recorded_at,'day',day,'activity',activity_key,'setting',setting,'mode',mode,'minutes',minutes,'bpm',personal_bpm,'result',result) ORDER BY recorded_at DESC),'[]'::jsonb) FROM (SELECT * FROM inp ORDER BY recorded_at DESC LIMIT 120) z)
 ) INTO out;
 RETURN out;
END $$;
REVOKE ALL ON FUNCTION public.ritnome_rep_journey(uuid,text,uuid,date,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ritnome_rep_journey(uuid,text,uuid,date,date) TO service_role;
