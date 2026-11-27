-- Ritnome institutional — Phase 1 reporting foundation (dedicated live project only).
-- Apply after ritnome-live-readiness.sql. Service role only; nothing here is reachable from a browser.
-- Facility isolation: every function derives the facility from the facilitator session; no caller may name a facility.

-- 1. Staff roles on the existing membership row.
ALTER TABLE public.ritnome_institution_memberships ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'facilitator' CHECK(role IN ('owner','manager','facilitator'));
UPDATE public.ritnome_institution_memberships m SET role='owner' FROM public.ritnome_enrollment e WHERE e.livemode=m.livemode AND e.facility_id=m.facility_id AND e.owner_id=m.user_id AND m.role<>'owner';

-- 2. Facility plan: the source of planned session targets and the participant-handle opt-in.
CREATE TABLE public.ritnome_facility_plan(
 livemode boolean NOT NULL,
 facility_id uuid NOT NULL,
 sessions_per_week integer NOT NULL DEFAULT 5 CHECK(sessions_per_week BETWEEN 0 AND 50),
 handles_enabled boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(livemode,facility_id),
 FOREIGN KEY(livemode,facility_id) REFERENCES public.ritnome_enrollment(livemode,facility_id) ON DELETE CASCADE
);

-- 3. Facilitator sessions: 8-hour maximum, 30-minute inactivity lock.
CREATE TABLE public.ritnome_facility_session(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 livemode boolean NOT NULL,
 facility_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 auth_session uuid NOT NULL,
 role text NOT NULL CHECK(role IN ('owner','manager','facilitator')),
 created_at timestamptz NOT NULL DEFAULT now(),
 last_activity_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '8 hours',
 locked_at timestamptz,
 ended_at timestamptz,
 FOREIGN KEY(livemode,facility_id) REFERENCES public.ritnome_enrollment(livemode,facility_id) ON DELETE CASCADE
);
CREATE INDEX ritnome_facility_session_user_idx ON public.ritnome_facility_session(user_id) WHERE ended_at IS NULL;

-- 4. One-time launch codes (60 seconds, single use) and activity tokens (hashed, bound to session + activity + origin).
CREATE TABLE public.ritnome_launch_code(
 code_hash text PRIMARY KEY CHECK(code_hash ~ '^[0-9a-f]{64}$'),
 session_id uuid NOT NULL REFERENCES public.ritnome_facility_session(id) ON DELETE CASCADE,
 activity_key text NOT NULL CHECK(activity_key ~ '^[a-z0-9-]{2,40}$'),
 origin text NOT NULL CHECK(origin ~ '^https://[a-z0-9.-]+$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '60 seconds',
 consumed_at timestamptz
);
CREATE TABLE public.ritnome_activity_token(
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[0-9a-f]{64}$'),
 session_id uuid NOT NULL REFERENCES public.ritnome_facility_session(id) ON DELETE CASCADE,
 activity_key text NOT NULL,
 origin text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz
);

-- 5. Activity runs (idempotent by client run_id) and append-only events (idempotent by run_id + seq).
CREATE TABLE public.ritnome_activity_run(
 run_id uuid PRIMARY KEY,
 livemode boolean NOT NULL,
 facility_id uuid NOT NULL,
 session_id uuid NOT NULL REFERENCES public.ritnome_facility_session(id) ON DELETE CASCADE,
 facilitator_user_id uuid NOT NULL,
 activity_key text NOT NULL,
 mode text NOT NULL DEFAULT 'group' CHECK(mode IN ('group','individual')),
 language text NOT NULL DEFAULT 'es' CHECK(language IN ('es','en')),
 device_class text NOT NULL DEFAULT 'unknown' CHECK(device_class IN ('phone','tablet','desktop','unknown')),
 started_at timestamptz NOT NULL DEFAULT now(),
 last_event_at timestamptz NOT NULL DEFAULT now(),
 ended_at timestamptz,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed','abandoned')),
 headcount integer NOT NULL DEFAULT 0 CHECK(headcount BETWEEN 0 AND 500),
 participations integer NOT NULL DEFAULT 0 CHECK(participations BETWEEN 0 AND 100000),
 interactions integer NOT NULL DEFAULT 0 CHECK(interactions >= 0),
 last_seq integer NOT NULL DEFAULT 0 CHECK(last_seq >= 0),
 FOREIGN KEY(livemode,facility_id) REFERENCES public.ritnome_enrollment(livemode,facility_id) ON DELETE CASCADE
);
CREATE INDEX ritnome_activity_run_facility_idx ON public.ritnome_activity_run(livemode,facility_id,started_at DESC);
CREATE TABLE public.ritnome_activity_event(
 run_id uuid NOT NULL REFERENCES public.ritnome_activity_run(run_id) ON DELETE CASCADE,
 seq integer NOT NULL CHECK(seq >= 1),
 kind text NOT NULL CHECK(kind IN ('start','checkpoint','end','progress')),
 payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(pg_column_size(payload) <= 4096),
 received_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(run_id,seq)
);

-- 6. Pseudonymous participant handles (facility opt-in) and their progress.
CREATE TABLE public.ritnome_participant_handle(
 handle_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 livemode boolean NOT NULL,
 facility_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 retired_at timestamptz,
 FOREIGN KEY(livemode,facility_id) REFERENCES public.ritnome_enrollment(livemode,facility_id) ON DELETE CASCADE
);
CREATE TABLE public.ritnome_participant_progress(
 handle_id uuid NOT NULL REFERENCES public.ritnome_participant_handle(handle_id) ON DELETE CASCADE,
 run_id uuid NOT NULL REFERENCES public.ritnome_activity_run(run_id) ON DELETE CASCADE,
 seq integer NOT NULL,
 activity_key text NOT NULL,
 setting text NOT NULL DEFAULT 'default',
 personal_bpm numeric(6,2) CHECK(personal_bpm IS NULL OR personal_bpm BETWEEN 20 AND 300),
 minutes numeric(6,2) NOT NULL DEFAULT 0 CHECK(minutes BETWEEN 0 AND 600),
 result jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(pg_column_size(result) <= 2048),
 recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(handle_id,run_id,seq)
);

-- 7. Retention audit (purges are recorded; nothing is purged silently).
CREATE TABLE public.ritnome_retention_audit(
 id bigserial PRIMARY KEY,
 ran_at timestamptz NOT NULL DEFAULT now(),
 events_deleted integer NOT NULL,
 runs_deleted integer NOT NULL,
 progress_deleted integer NOT NULL,
 sessions_deleted integer NOT NULL,
 codes_deleted integer NOT NULL
);

ALTER TABLE public.ritnome_facility_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ritnome_facility_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ritnome_launch_code ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ritnome_activity_token ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ritnome_activity_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ritnome_activity_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ritnome_participant_handle ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ritnome_participant_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ritnome_retention_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ritnome_facility_plan,public.ritnome_facility_session,public.ritnome_launch_code,public.ritnome_activity_token,public.ritnome_activity_run,public.ritnome_activity_event,public.ritnome_participant_handle,public.ritnome_participant_progress,public.ritnome_retention_audit FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.ritnome_facility_plan,public.ritnome_facility_session,public.ritnome_launch_code,public.ritnome_activity_token,public.ritnome_activity_run,public.ritnome_activity_event,public.ritnome_participant_handle,public.ritnome_participant_progress,public.ritnome_retention_audit TO service_role;
GRANT USAGE ON SEQUENCE public.ritnome_retention_audit_id_seq TO service_role;

-- ===== Functions. All SECURITY INVOKER (run as service_role), search_path ''. =====

-- Open a facilitator session after full authorization. Ends any other open session of the same user.
CREATE FUNCTION public.ritnome_rep_session_open(p_mode boolean,p_user uuid,p_auth_session uuid,p_price text)
RETURNS TABLE(session_id uuid,facility_id uuid,role text,expires_at timestamptz,handles_enabled boolean) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE m record;
BEGIN
 IF NOT public.ritnome_institution_authorized(p_mode,p_user,p_auth_session,p_price) THEN RETURN; END IF;
 SELECT x.facility_id,x.role INTO m FROM public.ritnome_institution_memberships x WHERE x.livemode=p_mode AND x.user_id=p_user AND x.active;
 IF NOT FOUND THEN RETURN; END IF;
 UPDATE public.ritnome_facility_session s SET ended_at=now() WHERE s.user_id=p_user AND s.livemode=p_mode AND s.ended_at IS NULL;
 INSERT INTO public.ritnome_facility_plan(livemode,facility_id) VALUES(p_mode,m.facility_id) ON CONFLICT DO NOTHING;
 RETURN QUERY INSERT INTO public.ritnome_facility_session(livemode,facility_id,user_id,auth_session,role) VALUES(p_mode,m.facility_id,p_user,p_auth_session,m.role)
  RETURNING ritnome_facility_session.id, ritnome_facility_session.facility_id, ritnome_facility_session.role, ritnome_facility_session.expires_at,
   (SELECT p.handles_enabled FROM public.ritnome_facility_plan p WHERE p.livemode=p_mode AND p.facility_id=ritnome_facility_session.facility_id);
END $$;

-- Check a session on every request: expiry, end, revocation (subscription/membership/enrollment), inactivity lock. Touches last_activity when ok.
CREATE FUNCTION public.ritnome_rep_session_check(p_session uuid,p_price text,p_touch boolean DEFAULT true)
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
  s.locked_at:=now(); END IF;
 IF s.locked_at IS NOT NULL THEN RETURN QUERY SELECT false,'locked',s.facility_id,s.user_id,s.role,s.livemode,coalesce(h,false); RETURN; END IF;
 IF p_touch THEN UPDATE public.ritnome_facility_session SET last_activity_at=now() WHERE id=s.id; END IF;
 RETURN QUERY SELECT true,'ok',s.facility_id,s.user_id,s.role,s.livemode,coalesce(h,false);
END $$;

-- Unlock: the server has re-verified the same user with a fresh Supabase Auth token (same auth session).
CREATE FUNCTION public.ritnome_rep_session_unlock(p_session uuid,p_user uuid,p_auth_session uuid,p_price text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE s public.ritnome_facility_session%ROWTYPE;
BEGIN
 SELECT * INTO s FROM public.ritnome_facility_session x WHERE x.id=p_session FOR UPDATE;
 IF NOT FOUND OR s.ended_at IS NOT NULL OR s.expires_at<=now() OR s.user_id<>p_user OR s.auth_session<>p_auth_session THEN RETURN false; END IF;
 IF NOT public.ritnome_institution_authorized(s.livemode,s.user_id,s.auth_session,p_price) THEN RETURN false; END IF;
 UPDATE public.ritnome_facility_session SET locked_at=NULL,last_activity_at=now() WHERE id=s.id;
 RETURN true;
END $$;

CREATE FUNCTION public.ritnome_rep_session_end(p_session uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 UPDATE public.ritnome_facility_session SET ended_at=now() WHERE id=p_session AND ended_at IS NULL;
 UPDATE public.ritnome_activity_run SET status='abandoned',ended_at=last_event_at WHERE session_id=p_session AND status='open';
 UPDATE public.ritnome_activity_token SET revoked_at=now() WHERE session_id=p_session AND revoked_at IS NULL;
 RETURN FOUND;
END $$;

-- Create a one-time launch code (the server stores only its hash).
CREATE FUNCTION public.ritnome_rep_launch_create(p_session uuid,p_price text,p_activity text,p_origin text,p_code_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c record;
BEGIN
 SELECT * INTO c FROM public.ritnome_rep_session_check(p_session,p_price,true);
 IF NOT c.ok THEN RETURN false; END IF;
 INSERT INTO public.ritnome_launch_code(code_hash,session_id,activity_key,origin) VALUES(p_code_hash,p_session,p_activity,p_origin);
 RETURN true;
END $$;

-- Exchange a launch code (atomic, single use) for an activity token; returns what the game needs and nothing more.
CREATE FUNCTION public.ritnome_rep_launch_exchange(p_code_hash text,p_origin text,p_token_hash text,p_price text)
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
 INSERT INTO public.ritnome_activity_token(token_hash,session_id,activity_key,origin) VALUES(p_token_hash,l.session_id,l.activity_key,l.origin);
 RETURN QUERY SELECT true,'ok',l.activity_key,'es'::text,c.handles_enabled,s.expires_at;
END $$;

-- Idempotent activity report. Facility is derived from the token's session; a run_id that belongs to another facility is refused.
CREATE FUNCTION public.ritnome_rep_report(p_token_hash text,p_origin text,p_price text,p_run uuid,p_seq integer,p_kind text,p_payload jsonb)
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
  INSERT INTO public.ritnome_activity_run(run_id,livemode,facility_id,session_id,facilitator_user_id,activity_key) VALUES(p_run,c.livemode,c.facility_id,t.session_id,c.user_id,t.activity_key) RETURNING * INTO r;
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

-- Owner-only facility plan (planned sessions per week; handle opt-in).
CREATE FUNCTION public.ritnome_rep_set_plan(p_session uuid,p_price text,p_sessions_per_week integer,p_handles_enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c record;
BEGIN
 SELECT * INTO c FROM public.ritnome_rep_session_check(p_session,p_price,true);
 IF NOT c.ok OR c.role<>'owner' THEN RETURN false; END IF;
 UPDATE public.ritnome_facility_plan SET sessions_per_week=coalesce(p_sessions_per_week,sessions_per_week),handles_enabled=coalesce(p_handles_enabled,handles_enabled),updated_at=now() WHERE livemode=c.livemode AND facility_id=c.facility_id;
 RETURN true;
END $$;

-- Handles: create / retire (owner or manager), only when the facility opted in.
CREATE FUNCTION public.ritnome_rep_handle_create(p_session uuid,p_price text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c record; h uuid;
BEGIN
 SELECT * INTO c FROM public.ritnome_rep_session_check(p_session,p_price,true);
 IF NOT c.ok OR NOT c.handles_enabled OR c.role NOT IN ('owner','manager') THEN RETURN NULL; END IF;
 INSERT INTO public.ritnome_participant_handle(livemode,facility_id) VALUES(c.livemode,c.facility_id) RETURNING handle_id INTO h;
 RETURN h;
END $$;
CREATE FUNCTION public.ritnome_rep_handle_retire(p_session uuid,p_price text,p_handle uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c record;
BEGIN
 SELECT * INTO c FROM public.ritnome_rep_session_check(p_session,p_price,true);
 IF NOT c.ok OR c.role NOT IN ('owner','manager') THEN RETURN false; END IF;
 UPDATE public.ritnome_participant_handle SET retired_at=now() WHERE handle_id=p_handle AND livemode=c.livemode AND facility_id=c.facility_id AND retired_at IS NULL;
 RETURN FOUND;
END $$;
CREATE FUNCTION public.ritnome_rep_handles(p_session uuid,p_price text)
RETURNS TABLE(handle_id uuid,created_at timestamptz,retired_at timestamptz,runs bigint) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c record;
BEGIN
 SELECT * INTO c FROM public.ritnome_rep_session_check(p_session,p_price,false);
 IF NOT c.ok THEN RETURN; END IF;
 RETURN QUERY SELECT h.handle_id,h.created_at,h.retired_at,(SELECT count(DISTINCT p.run_id) FROM public.ritnome_participant_progress p WHERE p.handle_id=h.handle_id)
  FROM public.ritnome_participant_handle h WHERE h.livemode=c.livemode AND h.facility_id=c.facility_id ORDER BY h.created_at;
END $$;

-- Facilitator View: today and the last 30 days, facility-scoped.
CREATE FUNCTION public.ritnome_rep_facilitator_view(p_session uuid,p_price text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c record; since timestamptz := now()-interval '30 days'; out jsonb;
BEGIN
 SELECT * INTO c FROM public.ritnome_rep_session_check(p_session,p_price,true);
 IF NOT c.ok THEN RETURN jsonb_build_object('ok',false,'reason',c.reason); END IF;
 SELECT jsonb_build_object('ok',true,'role',c.role,'handles_enabled',c.handles_enabled,
  'today',(SELECT jsonb_build_object('sessions',count(*),'recreation_minutes',coalesce(round(sum(extract(epoch FROM (coalesce(r.ended_at,r.last_event_at)-r.started_at))/60)::numeric,1),0),'participations',coalesce(sum(r.participations),0),'headcount',coalesce(sum(r.headcount),0))
   FROM public.ritnome_activity_run r WHERE r.livemode=c.livemode AND r.facility_id=c.facility_id AND r.started_at>=date_trunc('day',now())),
  'last_30_days',(SELECT jsonb_build_object('sessions',count(*),'recreation_minutes',coalesce(round(sum(extract(epoch FROM (coalesce(r.ended_at,r.last_event_at)-r.started_at))/60)::numeric,1),0),'participations',coalesce(sum(r.participations),0),'activities',count(DISTINCT r.activity_key),'active_days',count(DISTINCT date_trunc('day',r.started_at)))
   FROM public.ritnome_activity_run r WHERE r.livemode=c.livemode AND r.facility_id=c.facility_id AND r.started_at>=since),
  'history',(SELECT coalesce(jsonb_agg(jsonb_build_object('run_id',r.run_id,'activity',r.activity_key,'mode',r.mode,'started_at',r.started_at,'ended_at',r.ended_at,'status',r.status,'headcount',r.headcount,'participations',r.participations,'interactions',r.interactions,'minutes',round(extract(epoch FROM (coalesce(r.ended_at,r.last_event_at)-r.started_at))/60::numeric,1)) ORDER BY r.started_at DESC),'[]'::jsonb)
   FROM (SELECT * FROM public.ritnome_activity_run x WHERE x.livemode=c.livemode AND x.facility_id=c.facility_id AND x.started_at>=since ORDER BY x.started_at DESC LIMIT 200) r)) INTO out;
 RETURN out;
END $$;

-- Institutional Management: a month's executive summary, 6-month trend, popularity, utilization vs the facility's planned sessions per week.
CREATE FUNCTION public.ritnome_rep_management(p_session uuid,p_price text,p_month date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c record; m0 date; m1 date; plan int; weeks numeric; out jsonb;
BEGIN
 SELECT * INTO c FROM public.ritnome_rep_session_check(p_session,p_price,true);
 IF NOT c.ok THEN RETURN jsonb_build_object('ok',false,'reason',c.reason); END IF;
 IF c.role NOT IN ('owner','manager') THEN RETURN jsonb_build_object('ok',false,'reason','role'); END IF;
 m0:=date_trunc('month',coalesce(p_month,current_date))::date; m1:=(m0+interval '1 month')::date;
 SELECT p.sessions_per_week INTO plan FROM public.ritnome_facility_plan p WHERE p.livemode=c.livemode AND p.facility_id=c.facility_id;
 weeks:=round((least(m1,current_date+1)-m0)/7.0,2);
 WITH runs AS (SELECT r.*, extract(epoch FROM (coalesce(r.ended_at,r.last_event_at)-r.started_at))/60 AS mins FROM public.ritnome_activity_run r WHERE r.livemode=c.livemode AND r.facility_id=c.facility_id AND r.status<>'abandoned')
 SELECT jsonb_build_object('ok',true,'month',to_char(m0,'YYYY-MM'),'planned_sessions_per_week',coalesce(plan,0),'planned_sessions',round(coalesce(plan,0)*weeks),
  'summary',(SELECT jsonb_build_object('sessions',count(*),'participations',coalesce(sum(participations),0),'recreation_minutes',coalesce(round(sum(mins)::numeric,1),0),'estimated_participant_minutes',coalesce(round(sum(mins*headcount)::numeric,0),0),'activity_variety',count(DISTINCT activity_key),'active_days',count(DISTINCT date_trunc('day',started_at)),
    'unique_participants',CASE WHEN c.handles_enabled THEN (SELECT count(DISTINCT p.handle_id) FROM public.ritnome_participant_progress p JOIN runs x ON x.run_id=p.run_id WHERE x.started_at>=m0 AND x.started_at<m1) ELSE NULL END,
    'unique_participants_tracked',c.handles_enabled) FROM runs WHERE started_at>=m0 AND started_at<m1),
  'previous_month',(SELECT jsonb_build_object('sessions',count(*),'participations',coalesce(sum(participations),0),'recreation_minutes',coalesce(round(sum(mins)::numeric,1),0)) FROM runs WHERE started_at>=m0-interval '1 month' AND started_at<m0),
  'trend',(SELECT coalesce(jsonb_agg(jsonb_build_object('month',to_char(mo,'YYYY-MM'),'sessions',(SELECT count(*) FROM runs WHERE started_at>=mo AND started_at<mo+interval '1 month'),'participations',(SELECT coalesce(sum(participations),0) FROM runs WHERE started_at>=mo AND started_at<mo+interval '1 month'),'recreation_minutes',(SELECT coalesce(round(sum(mins)::numeric,1),0) FROM runs WHERE started_at>=mo AND started_at<mo+interval '1 month')) ORDER BY mo),'[]'::jsonb)
   FROM generate_series(m0-interval '5 months',m0,interval '1 month') mo),
  'popular_activities',(SELECT coalesce(jsonb_agg(jsonb_build_object('activity',activity_key,'sessions',n,'participations',pp) ORDER BY n DESC,pp DESC),'[]'::jsonb) FROM (SELECT activity_key,count(*) n,sum(participations) pp FROM runs WHERE started_at>=m0 AND started_at<m1 GROUP BY activity_key ORDER BY n DESC LIMIT 10) q),
  'weekly',(SELECT coalesce(jsonb_agg(jsonb_build_object('week',to_char(wk,'YYYY-MM-DD'),'sessions',(SELECT count(*) FROM runs WHERE started_at>=wk AND started_at<wk+interval '7 days'),'planned',coalesce(plan,0)) ORDER BY wk),'[]'::jsonb)
   FROM generate_series(date_trunc('week',m0::timestamptz),date_trunc('week',(m1-1)::timestamptz),interval '7 days') wk)) INTO out;
 RETURN out;
END $$;

-- Individual Progress for one handle: equivalent activity + setting only, against the handle's own first runs. No interpretation.
CREATE FUNCTION public.ritnome_rep_individual(p_session uuid,p_price text,p_handle uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c record; out jsonb;
BEGIN
 SELECT * INTO c FROM public.ritnome_rep_session_check(p_session,p_price,true);
 IF NOT c.ok OR NOT c.handles_enabled THEN RETURN jsonb_build_object('ok',false,'reason',CASE WHEN c.ok THEN 'handles_off' ELSE c.reason END); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ritnome_participant_handle h WHERE h.handle_id=p_handle AND h.livemode=c.livemode AND h.facility_id=c.facility_id) THEN RETURN jsonb_build_object('ok',false,'reason','no_handle'); END IF;
 SELECT jsonb_build_object('ok',true,'handle_id',p_handle,
  'participation',(SELECT jsonb_build_object('runs',count(DISTINCT p.run_id),'minutes',coalesce(round(sum(p.minutes)::numeric,1),0),'activities',count(DISTINCT p.activity_key),'first',min(p.recorded_at),'last',max(p.recorded_at)) FROM public.ritnome_participant_progress p WHERE p.handle_id=p_handle),
  'personal_bpm',(SELECT coalesce(jsonb_agg(jsonb_build_object('at',p.recorded_at,'bpm',p.personal_bpm) ORDER BY p.recorded_at),'[]'::jsonb) FROM public.ritnome_participant_progress p WHERE p.handle_id=p_handle AND p.personal_bpm IS NOT NULL),
  'by_activity',(SELECT coalesce(jsonb_agg(jsonb_build_object('activity',q.activity_key,'setting',q.setting,'runs',q.n,'baseline',q.baseline,'latest',q.latest) ORDER BY q.activity_key,q.setting),'[]'::jsonb)
   FROM (SELECT p.activity_key,p.setting,count(*) n,
     (SELECT jsonb_agg(x.result ORDER BY x.recorded_at) FROM (SELECT * FROM public.ritnome_participant_progress y WHERE y.handle_id=p_handle AND y.activity_key=p.activity_key AND y.setting=p.setting ORDER BY y.recorded_at LIMIT 4) x) baseline,
     (SELECT x.result FROM public.ritnome_participant_progress x WHERE x.handle_id=p_handle AND x.activity_key=p.activity_key AND x.setting=p.setting ORDER BY x.recorded_at DESC LIMIT 1) latest
    FROM public.ritnome_participant_progress p WHERE p.handle_id=p_handle GROUP BY p.activity_key,p.setting) q)) INTO out;
 RETURN out;
END $$;

-- Retention: raw events 13 months; runs 36 months; participant progress 13 months after the handle's last activity; sessions and codes 7 days.
CREATE FUNCTION public.ritnome_rep_retention_purge()
RETURNS TABLE(events_deleted integer,runs_deleted integer,progress_deleted integer,sessions_deleted integer,codes_deleted integer) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE e int; r int; p int; s int; k int;
BEGIN
 WITH d AS (DELETE FROM public.ritnome_activity_event x WHERE x.received_at<now()-interval '13 months' RETURNING 1) SELECT count(*) INTO e FROM d;
 WITH d AS (DELETE FROM public.ritnome_participant_progress x WHERE x.recorded_at<now()-interval '13 months' AND x.handle_id IN (SELECT h.handle_id FROM public.ritnome_participant_handle h WHERE NOT EXISTS(SELECT 1 FROM public.ritnome_participant_progress y WHERE y.handle_id=h.handle_id AND y.recorded_at>=now()-interval '13 months')) RETURNING 1) SELECT count(*) INTO p FROM d;
 WITH d AS (DELETE FROM public.ritnome_activity_run x WHERE x.started_at<now()-interval '36 months' RETURNING 1) SELECT count(*) INTO r FROM d;
 WITH d AS (DELETE FROM public.ritnome_facility_session x WHERE coalesce(x.ended_at,x.expires_at)<now()-interval '7 days' RETURNING 1) SELECT count(*) INTO s FROM d;
 WITH d AS (DELETE FROM public.ritnome_launch_code x WHERE x.expires_at<now()-interval '7 days' RETURNING 1) SELECT count(*) INTO k FROM d;
 INSERT INTO public.ritnome_retention_audit(events_deleted,runs_deleted,progress_deleted,sessions_deleted,codes_deleted) VALUES(e,r,p,s,k);
 RETURN QUERY SELECT e,r,p,s,k;
END $$;

REVOKE ALL ON FUNCTION public.ritnome_rep_session_open(boolean,uuid,uuid,text),public.ritnome_rep_session_check(uuid,text,boolean),public.ritnome_rep_session_unlock(uuid,uuid,uuid,text),public.ritnome_rep_session_end(uuid),
 public.ritnome_rep_launch_create(uuid,text,text,text,text),public.ritnome_rep_launch_exchange(text,text,text,text),public.ritnome_rep_report(text,text,text,uuid,integer,text,jsonb),
 public.ritnome_rep_set_plan(uuid,text,integer,boolean),public.ritnome_rep_handle_create(uuid,text),public.ritnome_rep_handle_retire(uuid,text,uuid),public.ritnome_rep_handles(uuid,text),
 public.ritnome_rep_facilitator_view(uuid,text),public.ritnome_rep_management(uuid,text,date),public.ritnome_rep_individual(uuid,text,uuid),public.ritnome_rep_retention_purge() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ritnome_rep_session_open(boolean,uuid,uuid,text),public.ritnome_rep_session_check(uuid,text,boolean),public.ritnome_rep_session_unlock(uuid,uuid,uuid,text),public.ritnome_rep_session_end(uuid),
 public.ritnome_rep_launch_create(uuid,text,text,text,text),public.ritnome_rep_launch_exchange(text,text,text,text),public.ritnome_rep_report(text,text,text,uuid,integer,text,jsonb),
 public.ritnome_rep_set_plan(uuid,text,integer,boolean),public.ritnome_rep_handle_create(uuid,text),public.ritnome_rep_handle_retire(uuid,text,uuid),public.ritnome_rep_handles(uuid,text),
 public.ritnome_rep_facilitator_view(uuid,text),public.ritnome_rep_management(uuid,text,date),public.ritnome_rep_individual(uuid,text,uuid),public.ritnome_rep_retention_purge() TO service_role;
