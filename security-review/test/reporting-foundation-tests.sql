-- Phase 1 reporting foundation tests. Run as a superuser on the disposable database after all migrations.
-- Fixtures: two facilities (A, B), each with an owner and one facilitator, active live subscriptions.
\set ON_ERROR_STOP on
\set QUIET on
SET client_min_messages = warning;
BEGIN;
SELECT set_config('t.pass','0',false), set_config('t.fail','0',false);
CREATE TEMP TABLE t_result(name text, ok boolean);
GRANT ALL ON t_result TO service_role;
CREATE OR REPLACE FUNCTION pg_temp.check(n text, v boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN INSERT INTO t_result VALUES(n, coalesce(v,false)); END $$;

-- fixtures
INSERT INTO auth.users(id,email) VALUES
 ('11111111-1111-1111-1111-111111111111','owner-a@test'),('22222222-2222-2222-2222-222222222222','staff-a@test'),
 ('33333333-3333-3333-3333-333333333333','owner-b@test'),('44444444-4444-4444-4444-444444444444','staff-b@test');
INSERT INTO auth.sessions(id,user_id) VALUES
 ('aaaa1111-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111'),('aaaa2222-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222'),
 ('bbbb3333-0000-0000-0000-000000000003','33333333-3333-3333-3333-333333333333'),('bbbb4444-0000-0000-0000-000000000004','44444444-4444-4444-4444-444444444444');
INSERT INTO public.licenses(id,code,school_name,product) VALUES ('aaaaaaaa-0000-0000-0000-0000000000aa','LIC-A','Facility A','ritnome_institutional'),('bbbbbbbb-0000-0000-0000-0000000000bb','LIC-B','Facility B','ritnome_institutional');
INSERT INTO public.ritnome_enrollment(livemode,owner_id,facility_id,facility_name,facility_type,approved_license_id,checkout_session_id,stripe_customer_id) VALUES
 (true,'11111111-1111-1111-1111-111111111111','facaaaaa-0000-0000-0000-00000000000a','Facility A','residence','aaaaaaaa-0000-0000-0000-0000000000aa','cs_live_A1','cus_A1'),
 (true,'33333333-3333-3333-3333-333333333333','facbbbbb-0000-0000-0000-00000000000b','Facility B','assisted','bbbbbbbb-0000-0000-0000-0000000000bb','cs_live_B1','cus_B1');
INSERT INTO public.ritnome_subscription_registry(livemode,facility_id,stripe_customer_id,stripe_subscription_id,stripe_price_id,license_id,billing_status,paid_through) VALUES
 (true,'facaaaaa-0000-0000-0000-00000000000a','cus_A1','sub_A1','price_1UgP8ZCuedlcmwMmeEZr9ev2','aaaaaaaa-0000-0000-0000-0000000000aa','active',now()+interval '20 days'),
 (true,'facbbbbb-0000-0000-0000-00000000000b','cus_B1','sub_B1','price_1UgP8ZCuedlcmwMmeEZr9ev2','bbbbbbbb-0000-0000-0000-0000000000bb','active',now()+interval '20 days');
INSERT INTO public.ritnome_institution_memberships(livemode,user_id,facility_id,active,role) VALUES
 (true,'11111111-1111-1111-1111-111111111111','facaaaaa-0000-0000-0000-00000000000a',true,'owner'),(true,'22222222-2222-2222-2222-222222222222','facaaaaa-0000-0000-0000-00000000000a',true,'facilitator'),
 (true,'33333333-3333-3333-3333-333333333333','facbbbbb-0000-0000-0000-00000000000b',true,'owner'),(true,'44444444-4444-4444-4444-444444444444','facbbbbb-0000-0000-0000-00000000000b',true,'facilitator');
\set P 'price_1UgP8ZCuedlcmwMmeEZr9ev2'
SET LOCAL ROLE service_role;

-- 1. session open
CREATE TEMP TABLE t_s AS SELECT 'A_staff' who, * FROM public.ritnome_rep_session_open(true,'22222222-2222-2222-2222-222222222222','aaaa2222-0000-0000-0000-000000000002',:'P');
INSERT INTO t_s SELECT 'A_owner', * FROM public.ritnome_rep_session_open(true,'11111111-1111-1111-1111-111111111111','aaaa1111-0000-0000-0000-000000000001',:'P');
INSERT INTO t_s SELECT 'B_staff', * FROM public.ritnome_rep_session_open(true,'44444444-4444-4444-4444-444444444444','bbbb4444-0000-0000-0000-000000000004',:'P');
SELECT pg_temp.check('session opens for an authorized facilitator with role and facility', (SELECT role='facilitator' AND facility_id='facaaaaa-0000-0000-0000-00000000000a' AND expires_at BETWEEN now()+interval '7 hours 59 minutes' AND now()+interval '8 hours 1 minute' FROM t_s WHERE who='A_staff'));
SELECT pg_temp.check('owner session carries owner role', (SELECT role='owner' FROM t_s WHERE who='A_owner'));
SELECT pg_temp.check('wrong auth session is refused', NOT EXISTS(SELECT 1 FROM public.ritnome_rep_session_open(true,'22222222-2222-2222-2222-222222222222','bbbb4444-0000-0000-0000-000000000004',:'P')));
SELECT pg_temp.check('unknown user is refused', NOT EXISTS(SELECT 1 FROM public.ritnome_rep_session_open(true,gen_random_uuid(),gen_random_uuid(),:'P')));
SELECT pg_temp.check('session check ok', (SELECT ok FROM public.ritnome_rep_session_check((SELECT session_id FROM t_s WHERE who='A_staff'),:'P')));
SELECT pg_temp.check('unknown session check fails closed', (SELECT NOT ok AND reason='no_session' FROM public.ritnome_rep_session_check(gen_random_uuid(),:'P')));

-- 2. launch code: single use, 60 s, origin bound
\set CA 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
\set TA '1111111111111111111111111111111111111111111111111111111111111111'
SELECT pg_temp.check('launch code created', public.ritnome_rep_launch_create((SELECT session_id FROM t_s WHERE who='A_staff'),:'P','conga-party','https://ritnome.com',:'CA'));
SELECT pg_temp.check('exchange from wrong origin refused and code consumed', (SELECT NOT ok AND reason='origin' FROM public.ritnome_rep_launch_exchange(:'CA','https://evil.test',:'TA',:'P')));
SELECT pg_temp.check('consumed code cannot be reused (replay)', (SELECT NOT ok AND reason='used' FROM public.ritnome_rep_launch_exchange(:'CA','https://ritnome.com',:'TA',:'P')));
\set CB 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
SELECT public.ritnome_rep_launch_create((SELECT session_id FROM t_s WHERE who='A_staff'),:'P','conga-party','https://ritnome.com',:'CB');
SELECT pg_temp.check('exchange ok returns activity and no facility or user data', (SELECT ok AND activity_key='conga-party' AND handles_enabled=false FROM public.ritnome_rep_launch_exchange(:'CB','https://ritnome.com',:'TA',:'P')));
SELECT pg_temp.check('second exchange of the same code refused', (SELECT NOT ok FROM public.ritnome_rep_launch_exchange(:'CB','https://ritnome.com','2222222222222222222222222222222222222222222222222222222222222222',:'P')));
\set CC 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
SELECT public.ritnome_rep_launch_create((SELECT session_id FROM t_s WHERE who='A_staff'),:'P','recall','https://hooporia.mobi',:'CC');
UPDATE public.ritnome_launch_code SET expires_at=now()-interval '1 second' WHERE code_hash=:'CC';
SELECT pg_temp.check('expired code refused', (SELECT NOT ok AND reason='expired' FROM public.ritnome_rep_launch_exchange(:'CC','https://hooporia.mobi','3333333333333333333333333333333333333333333333333333333333333333',:'P')));

-- 3. idempotent reporting
\set R1 '99990000-0000-0000-0000-000000000001'
SELECT pg_temp.check('first event must be seq 1 start', (SELECT outcome='out_of_order' FROM public.ritnome_rep_report(:'TA','https://ritnome.com',:'P',:'R1',2,'checkpoint','{}')));
SELECT pg_temp.check('start accepted', (SELECT outcome='accepted' AND high_seq=1 FROM public.ritnome_rep_report(:'TA','https://ritnome.com',:'P',:'R1',1,'start','{"mode":"group","headcount":8,"device_class":"tablet"}')));
SELECT pg_temp.check('retry of seq 1 is a duplicate, not a second run', (SELECT outcome='duplicate' AND high_seq=1 FROM public.ritnome_rep_report(:'TA','https://ritnome.com',:'P',:'R1',1,'start','{"mode":"group","headcount":8}')) AND (SELECT count(*)=1 FROM public.ritnome_activity_event WHERE run_id=:'R1'));
SELECT pg_temp.check('checkpoint accepted and counters updated', (SELECT outcome='accepted' FROM public.ritnome_rep_report(:'TA','https://ritnome.com',:'P',:'R1',2,'checkpoint','{"participations":8,"interactions":120}')));
SELECT pg_temp.check('checkpoint counters stored on the run', (SELECT participations=8 AND interactions=120 FROM public.ritnome_activity_run WHERE run_id=:'R1'));
SELECT pg_temp.check('gap in sequence refused with high-water mark', (SELECT outcome='out_of_order' AND high_seq=2 FROM public.ritnome_rep_report(:'TA','https://ritnome.com',:'P',:'R1',4,'checkpoint','{}')));
SELECT pg_temp.check('unknown payload key refused', (SELECT outcome='invalid' FROM public.ritnome_rep_report(:'TA','https://ritnome.com',:'P',:'R1',3,'checkpoint','{"resident_name":"x"}')));
SELECT pg_temp.check('wrong origin with a valid token refused', (SELECT outcome='denied' FROM public.ritnome_rep_report(:'TA','https://evil.test',:'P',:'R1',3,'checkpoint','{}')));
SELECT pg_temp.check('end closes the run', (SELECT outcome='accepted' FROM public.ritnome_rep_report(:'TA','https://ritnome.com',:'P',:'R1',3,'end','{"participations":9}')));
SELECT pg_temp.check('run marked closed with final participations', (SELECT status='closed' AND ended_at IS NOT NULL AND participations=9 FROM public.ritnome_activity_run WHERE run_id=:'R1'));
SELECT pg_temp.check('events after end refused', (SELECT outcome='closed' FROM public.ritnome_rep_report(:'TA','https://ritnome.com',:'P',:'R1',4,'checkpoint','{}')));

-- 4. facility isolation: facility B cannot touch A's run even with a valid B token and A's run_id
\set CBB 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
\set TB '4444444444444444444444444444444444444444444444444444444444444444'
SELECT public.ritnome_rep_launch_create((SELECT session_id FROM t_s WHERE who='B_staff'),:'P','conga-party','https://ritnome.com',:'CBB');
SELECT public.ritnome_rep_launch_exchange(:'CBB','https://ritnome.com',:'TB',:'P');
SELECT pg_temp.check('another facility cannot append to a run it does not own', (SELECT outcome='denied' FROM public.ritnome_rep_report(:'TB','https://ritnome.com',:'P',:'R1',4,'checkpoint','{}')));
SELECT pg_temp.check('another facility cannot reuse the run_id to start its own run', (SELECT outcome='denied' FROM public.ritnome_rep_report(:'TB','https://ritnome.com',:'P',:'R1',1,'start','{}')) AND (SELECT facility_id='facaaaaa-0000-0000-0000-00000000000a' FROM public.ritnome_activity_run WHERE run_id=:'R1'));
SELECT pg_temp.check('facility B view shows none of A', (SELECT (v->'last_30_days'->>'sessions')::int=0 FROM public.ritnome_rep_facilitator_view((SELECT session_id FROM t_s WHERE who='B_staff'),:'P') v));
SELECT pg_temp.check('facility A view shows its run', (SELECT (v->'last_30_days'->>'sessions')::int=1 AND (v->'today'->>'participations')::int=9 FROM public.ritnome_rep_facilitator_view((SELECT session_id FROM t_s WHERE who='A_staff'),:'P') v));

-- 5. roles and plan
SELECT pg_temp.check('facilitator cannot read management report', (SELECT (v->>'ok')='false' AND v->>'reason'='role' FROM public.ritnome_rep_management((SELECT session_id FROM t_s WHERE who='A_staff'),:'P') v));
SELECT pg_temp.check('facilitator cannot set the plan', NOT public.ritnome_rep_set_plan((SELECT session_id FROM t_s WHERE who='A_staff'),:'P',7,true));
SELECT pg_temp.check('owner sets planned sessions and handle opt-in', public.ritnome_rep_set_plan((SELECT session_id FROM t_s WHERE who='A_owner'),:'P',7,true));
SELECT pg_temp.check('plan stored: 7 sessions per week, handles on', (SELECT sessions_per_week=7 AND handles_enabled FROM public.ritnome_facility_plan WHERE facility_id='facaaaaa-0000-0000-0000-00000000000a'));
SELECT pg_temp.check('management report: sessions, participations, minutes, variety, active days, planned, trend, popularity', (SELECT (v->>'ok')='true' AND (v->'summary'->>'sessions')::int=1 AND (v->'summary'->>'participations')::int=9 AND (v->'summary'->>'activity_variety')::int=1 AND (v->'summary'->>'active_days')::int=1 AND (v->>'planned_sessions_per_week')::int=7 AND jsonb_array_length(v->'trend')=6 AND (v->'popular_activities'->0->>'activity')='conga-party' AND (v->'summary'->>'unique_participants_tracked')='true' FROM public.ritnome_rep_management((SELECT session_id FROM t_s WHERE who='A_owner'),:'P') v));
SELECT pg_temp.check('estimated participant minutes distinct from recreation minutes', (SELECT (v->'summary'->>'estimated_participant_minutes')::numeric >= (v->'summary'->>'recreation_minutes')::numeric FROM public.ritnome_rep_management((SELECT session_id FROM t_s WHERE who='A_owner'),:'P') v));

-- 6. handles and individual progress (opt-in), rejected for facility B (opted out)
CREATE TEMP TABLE t_h AS SELECT public.ritnome_rep_handle_create((SELECT session_id FROM t_s WHERE who='A_owner'),:'P') h;
SELECT pg_temp.check('owner creates a handle when opted in', (SELECT h IS NOT NULL FROM t_h));
SELECT pg_temp.check('facility B (opted out) cannot create handles', public.ritnome_rep_handle_create((SELECT session_id FROM t_s WHERE who='B_staff'),:'P') IS NULL);
\set CE 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
\set TE '5555555555555555555555555555555555555555555555555555555555555555'
\set R2 '99990000-0000-0000-0000-000000000002'
SELECT public.ritnome_rep_launch_create((SELECT session_id FROM t_s WHERE who='A_staff'),:'P','recall','https://hooporia.mobi',:'CE');
SELECT public.ritnome_rep_launch_exchange(:'CE','https://hooporia.mobi',:'TE',:'P');
SELECT public.ritnome_rep_report(:'TE','https://hooporia.mobi',:'P',:'R2',1,'start','{"mode":"individual","headcount":1}');
SELECT pg_temp.check('progress for a facility handle recorded', (SELECT outcome='accepted' FROM public.ritnome_rep_report(:'TE','https://hooporia.mobi',:'P',:'R2',2,'progress',jsonb_build_object('handle_id',(SELECT h FROM t_h),'setting','level-2','minutes',6.5,'personal_bpm',72,'result','{"levels":3}'::jsonb))));
SELECT pg_temp.check('one progress row stored under the handle', (SELECT count(*)=1 FROM public.ritnome_participant_progress));
SELECT pg_temp.check('progress with a foreign or unknown handle refused', (SELECT outcome='invalid_handle' FROM public.ritnome_rep_report(:'TE','https://hooporia.mobi',:'P',:'R2',3,'progress',jsonb_build_object('handle_id',gen_random_uuid(),'minutes',1))));
SELECT pg_temp.check('no pseudonym stored in the activity event stream', NOT EXISTS(SELECT 1 FROM public.ritnome_activity_event WHERE payload ? 'handle_id'));
SELECT pg_temp.check('individual progress report: baseline + latest per activity and setting, no interpretation fields', (SELECT (v->>'ok')='true' AND (v->'participation'->>'runs')::int=1 AND jsonb_array_length(v->'personal_bpm')=1 AND (v->'by_activity'->0->>'setting')='level-2' FROM public.ritnome_rep_individual((SELECT session_id FROM t_s WHERE who='A_owner'),:'P',(SELECT h FROM t_h)) v));
SELECT pg_temp.check('facility B cannot read A handle', (SELECT (v->>'ok')='false' FROM public.ritnome_rep_individual((SELECT session_id FROM t_s WHERE who='B_staff'),:'P',(SELECT h FROM t_h)) v));
SELECT pg_temp.check('unique participants counted from handles', (SELECT (v->'summary'->>'unique_participants')::int=1 FROM public.ritnome_rep_management((SELECT session_id FROM t_s WHERE who='A_owner'),:'P') v));

-- 7. inactivity lock, unlock, expiry
UPDATE public.ritnome_facility_session SET last_activity_at=now()-interval '31 minutes' WHERE id=(SELECT session_id FROM t_s WHERE who='A_staff');
SELECT pg_temp.check('inactive session locks and open run is abandoned', (SELECT NOT ok AND reason='locked' FROM public.ritnome_rep_session_check((SELECT session_id FROM t_s WHERE who='A_staff'),:'P')));
SELECT pg_temp.check('open run abandoned at lock', (SELECT status='abandoned' FROM public.ritnome_activity_run WHERE run_id=:'R2'));
SELECT pg_temp.check('locked session cannot report', (SELECT outcome='denied' FROM public.ritnome_rep_report(:'TE','https://hooporia.mobi',:'P',:'R2',3,'checkpoint','{}')));
SELECT pg_temp.check('unlock by a different user refused', NOT public.ritnome_rep_session_unlock((SELECT session_id FROM t_s WHERE who='A_staff'),'44444444-4444-4444-4444-444444444444','bbbb4444-0000-0000-0000-000000000004',:'P'));
SELECT pg_temp.check('unlock by the same user and auth session', public.ritnome_rep_session_unlock((SELECT session_id FROM t_s WHERE who='A_staff'),'22222222-2222-2222-2222-222222222222','aaaa2222-0000-0000-0000-000000000002',:'P') AND (SELECT ok FROM public.ritnome_rep_session_check((SELECT session_id FROM t_s WHERE who='A_staff'),:'P')));
UPDATE public.ritnome_facility_session SET expires_at=now()-interval '1 second' WHERE id=(SELECT session_id FROM t_s WHERE who='A_staff');
SELECT pg_temp.check('eight-hour expiry ends the session', (SELECT NOT ok AND reason='expired' FROM public.ritnome_rep_session_check((SELECT session_id FROM t_s WHERE who='A_staff'),:'P')));

-- 8. revocation is immediate: deactivate B staff membership, then end B enrollment
UPDATE public.ritnome_institution_memberships SET active=false WHERE user_id='44444444-4444-4444-4444-444444444444';
SELECT pg_temp.check('deactivated staff membership: next check revoked', (SELECT NOT ok AND reason='revoked' FROM public.ritnome_rep_session_check((SELECT session_id FROM t_s WHERE who='B_staff'),:'P')));
SELECT pg_temp.check('revoked token cannot report', (SELECT outcome='denied' FROM public.ritnome_rep_report(:'TB','https://ritnome.com',:'P','99990000-0000-0000-0000-000000000009',1,'start','{}')));
UPDATE public.ritnome_subscription_registry SET billing_status='canceled', paid_through=now()-interval '1 day' WHERE facility_id='facaaaaa-0000-0000-0000-00000000000a';
SELECT pg_temp.check('lapsed subscription: owner session revoked on next request', (SELECT NOT ok AND reason='revoked' FROM public.ritnome_rep_session_check((SELECT session_id FROM t_s WHERE who='A_owner'),:'P')));
SELECT pg_temp.check('lapsed subscription: new session refused', NOT EXISTS(SELECT 1 FROM public.ritnome_rep_session_open(true,'11111111-1111-1111-1111-111111111111','aaaa1111-0000-0000-0000-000000000001',:'P')));

-- 9. retention purge records an audit row
SELECT pg_temp.check('retention purge runs and is audited', (SELECT events_deleted=0 FROM public.ritnome_rep_retention_purge()));
SELECT pg_temp.check('retention audit row written', (SELECT count(*)=1 FROM public.ritnome_retention_audit));

-- 10. privileges: nothing reachable by anon/authenticated
SELECT pg_temp.check('anon/authenticated cannot execute reporting functions', NOT has_function_privilege('anon','public.ritnome_rep_report(text,text,text,uuid,integer,text,jsonb)','EXECUTE') AND NOT has_function_privilege('authenticated','public.ritnome_rep_management(uuid,text,date)','EXECUTE'));
SELECT pg_temp.check('anon/authenticated cannot read reporting tables', NOT has_table_privilege('authenticated','public.ritnome_activity_run','SELECT') AND NOT has_table_privilege('anon','public.ritnome_participant_progress','SELECT'));
SELECT pg_temp.check('release readiness still true', public.ritnome_live_release_ready());

\set QUIET off
SELECT name, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result FROM t_result ORDER BY (SELECT NULL);
SELECT count(*) FILTER (WHERE ok) AS pass, count(*) FILTER (WHERE NOT ok) AS fail FROM t_result;
ROLLBACK;
