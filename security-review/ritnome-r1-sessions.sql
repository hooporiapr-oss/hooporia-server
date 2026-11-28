-- Ritnome institutional — R1: reporting accuracy foundation (owner-approved 2026-11-28).
-- 1) Facilitated recreation session = parent of activity runs (created when Today's Session starts; standalone launches get their own).
-- 2) All reporting periods in America/Puerto_Rico. 3) Planned targets keep history (effective dates). 4) Sessions, runs and participations are distinct.
-- Nothing is dropped; existing rows keep working (runs without a parent are grouped by a 45-minute rule and labeled as estimates).
CREATE TABLE public.ritnome_recreation_session(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 livemode boolean NOT NULL,
 facility_id uuid NOT NULL,
 session_id uuid NOT NULL REFERENCES public.ritnome_facility_session(id) ON DELETE CASCADE,
 facilitator_user_id uuid NOT NULL,
 source text NOT NULL DEFAULT 'plan' CHECK(source IN ('plan','standalone')),
 planned_minutes integer CHECK(planned_minutes IS NULL OR planned_minutes BETWEEN 1 AND 240),
 started_at timestamptz NOT NULL DEFAULT now(),
 ended_at timestamptz,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed','abandoned')),
 FOREIGN KEY(livemode,facility_id) REFERENCES public.ritnome_enrollment(livemode,facility_id) ON DELETE CASCADE
);
CREATE INDEX ritnome_recsession_facility_idx ON public.ritnome_recreation_session(livemode,facility_id,started_at DESC);
CREATE INDEX ritnome_recsession_open_idx ON public.ritnome_recreation_session(session_id) WHERE status='open';
ALTER TABLE public.ritnome_recreation_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ritnome_launch_code ADD COLUMN recreation_session_id uuid REFERENCES public.ritnome_recreation_session(id) ON DELETE SET NULL;
ALTER TABLE public.ritnome_activity_token ADD COLUMN recreation_session_id uuid REFERENCES public.ritnome_recreation_session(id) ON DELETE SET NULL;
ALTER TABLE public.ritnome_activity_run ADD COLUMN recreation_session_id uuid REFERENCES public.ritnome_recreation_session(id) ON DELETE SET NULL;
CREATE INDEX ritnome_run_recsession_idx ON public.ritnome_activity_run(recreation_session_id);
-- Planned target history (Puerto Rico dates). The current value stays in ritnome_facility_plan; history decides what applied to past weeks.
CREATE TABLE public.ritnome_facility_plan_history(
 livemode boolean NOT NULL,
 facility_id uuid NOT NULL,
 effective_from date NOT NULL,
 sessions_per_week integer NOT NULL CHECK(sessions_per_week BETWEEN 0 AND 50),
 set_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(livemode,facility_id,effective_from),
 FOREIGN KEY(livemode,facility_id) REFERENCES public.ritnome_enrollment(livemode,facility_id) ON DELETE CASCADE
);
ALTER TABLE public.ritnome_facility_plan_history ENABLE ROW LEVEL SECURITY;
INSERT INTO public.ritnome_facility_plan_history(livemode,facility_id,effective_from,sessions_per_week) SELECT livemode,facility_id,'2000-01-01',sessions_per_week FROM public.ritnome_facility_plan ON CONFLICT DO NOTHING;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.ritnome_recreation_session,public.ritnome_facility_plan_history TO service_role;

-- Puerto Rico helpers
CREATE FUNCTION public.ritnome_pr_date(t timestamptz) RETURNS date LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT (t AT TIME ZONE 'America/Puerto_Rico')::date $$;
CREATE FUNCTION public.ritnome_pr_today() RETURNS date LANGUAGE sql STABLE SET search_path='' AS $$ SELECT (now() AT TIME ZONE 'America/Puerto_Rico')::date $$;
-- Planned sessions per week that applied on a given Puerto Rico date (history first, then the current plan).
CREATE FUNCTION public.ritnome_plan_on(p_mode boolean,p_facility uuid,p_day date) RETURNS integer LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce((SELECT h.sessions_per_week FROM public.ritnome_facility_plan_history h WHERE h.livemode=p_mode AND h.facility_id=p_facility AND h.effective_from<=p_day ORDER BY h.effective_from DESC LIMIT 1),
                 (SELECT p.sessions_per_week FROM public.ritnome_facility_plan p WHERE p.livemode=p_mode AND p.facility_id=p_facility),0) $$;

-- Close the open recreation session of a facilitator session: closed if it has at least one non-abandoned run, abandoned otherwise.
CREATE FUNCTION public.ritnome_recsession_close(p_session uuid) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 UPDATE public.ritnome_recreation_session s SET
  ended_at=coalesce((SELECT max(coalesce(r.ended_at,r.last_event_at)) FROM public.ritnome_activity_run r WHERE r.recreation_session_id=s.id),s.started_at),
  status=CASE WHEN EXISTS(SELECT 1 FROM public.ritnome_activity_run r WHERE r.recreation_session_id=s.id AND r.status<>'abandoned') THEN 'closed' ELSE 'abandoned' END
 WHERE s.session_id=p_session AND s.status='open';
END $$;
-- Start a facilitated recreation session (Today's Session). Any open one of this facilitator closes first, so separate sessions close in time are separate.
CREATE FUNCTION public.ritnome_rep_recsession_start(p_session uuid,p_price text,p_planned_minutes integer,p_source text DEFAULT 'plan') RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c record; id uuid;
BEGIN
 SELECT * INTO c FROM public.ritnome_rep_session_check(p_session,p_price,true);
 IF NOT c.ok THEN RETURN NULL; END IF;
 PERFORM public.ritnome_recsession_close(p_session);
 INSERT INTO public.ritnome_recreation_session(livemode,facility_id,session_id,facilitator_user_id,source,planned_minutes) VALUES(c.livemode,c.facility_id,p_session,c.user_id,CASE WHEN p_source='standalone' THEN 'standalone' ELSE 'plan' END,p_planned_minutes) RETURNING ritnome_recreation_session.id INTO id;
 RETURN id;
END $$;
CREATE FUNCTION public.ritnome_rep_recsession_end(p_session uuid,p_price text) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c record;
BEGIN
 SELECT * INTO c FROM public.ritnome_rep_session_check(p_session,p_price,true);
 IF NOT c.ok THEN RETURN false; END IF;
 PERFORM public.ritnome_recsession_close(p_session);
 RETURN true;
END $$;
-- The facilitator's open recreation session, if any (for the desk).
CREATE FUNCTION public.ritnome_rep_recsession_current(p_session uuid,p_price text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c record; out jsonb;
BEGIN
 SELECT * INTO c FROM public.ritnome_rep_session_check(p_session,p_price,false);
 IF NOT c.ok THEN RETURN NULL; END IF;
 SELECT jsonb_build_object('id',s.id,'source',s.source,'planned_minutes',s.planned_minutes,'started_at',s.started_at,
   'runs',(SELECT count(*) FROM public.ritnome_activity_run r WHERE r.recreation_session_id=s.id AND r.status<>'abandoned'),
   'minutes',(SELECT coalesce(round((extract(epoch FROM (max(coalesce(r.ended_at,r.last_event_at))-min(r.started_at)))/60)::numeric,1),0) FROM public.ritnome_activity_run r WHERE r.recreation_session_id=s.id AND r.status<>'abandoned'))
  INTO out FROM public.ritnome_recreation_session s WHERE s.session_id=p_session AND s.status='open' ORDER BY s.started_at DESC LIMIT 1;
 RETURN out;
END $$;

DROP FUNCTION public.ritnome_rep_launch_create(uuid,text,text,text,text);
-- Launch: joins the facilitator's open recreation session (the one passed, or any open one); with none open, a standalone single-activity session is created.
CREATE FUNCTION public.ritnome_rep_launch_create(p_session uuid,p_price text,p_activity text,p_origin text,p_code_hash text,p_recsession uuid DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c record; rs uuid;
BEGIN
 SELECT * INTO c FROM public.ritnome_rep_session_check(p_session,p_price,true);
 IF NOT c.ok THEN RETURN false; END IF;
 SELECT s.id INTO rs FROM public.ritnome_recreation_session s WHERE s.session_id=p_session AND s.status='open' AND (p_recsession IS NULL OR s.id=p_recsession) ORDER BY s.started_at DESC LIMIT 1;
 IF rs IS NULL THEN
  INSERT INTO public.ritnome_recreation_session(livemode,facility_id,session_id,facilitator_user_id,source) VALUES(c.livemode,c.facility_id,p_session,c.user_id,'standalone') RETURNING id INTO rs;
 END IF;
 INSERT INTO public.ritnome_launch_code(code_hash,session_id,activity_key,origin,recreation_session_id) VALUES(p_code_hash,p_session,p_activity,p_origin,rs);
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.ritnome_rep_launch_exchange(p_code_hash text,p_origin text,p_token_hash text,p_price text)
RETURNS TABLE(ok boolean,reason text,activity_key text,language text,handles_enabled boolean,expires_at timestamptz) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE l public.ritnome_launch_code%ROWTYPE; c record; s public.ritnome_facility_session%ROWTYPE;
BEGIN
 SELECT * INTO l FROM public.ritnome_launch_code x WHERE x.code_hash=p_code_hash FOR UPDATE;
 IF NOT FOUND THEN RETURN QUERY SELECT false,'invalid',NULL::text,NULL::text,false,NULL::timestamptz; RETURN; END IF;
 IF l.consumed_at IS NOT NULL THEN RETURN QUERY SELECT false,'used',NULL::text,NULL::text,false,NULL::timestamptz; RETURN; END IF;
 UPDATE public.ritnome_launch_code SET consumed_at=now() WHERE code_hash=p_code_hash;
 IF l.expires_at<=now() THEN RETURN QUERY SELECT false,'expired',NULL::text,NULL::text,false,NULL::timestamptz; RETURN; END IF;
 IF l.origin<>p_origin THEN RETURN QUERY SELECT false,'origin',NULL::text,NULL::text,false,NULL::timestamptz; RETURN; END IF;
 SELECT * INTO c FROM public.ritnome_rep_session_check(l.session_id,p_price,true);
 IF NOT c.ok THEN RETURN QUERY SELECT false,c.reason,NULL::text,NULL::text,false,NULL::timestamptz; RETURN; END IF;
 SELECT * INTO s FROM public.ritnome_facility_session x WHERE x.id=l.session_id;
 INSERT INTO public.ritnome_activity_token(token_hash,session_id,activity_key,origin,recreation_session_id) VALUES(p_token_hash,l.session_id,l.activity_key,l.origin,l.recreation_session_id);
 RETURN QUERY SELECT true,'ok',l.activity_key,'es'::text,c.handles_enabled,s.expires_at;
END $$;
CREATE OR REPLACE FUNCTION public.ritnome_rep_report(p_token_hash text,p_origin text,p_price text,p_run uuid,p_seq integer,p_kind text,p_payload jsonb)
RETURNS TABLE(outcome text,high_seq integer) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE t public.ritnome_activity_token%ROWTYPE; c record; r public.ritnome_activity_run%ROWTYPE; h uuid; hp jsonb;
 allowed text[] := ARRAY['mode','language','device_class','headcount','participations','interactions','group_bpm','levels','games_completed','setting','handle_id','personal_bpm','minutes','result'];
BEGIN
 IF p_run IS NULL OR p_seq IS NULL OR p_seq<1 OR p_kind NOT IN ('start','checkpoint','end','progress') OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RETURN QUERY SELECT 'invalid',0; RETURN; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE NOT (k = ANY(allowed))) THEN RETURN QUERY SELECT 'invalid',0; RETURN; END IF;
 SELECT * INTO t FROM public.ritnome_activity_token x WHERE x.token_hash=p_token_hash;
 IF NOT FOUND OR t.revoked_at IS NOT NULL OR t.origin<>p_origin THEN RETURN QUERY SELECT 'denied',0; RETURN; END IF;
 SELECT * INTO c FROM public.ritnome_rep_session_check(t.session_id,p_price,true);
 IF NOT c.ok THEN RETURN QUERY SELECT 'denied',0; RETURN; END IF;
 SELECT * INTO r FROM public.ritnome_activity_run x WHERE x.run_id=p_run FOR UPDATE;
 IF FOUND THEN
  IF r.facility_id<>c.facility_id OR r.livemode<>c.livemode OR r.session_id<>t.session_id OR r.activity_key<>t.activity_key THEN RETURN QUERY SELECT 'denied',0; RETURN; END IF;
  IF p_seq<=r.last_seq THEN RETURN QUERY SELECT 'duplicate',r.last_seq; RETURN; END IF;
  IF p_seq<>r.last_seq+1 THEN RETURN QUERY SELECT 'out_of_order',r.last_seq; RETURN; END IF;
  IF r.status<>'open' THEN RETURN QUERY SELECT 'closed',r.last_seq; RETURN; END IF;
 ELSE
  IF p_seq<>1 OR p_kind<>'start' THEN RETURN QUERY SELECT 'out_of_order',0; RETURN; END IF;
  INSERT INTO public.ritnome_activity_run(run_id,livemode,facility_id,session_id,facilitator_user_id,activity_key,recreation_session_id) VALUES(p_run,c.livemode,c.facility_id,t.session_id,c.user_id,t.activity_key,t.recreation_session_id) RETURNING * INTO r;
 END IF;
 INSERT INTO public.ritnome_activity_event(run_id,seq,kind,payload) VALUES(p_run,p_seq,p_kind,p_payload - 'handle_id' - 'personal_bpm' - 'result');
 UPDATE public.ritnome_activity_run x SET last_seq=p_seq,last_event_at=now(),
  mode=CASE WHEN p_payload->>'mode' IN ('group','individual') THEN p_payload->>'mode' ELSE x.mode END,
  language=CASE WHEN p_payload->>'language' IN ('es','en') THEN p_payload->>'language' ELSE x.language END,
  device_class=CASE WHEN p_payload->>'device_class' IN ('phone','tablet','desktop') THEN p_payload->>'device_class' ELSE x.device_class END,
  headcount=CASE WHEN jsonb_typeof(p_payload->'headcount')='number' THEN least(500,greatest(0,(p_payload->>'headcount')::int)) ELSE x.headcount END,
  participations=CASE WHEN jsonb_typeof(p_payload->'participations')='number' THEN least(100000,greatest(x.participations,(p_payload->>'participations')::int)) ELSE x.participations END,
  interactions=CASE WHEN jsonb_typeof(p_payload->'interactions')='number' THEN greatest(x.interactions,(p_payload->>'interactions')::int) ELSE x.interactions END,
  ended_at=CASE WHEN p_kind='end' THEN now() ELSE x.ended_at END,
  status=CASE WHEN p_kind='end' THEN 'closed' ELSE x.status END
 WHERE x.run_id=p_run;
 IF p_kind='progress' THEN
  IF NOT c.handles_enabled THEN RETURN QUERY SELECT 'handles_off',p_seq; RETURN; END IF;
  BEGIN h:=(p_payload->>'handle_id')::uuid; EXCEPTION WHEN others THEN h:=NULL; END;
  IF h IS NULL OR NOT EXISTS(SELECT 1 FROM public.ritnome_participant_handle x WHERE x.handle_id=h AND x.livemode=c.livemode AND x.facility_id=c.facility_id AND x.retired_at IS NULL) THEN RETURN QUERY SELECT 'invalid_handle',p_seq; RETURN; END IF;
  hp:=coalesce(p_payload->'result','{}'::jsonb);
  INSERT INTO public.ritnome_participant_progress(handle_id,run_id,seq,activity_key,setting,personal_bpm,minutes,result)
  VALUES(h,p_run,p_seq,t.activity_key,coalesce(p_payload->>'setting','default'),
   CASE WHEN jsonb_typeof(p_payload->'personal_bpm')='number' THEN (p_payload->>'personal_bpm')::numeric ELSE NULL END,
   CASE WHEN jsonb_typeof(p_payload->'minutes')='number' THEN least(600,greatest(0,(p_payload->>'minutes')::numeric)) ELSE 0 END,
   CASE WHEN jsonb_typeof(hp)='object' THEN hp ELSE '{}'::jsonb END)
  ON CONFLICT DO NOTHING;
 END IF;
 RETURN QUERY SELECT 'accepted',p_seq;
END $$;
CREATE OR REPLACE FUNCTION public.ritnome_rep_session_check(p_session uuid,p_price text,p_touch boolean DEFAULT true)
RETURNS TABLE(ok boolean,reason text,facility_id uuid,user_id uuid,role text,livemode boolean,handles_enabled boolean) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE s public.ritnome_facility_session%ROWTYPE; h boolean;
BEGIN
 SELECT * INTO s FROM public.ritnome_facility_session x WHERE x.id=p_session FOR UPDATE;
 IF NOT FOUND THEN RETURN QUERY SELECT false,'no_session',NULL::uuid,NULL::uuid,NULL::text,NULL::boolean,false; RETURN; END IF;
 SELECT p.handles_enabled INTO h FROM public.ritnome_facility_plan p WHERE p.livemode=s.livemode AND p.facility_id=s.facility_id;
 IF s.ended_at IS NOT NULL THEN RETURN QUERY SELECT false,'ended',s.facility_id,s.user_id,s.role,s.livemode,coalesce(h,false); RETURN; END IF;
 IF s.expires_at<=now() THEN UPDATE public.ritnome_facility_session SET ended_at=now() WHERE id=s.id; RETURN QUERY SELECT false,'expired',s.facility_id,s.user_id,s.role,s.livemode,coalesce(h,false); RETURN; END IF;
 IF NOT public.ritnome_institution_authorized(s.livemode,s.user_id,s.auth_session,p_price) THEN
  UPDATE public.ritnome_facility_session SET ended_at=now() WHERE id=s.id;
  RETURN QUERY SELECT false,'revoked',s.facility_id,s.user_id,s.role,s.livemode,coalesce(h,false); RETURN; END IF;
 IF s.locked_at IS NULL AND s.last_activity_at<now()-interval '30 minutes' THEN
  UPDATE public.ritnome_facility_session SET locked_at=now() WHERE id=s.id;
  UPDATE public.ritnome_activity_run SET status='abandoned',ended_at=last_event_at WHERE session_id=s.id AND status='open';
  PERFORM public.ritnome_recsession_close(s.id);
  s.locked_at:=now(); END IF;
 IF s.locked_at IS NOT NULL THEN RETURN QUERY SELECT false,'locked',s.facility_id,s.user_id,s.role,s.livemode,coalesce(h,false); RETURN; END IF;
 IF p_touch THEN UPDATE public.ritnome_facility_session SET last_activity_at=now() WHERE id=s.id; END IF;
 RETURN QUERY SELECT true,'ok',s.facility_id,s.user_id,s.role,s.livemode,coalesce(h,false);
END $$;
CREATE OR REPLACE FUNCTION public.ritnome_rep_session_end(p_session uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 UPDATE public.ritnome_facility_session SET ended_at=now() WHERE id=p_session AND ended_at IS NULL;
 UPDATE public.ritnome_activity_run SET status='abandoned',ended_at=last_event_at WHERE session_id=p_session AND status='open';
 PERFORM public.ritnome_recsession_close(p_session);
 UPDATE public.ritnome_activity_token SET revoked_at=now() WHERE session_id=p_session AND revoked_at IS NULL;
 RETURN FOUND;
END $$;
CREATE OR REPLACE FUNCTION public.ritnome_rep_set_plan(p_session uuid,p_price text,p_sessions_per_week integer,p_handles_enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c record;
BEGIN
 SELECT * INTO c FROM public.ritnome_rep_session_check(p_session,p_price,true);
 IF NOT c.ok OR c.role<>'owner' THEN RETURN false; END IF;
 UPDATE public.ritnome_facility_plan SET sessions_per_week=coalesce(p_sessions_per_week,sessions_per_week),handles_enabled=coalesce(p_handles_enabled,handles_enabled),updated_at=now() WHERE livemode=c.livemode AND facility_id=c.facility_id;
 IF p_sessions_per_week IS NOT NULL THEN INSERT INTO public.ritnome_facility_plan_history(livemode,facility_id,effective_from,sessions_per_week) VALUES(c.livemode,c.facility_id,public.ritnome_pr_today(),p_sessions_per_week) ON CONFLICT (livemode,facility_id,effective_from) DO UPDATE SET sessions_per_week=EXCLUDED.sessions_per_week,set_at=now(); END IF;
 RETURN true;
END $$;

-- ---------------------------------------------------------------------------------------------------------
-- Single source of truth for every report: one row per facilitated recreation session.
-- minutes      = span from the first run start to the last run end inside the session (overlapping runs never add up twice)
-- runs         = non-abandoned activity runs; participations = cumulative over runs (one person in five activities counts five)
-- headcount    = the largest headcount recorded in the session (people present), never the sum of the runs' headcounts
-- estimated    = true for legacy runs with no parent session, grouped by a 45-minute gap rule per facilitator session
-- ---------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.ritnome_rep_sessions_calc(p_mode boolean,p_facility uuid)
RETURNS TABLE(session_key text,recreation_session_id uuid,source text,status text,started_at timestamptz,ended_at timestamptz,day date,minutes numeric,runs bigint,participations bigint,headcount integer,activities bigint,estimated boolean,facilitator_user_id uuid)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 WITH r AS (
  SELECT x.*, coalesce(x.ended_at,x.last_event_at) AS fin FROM public.ritnome_activity_run x WHERE x.livemode=p_mode AND x.facility_id=p_facility AND x.status<>'abandoned'
 ), parented AS (
  SELECT s.id::text AS session_key, s.id AS recreation_session_id, s.source, s.status, min(r.started_at) AS started_at, max(r.fin) AS ended_at,
   public.ritnome_pr_date(min(r.started_at)) AS day,
   round((extract(epoch FROM (max(r.fin)-min(r.started_at)))/60)::numeric,1) AS minutes,
   count(*) AS runs, coalesce(sum(r.participations),0) AS participations, max(r.headcount) AS headcount, count(DISTINCT r.activity_key) AS activities, false AS estimated, s.facilitator_user_id
  FROM public.ritnome_recreation_session s JOIN r ON r.recreation_session_id=s.id GROUP BY s.id
 ), legacy AS (
  SELECT r.*, CASE WHEN r.started_at - lag(r.fin) OVER (PARTITION BY r.session_id ORDER BY r.started_at) > interval '45 minutes' OR lag(r.fin) OVER (PARTITION BY r.session_id ORDER BY r.started_at) IS NULL THEN 1 ELSE 0 END AS brk
  FROM r WHERE r.recreation_session_id IS NULL
 ), legacy_grp AS (
  SELECT l.*, sum(l.brk) OVER (PARTITION BY l.session_id ORDER BY l.started_at ROWS UNBOUNDED PRECEDING) AS grp FROM legacy l
 ), estimated AS (
  SELECT 'est:'||g.session_id||':'||g.grp AS session_key, NULL::uuid, 'estimated'::text, 'closed'::text, min(g.started_at), max(g.fin), public.ritnome_pr_date(min(g.started_at)),
   round((extract(epoch FROM (max(g.fin)-min(g.started_at)))/60)::numeric,1), count(*), coalesce(sum(g.participations),0), max(g.headcount), count(DISTINCT g.activity_key), true, (array_agg(g.facilitator_user_id ORDER BY g.started_at))[1]
  FROM legacy_grp g GROUP BY g.session_id,g.grp
 )
 SELECT * FROM parented UNION ALL SELECT * FROM estimated
$$;
-- Participant minutes are additive per run (two stations at once are two groups of people): sum over runs of run minutes × run headcount.
CREATE FUNCTION public.ritnome_rep_runs_calc(p_mode boolean,p_facility uuid)
RETURNS TABLE(run_id uuid,recreation_session_id uuid,activity_key text,mode text,started_at timestamptz,ended_at timestamptz,day date,minutes numeric,headcount integer,participations integer,interactions integer,status text,facilitator_user_id uuid,session_id uuid)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT x.run_id,x.recreation_session_id,x.activity_key,x.mode,x.started_at,coalesce(x.ended_at,x.last_event_at),public.ritnome_pr_date(x.started_at),
  round((extract(epoch FROM (coalesce(x.ended_at,x.last_event_at)-x.started_at))/60)::numeric,1),x.headcount,x.participations,x.interactions,x.status,x.facilitator_user_id,x.session_id
 FROM public.ritnome_activity_run x WHERE x.livemode=p_mode AND x.facility_id=p_facility AND x.status<>'abandoned'
$$;
-- Planned facilitated sessions for a Puerto Rico date range: each day contributes (that day's weekly target)/7, so partial months and
-- mid-week target changes are prorated by days. Rounded once at the end.
CREATE FUNCTION public.ritnome_rep_planned(p_mode boolean,p_facility uuid,p_from date,p_to_excl date) RETURNS numeric LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce(round(sum(public.ritnome_plan_on(p_mode,p_facility,d::date))/7.0,1),0) FROM generate_series(p_from,p_to_excl-1,interval '1 day') d
$$;

-- Period summary used by the management report (and later the executive report): facilitated sessions, runs, participations, minutes, variety, days.
CREATE FUNCTION public.ritnome_rep_period(p_mode boolean,p_facility uuid,p_from date,p_to_excl date,p_handles boolean) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object(
  'from',p_from,'to',p_to_excl-1,
  'sessions',(SELECT count(*) FROM public.ritnome_rep_sessions_calc(p_mode,p_facility) s WHERE s.day>=p_from AND s.day<p_to_excl),
  'sessions_estimated',(SELECT count(*) FROM public.ritnome_rep_sessions_calc(p_mode,p_facility) s WHERE s.day>=p_from AND s.day<p_to_excl AND s.estimated),
  'activity_runs',(SELECT count(*) FROM public.ritnome_rep_runs_calc(p_mode,p_facility) r WHERE r.day>=p_from AND r.day<p_to_excl),
  'participations',(SELECT coalesce(sum(r.participations),0) FROM public.ritnome_rep_runs_calc(p_mode,p_facility) r WHERE r.day>=p_from AND r.day<p_to_excl),
  'recreation_minutes',(SELECT coalesce(sum(s.minutes),0) FROM public.ritnome_rep_sessions_calc(p_mode,p_facility) s WHERE s.day>=p_from AND s.day<p_to_excl),
  'estimated_participant_minutes',(SELECT coalesce(round(sum(r.minutes*r.headcount)),0) FROM public.ritnome_rep_runs_calc(p_mode,p_facility) r WHERE r.day>=p_from AND r.day<p_to_excl),
  'activity_variety',(SELECT count(DISTINCT r.activity_key) FROM public.ritnome_rep_runs_calc(p_mode,p_facility) r WHERE r.day>=p_from AND r.day<p_to_excl),
  'active_days',(SELECT count(DISTINCT r.day) FROM public.ritnome_rep_runs_calc(p_mode,p_facility) r WHERE r.day>=p_from AND r.day<p_to_excl),
  'unique_participants',CASE WHEN p_handles THEN (SELECT count(DISTINCT p.handle_id) FROM public.ritnome_participant_progress p JOIN public.ritnome_rep_runs_calc(p_mode,p_facility) r ON r.run_id=p.run_id WHERE r.day>=p_from AND r.day<p_to_excl) ELSE NULL END,
  'unique_participants_tracked',p_handles,
  'planned_sessions',public.ritnome_rep_planned(p_mode,p_facility,p_from,p_to_excl))
$$;

-- Institutional Management (owner/manager): one month in Puerto Rico time. Partial months are labeled and compared to the same days of the previous month.
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
  'weekly',(SELECT coalesce(jsonb_agg(jsonb_build_object('week',wk::date,'sessions',(SELECT count(*) FROM public.ritnome_rep_sessions_calc(c.livemode,c.facility_id) s WHERE s.day>=wk::date AND s.day<wk::date+7),
     'planned',public.ritnome_rep_planned(c.livemode,c.facility_id,greatest(wk::date,m0),least(wk::date+7,cut)),'partial',(wk::date<m0 OR wk::date+7>cut)) ORDER BY wk),'[]'::jsonb)
   FROM generate_series(date_trunc('week',m0::timestamp),date_trunc('week',(cut-1)::timestamp),interval '7 days') wk)) INTO out;
 RETURN out;
END $$;

-- Facilitator View: Puerto Rico today and last 30 days; sessions and activity runs shown apart; history lists runs with their parent session.
CREATE OR REPLACE FUNCTION public.ritnome_rep_facilitator_view(p_session uuid,p_price text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c record; today date; out jsonb;
BEGIN
 SELECT * INTO c FROM public.ritnome_rep_session_check(p_session,p_price,true);
 IF NOT c.ok THEN RETURN jsonb_build_object('ok',false,'reason',c.reason); END IF;
 today:=public.ritnome_pr_today();
 SELECT jsonb_build_object('ok',true,'role',c.role,'handles_enabled',c.handles_enabled,'timezone','America/Puerto_Rico',
  'current',public.ritnome_rep_recsession_current(p_session,p_price),
  'today',public.ritnome_rep_period(c.livemode,c.facility_id,today,today+1,c.handles_enabled),
  'last_30_days',public.ritnome_rep_period(c.livemode,c.facility_id,today-29,today+1,c.handles_enabled),
  'history',(SELECT coalesce(jsonb_agg(jsonb_build_object('run_id',r.run_id,'session',r.recreation_session_id,'activity',r.activity_key,'mode',r.mode,'started_at',r.started_at,'ended_at',r.ended_at,'status',r.status,'headcount',r.headcount,'participations',r.participations,'interactions',r.interactions,'minutes',r.minutes) ORDER BY r.started_at DESC),'[]'::jsonb)
   FROM (SELECT * FROM public.ritnome_rep_runs_calc(c.livemode,c.facility_id) x WHERE x.day>=today-29 ORDER BY x.started_at DESC LIMIT 200) r),
  'sessions',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.session_key,'source',s.source,'status',s.status,'day',s.day,'started_at',s.started_at,'ended_at',s.ended_at,'minutes',s.minutes,'runs',s.runs,'participations',s.participations,'headcount',s.headcount,'estimated',s.estimated) ORDER BY s.started_at DESC),'[]'::jsonb)
   FROM (SELECT * FROM public.ritnome_rep_sessions_calc(c.livemode,c.facility_id) x WHERE x.day>=today-29 ORDER BY x.started_at DESC LIMIT 100) s)) INTO out;
 RETURN out;
END $$;

REVOKE ALL ON FUNCTION public.ritnome_pr_date(timestamptz),public.ritnome_pr_today(),public.ritnome_plan_on(boolean,uuid,date),public.ritnome_recsession_close(uuid),
 public.ritnome_rep_recsession_start(uuid,text,integer,text),public.ritnome_rep_recsession_end(uuid,text),public.ritnome_rep_recsession_current(uuid,text),
 public.ritnome_rep_launch_create(uuid,text,text,text,text,uuid),public.ritnome_rep_sessions_calc(boolean,uuid),public.ritnome_rep_runs_calc(boolean,uuid),
 public.ritnome_rep_planned(boolean,uuid,date,date),public.ritnome_rep_period(boolean,uuid,date,date,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ritnome_pr_date(timestamptz),public.ritnome_pr_today(),public.ritnome_plan_on(boolean,uuid,date),public.ritnome_recsession_close(uuid),
 public.ritnome_rep_recsession_start(uuid,text,integer,text),public.ritnome_rep_recsession_end(uuid,text),public.ritnome_rep_recsession_current(uuid,text),
 public.ritnome_rep_launch_create(uuid,text,text,text,text,uuid),public.ritnome_rep_sessions_calc(boolean,uuid),public.ritnome_rep_runs_calc(boolean,uuid),
 public.ritnome_rep_planned(boolean,uuid,date,date),public.ritnome_rep_period(boolean,uuid,date,date,boolean) TO service_role;
