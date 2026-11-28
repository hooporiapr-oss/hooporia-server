-- R1 reporting accuracy checks. Run after apply-local.sh on a fresh database. Fixtures are explicitly fictional.
\set ON_ERROR_STOP on
CREATE TEMP TABLE r(name text, pass boolean); GRANT ALL ON r TO service_role;
INSERT INTO auth.users(id,email) VALUES ('99999999-9999-9999-9999-999999999999','r1owner@test') ON CONFLICT DO NOTHING;
INSERT INTO auth.sessions(id,user_id) VALUES ('aaaa9999-0000-0000-0000-000000000009','99999999-9999-9999-9999-999999999999') ON CONFLICT DO NOTHING;
SET ROLE service_role;
INSERT INTO public.licenses(id,code,school_name,product) VALUES ('aaaaaaaa-0000-0000-0000-0000000000a9','LIC-R1','R1','ritnome_institutional') ON CONFLICT DO NOTHING;
INSERT INTO public.ritnome_enrollment(livemode,owner_id,facility_id,facility_name,facility_type,approved_license_id,checkout_session_id,stripe_customer_id) VALUES (true,'99999999-9999-9999-9999-999999999999','fac99999-0000-0000-0000-000000000009','R1 Fixture Facility','residence','aaaaaaaa-0000-0000-0000-0000000000a9','cs_live_R1','cus_R1');
INSERT INTO public.ritnome_subscription_registry(livemode,facility_id,stripe_customer_id,stripe_subscription_id,stripe_price_id,license_id,billing_status,paid_through) VALUES (true,'fac99999-0000-0000-0000-000000000009','cus_R1','sub_R1','price_1UgP8ZCuedlcmwMmeEZr9ev2','aaaaaaaa-0000-0000-0000-0000000000a9','active',now()+interval '20 days');
INSERT INTO public.ritnome_institution_memberships(livemode,user_id,facility_id,active,role) VALUES (true,'99999999-9999-9999-9999-999999999999','fac99999-0000-0000-0000-000000000009',true,'owner');
INSERT INTO public.ritnome_facility_plan(livemode,facility_id,sessions_per_week) VALUES (true,'fac99999-0000-0000-0000-000000000009',5);
INSERT INTO public.ritnome_facility_plan_history(livemode,facility_id,effective_from,sessions_per_week) VALUES (true,'fac99999-0000-0000-0000-000000000009','2000-01-01',5);
INSERT INTO public.ritnome_facility_session(id,livemode,facility_id,user_id,auth_session,role) VALUES ('5e551099-0000-0000-0000-000000000001',true,'fac99999-0000-0000-0000-000000000009','99999999-9999-9999-9999-999999999999','aaaa9999-0000-0000-0000-000000000009','owner');

-- helper: insert a closed run into a recreation session at given PR-local times
CREATE OR REPLACE FUNCTION pg_temp.run(p_rs uuid,p_act text,p_start timestamptz,p_mins int,p_head int,p_part int) RETURNS void LANGUAGE sql AS $$
 INSERT INTO public.ritnome_activity_run(run_id,livemode,facility_id,session_id,facilitator_user_id,activity_key,recreation_session_id,started_at,last_event_at,ended_at,status,headcount,participations,mode)
 VALUES(gen_random_uuid(),true,'fac99999-0000-0000-0000-000000000009','5e551099-0000-0000-0000-000000000001','99999999-9999-9999-9999-999999999999',p_act,p_rs,p_start,p_start+(p_mins||' minutes')::interval,p_start+(p_mins||' minutes')::interval,'closed',p_head,p_part,'group') $$;
CREATE OR REPLACE FUNCTION pg_temp.pr(t text) RETURNS timestamptz LANGUAGE sql AS $$ SELECT (t::timestamp AT TIME ZONE 'America/Puerto_Rico') $$;
CREATE OR REPLACE FUNCTION pg_temp.period(p_from date,p_to date) RETURNS jsonb LANGUAGE sql AS $$ SELECT public.ritnome_rep_period(true,'fac99999-0000-0000-0000-000000000009',p_from,p_to,false) $$;

-- 1. One Today's Session with three activities: 1 session, 3 runs, 20 minutes, participations cumulative, headcount max
DO $$ DECLARE rs uuid; BEGIN
 rs:=public.ritnome_rep_recsession_start('5e551099-0000-0000-0000-000000000001','price_1UgP8ZCuedlcmwMmeEZr9ev2',20,'plan');
 PERFORM pg_temp.run(rs,'conga-party',pg_temp.pr('2026-10-05 10:00'),5,8,8);
 PERFORM pg_temp.run(rs,'la-marquesina',pg_temp.pr('2026-10-05 10:05'),10,8,8);
 PERFORM pg_temp.run(rs,'recall',pg_temp.pr('2026-10-05 10:15'),5,6,6);
 PERFORM public.ritnome_rep_recsession_end('5e551099-0000-0000-0000-000000000001','price_1UgP8ZCuedlcmwMmeEZr9ev2');
END $$;
INSERT INTO r SELECT '3 activities in one plan session → 1 session, 3 runs, 20 minutes', (p->>'sessions')::int=1 AND (p->>'activity_runs')::int=3 AND (p->>'recreation_minutes')::numeric=20 FROM pg_temp.period('2026-10-05','2026-10-06') p;
INSERT INTO r SELECT 'participations cumulative (22), headcount max (8) not sum', (p->>'participations')::int=22 AND (SELECT headcount FROM public.ritnome_rep_sessions_calc(true,'fac99999-0000-0000-0000-000000000009') WHERE day='2026-10-05')=8 FROM pg_temp.period('2026-10-05','2026-10-06') p;
INSERT INTO r SELECT 'participant minutes additive per run (5×8+10×8+5×6=150)', (p->>'estimated_participant_minutes')::int=150 FROM pg_temp.period('2026-10-05','2026-10-06') p;
INSERT INTO r SELECT 'closed session status closed', (SELECT status FROM public.ritnome_recreation_session WHERE source='plan' ORDER BY started_at DESC LIMIT 1)='closed';

-- 2. Two separate plan sessions ten minutes apart stay separate
DO $$ DECLARE a uuid; b uuid; BEGIN
 a:=public.ritnome_rep_recsession_start('5e551099-0000-0000-0000-000000000001','price_1UgP8ZCuedlcmwMmeEZr9ev2',10,'plan'); PERFORM pg_temp.run(a,'conga-party',pg_temp.pr('2026-10-06 09:00'),10,10,10);
 b:=public.ritnome_rep_recsession_start('5e551099-0000-0000-0000-000000000001','price_1UgP8ZCuedlcmwMmeEZr9ev2',10,'plan'); PERFORM pg_temp.run(b,'conga-party',pg_temp.pr('2026-10-06 09:20'),10,12,12);
 PERFORM public.ritnome_rep_recsession_end('5e551099-0000-0000-0000-000000000001','price_1UgP8ZCuedlcmwMmeEZr9ev2');
END $$;
INSERT INTO r SELECT 'two sessions 10 minutes apart → 2 sessions (not merged by time)', (p->>'sessions')::int=2 FROM pg_temp.period('2026-10-06','2026-10-07') p;

-- 3. Standalone launch with nothing open → its own single-activity session; 4. launch while a plan session is open joins it
SELECT public.ritnome_rep_launch_create('5e551099-0000-0000-0000-000000000001','price_1UgP8ZCuedlcmwMmeEZr9ev2','recall','https://hooporia.mobi',repeat('a',64));
INSERT INTO r SELECT 'standalone launch creates a standalone session', (SELECT source FROM public.ritnome_recreation_session WHERE id=(SELECT recreation_session_id FROM public.ritnome_launch_code WHERE code_hash=repeat('a',64)))='standalone';
DO $$ DECLARE a uuid; BEGIN
 a:=public.ritnome_rep_recsession_start('5e551099-0000-0000-0000-000000000001','price_1UgP8ZCuedlcmwMmeEZr9ev2',20,'plan');
 PERFORM public.ritnome_rep_launch_create('5e551099-0000-0000-0000-000000000001','price_1UgP8ZCuedlcmwMmeEZr9ev2','zona','https://vreaction.com',repeat('b',64));
 INSERT INTO r SELECT 'launch during an open plan session joins it', (SELECT recreation_session_id FROM public.ritnome_launch_code WHERE code_hash=repeat('b',64))=a;
 PERFORM public.ritnome_rep_recsession_end('5e551099-0000-0000-0000-000000000001','price_1UgP8ZCuedlcmwMmeEZr9ev2');
END $$;
INSERT INTO r SELECT 'ending a session with no runs marks it abandoned (not counted)', (SELECT status FROM public.ritnome_recreation_session WHERE source='plan' ORDER BY started_at DESC LIMIT 1)='abandoned' AND (p->>'sessions')::int=2 FROM pg_temp.period('2026-10-06','2026-10-07') p;

-- 5. Overlapping runs (two stations) do not double the session minutes
DO $$ DECLARE a uuid; BEGIN
 a:=public.ritnome_rep_recsession_start('5e551099-0000-0000-0000-000000000001','price_1UgP8ZCuedlcmwMmeEZr9ev2',15,'plan');
 PERFORM pg_temp.run(a,'reaction-speed',pg_temp.pr('2026-10-07 10:00'),10,3,3); PERFORM pg_temp.run(a,'swipe-it',pg_temp.pr('2026-10-07 10:05'),10,3,3);
 PERFORM public.ritnome_rep_recsession_end('5e551099-0000-0000-0000-000000000001','price_1UgP8ZCuedlcmwMmeEZr9ev2');
END $$;
INSERT INTO r SELECT 'overlapping runs 10:00–10:10 and 10:05–10:15 → 15 session minutes, 60 participant minutes', (p->>'recreation_minutes')::numeric=15 AND (p->>'estimated_participant_minutes')::int=60 FROM pg_temp.period('2026-10-07','2026-10-08') p;

-- 6. Puerto Rico time: 11:30 PM on Oct 31 PR time is Nov 1 03:30 UTC, and belongs to October
DO $$ DECLARE a uuid; BEGIN
 a:=public.ritnome_rep_recsession_start('5e551099-0000-0000-0000-000000000001','price_1UgP8ZCuedlcmwMmeEZr9ev2',10,'plan');
 PERFORM pg_temp.run(a,'conga-party',pg_temp.pr('2026-10-31 23:30'),10,5,5);
 PERFORM public.ritnome_rep_recsession_end('5e551099-0000-0000-0000-000000000001','price_1UgP8ZCuedlcmwMmeEZr9ev2');
END $$;
INSERT INTO r SELECT 'late-evening session counts in the Puerto Rico month', (SELECT (p->>'sessions')::int FROM pg_temp.period('2026-10-31','2026-11-01') p)=1 AND (SELECT (p->>'sessions')::int FROM pg_temp.period('2026-11-01','2026-11-02') p)=0;

-- 7. Plan history: October planned at 5/week (31 days → 22.1); changing the target today does not rewrite October
INSERT INTO r SELECT 'October planned = 31 days × 5/7 = 22.1', public.ritnome_rep_planned(true,'fac99999-0000-0000-0000-000000000009','2026-10-01','2026-11-01')=22.1;
SELECT public.ritnome_rep_set_plan('5e551099-0000-0000-0000-000000000001','price_1UgP8ZCuedlcmwMmeEZr9ev2',7,NULL);
INSERT INTO r SELECT 'target changed to 7 today: October still 22.1; today applies 7', public.ritnome_rep_planned(true,'fac99999-0000-0000-0000-000000000009','2026-10-01','2026-11-01')=22.1 AND public.ritnome_plan_on(true,'fac99999-0000-0000-0000-000000000009',public.ritnome_pr_today())=7;

-- 8. Legacy run without a parent session is an estimate; abandoned runs never count
INSERT INTO public.ritnome_activity_run(run_id,livemode,facility_id,session_id,facilitator_user_id,activity_key,started_at,last_event_at,ended_at,status,headcount,participations)
 VALUES(gen_random_uuid(),true,'fac99999-0000-0000-0000-000000000009','5e551099-0000-0000-0000-000000000001','99999999-9999-9999-9999-999999999999','recall',pg_temp.pr('2026-10-08 10:00'),pg_temp.pr('2026-10-08 10:05'),pg_temp.pr('2026-10-08 10:05'),'closed',4,4),
       (gen_random_uuid(),true,'fac99999-0000-0000-0000-000000000009','5e551099-0000-0000-0000-000000000001','99999999-9999-9999-9999-999999999999','recall',pg_temp.pr('2026-10-08 10:06'),pg_temp.pr('2026-10-08 10:07'),pg_temp.pr('2026-10-08 10:07'),'abandoned',4,4);
INSERT INTO r SELECT 'legacy run without parent → 1 estimated session; abandoned run ignored', (p->>'sessions')::int=1 AND (p->>'sessions_estimated')::int=1 AND (p->>'activity_runs')::int=1 FROM pg_temp.period('2026-10-08','2026-10-09') p;

-- 9. Management report: month totals, partial flag false for a past month, previous_equivalent, weekly rows planned
INSERT INTO r SELECT 'management October: 6 sessions, 9 runs, not partial, PR timezone', (m->'summary'->>'sessions')::int=6 AND (m->'summary'->>'activity_runs')::int=9 AND (m->>'partial')='false' AND m->>'timezone'='America/Puerto_Rico'
 FROM public.ritnome_rep_management('5e551099-0000-0000-0000-000000000001','price_1UgP8ZCuedlcmwMmeEZr9ev2','2026-10-01') m;
INSERT INTO r SELECT 'management current month is labeled partial with a through date', (m->>'partial')='true' AND (m->>'through')::date=public.ritnome_pr_today()
 FROM public.ritnome_rep_management('5e551099-0000-0000-0000-000000000001','price_1UgP8ZCuedlcmwMmeEZr9ev2',NULL) m;
INSERT INTO r SELECT 'facilitator view separates sessions from activity runs', (f->'last_30_days'->>'sessions') IS NOT NULL AND (f->'last_30_days'->>'activity_runs') IS NOT NULL AND f->>'timezone'='America/Puerto_Rico'
 FROM public.ritnome_rep_facilitator_view('5e551099-0000-0000-0000-000000000001','price_1UgP8ZCuedlcmwMmeEZr9ev2') f;

-- 10. Inactivity lock closes the open recreation session
DO $$ DECLARE a uuid; BEGIN
 a:=public.ritnome_rep_recsession_start('5e551099-0000-0000-0000-000000000001','price_1UgP8ZCuedlcmwMmeEZr9ev2',10,'plan'); PERFORM pg_temp.run(a,'conga-party',now()-interval '40 minutes',5,5,5);
 UPDATE public.ritnome_facility_session SET last_activity_at=now()-interval '31 minutes' WHERE id='5e551099-0000-0000-0000-000000000001';
 PERFORM public.ritnome_rep_session_check('5e551099-0000-0000-0000-000000000001','price_1UgP8ZCuedlcmwMmeEZr9ev2',true);
 INSERT INTO r SELECT 'inactivity lock closes the open recreation session', (SELECT status FROM public.ritnome_recreation_session WHERE id=a)='closed';
END $$;
SELECT name, CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS outcome FROM r;
SELECT count(*) FILTER (WHERE pass) AS pass, count(*) FILTER (WHERE NOT pass) AS fail FROM r;
