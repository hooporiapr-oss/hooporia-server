-- Ritnome Institutional — DEMONSTRATION FACILITY (operator script, run once).
-- Creates one clearly fictional facility for the operator's own testing and sales presentations:
--   * owner = the existing Supabase Auth user with the email below (created by the operator with their own password)
--   * access via a registry row with placeholder Stripe-format ids that do not exist in Stripe: no checkout, no charge,
--     no webhook will ever reference them, so the worker never touches this row
--   * all 16 activities (the catalog is global), all Progress View reports, participant handles enabled
--   * eight weeks of fictional history so every report has content; new sessions can be run from the desk
-- Isolation: its own facility_id; every report and desk query is facility-scoped. Nothing here changes Stripe,
-- enrollment code, other facilities, prices or the subscription flow. To retire it: set enabled=false on its enrollment.
DO $$
DECLARE
 owner_email text := 'gostardigital@gmail.com';
 P text := 'price_1UgP8ZCuedlcmwMmeEZr9ev2';
 O uuid; LIC uuid; FAC uuid := gen_random_uuid(); FS uuid; rs uuid; run uuid;
 tday date := public.ritnome_pr_today(); d0 date; d date; t0 timestamptz; i int := 0; j int; k int; m int; hc int; mins int; act text; md text;
 handles uuid[] := ARRAY[]::uuid[]; h uuid; acts text[] := ARRAY['conga-party','lelolai-letras','la-marquesina','solitario-boricua','la-isla','reaction-speed','zona','zona-roja','swipe-it','reactific','encadena','recall','recognition','replay','the-fortress','the-reset'];
 grp text[] := ARRAY['conga-party','la-marquesina','encadena','the-reset'];
 lens int[] := ARRAY[10,8,15,8,10,5,5,5,5,5,10,5,5,5,8,3];
 bpm int; lvl int; payload jsonb; res jsonb; n int;
BEGIN
 SELECT id INTO O FROM auth.users WHERE lower(email)=lower(owner_email);
 IF O IS NULL THEN RAISE EXCEPTION 'Create the owner user in Supabase Auth first (%).',owner_email; END IF;
 IF EXISTS(SELECT 1 FROM public.ritnome_enrollment WHERE owner_id=O) THEN RAISE EXCEPTION 'This user already owns a facility; nothing changed.'; END IF;
 d0 := tday-56;
 INSERT INTO public.licenses(code,school_name,product) VALUES ('RITNOME-DEMO-01','Residencia Demostración Ritnome (ficticia)','ritnome_institutional') RETURNING id INTO LIC;
 INSERT INTO public.ritnome_enrollment(livemode,owner_id,facility_id,facility_name,facility_type,approved_license_id,created_at)
  VALUES (true,O,FAC,'Residencia Demostración Ritnome (ficticia)','residence',LIC,(d0::timestamp+time '08:00') AT TIME ZONE 'America/Puerto_Rico');
 INSERT INTO public.ritnome_subscription_registry(livemode,facility_id,stripe_customer_id,stripe_subscription_id,stripe_price_id,license_id,billing_status,paid_through,created_at)
  VALUES (true,FAC,'cus_RitnomeDemo01','sub_RitnomeDemo01',P,LIC,'active','2030-12-31T23:59:59Z',(d0::timestamp+time '08:00') AT TIME ZONE 'America/Puerto_Rico');
 INSERT INTO public.ritnome_institution_memberships(livemode,user_id,facility_id,active,role) VALUES (true,O,FAC,true,'owner');
 INSERT INTO public.ritnome_facility_plan(livemode,facility_id,sessions_per_week,handles_enabled) VALUES (true,FAC,5,true);
 INSERT INTO public.ritnome_facility_plan_history(livemode,facility_id,effective_from,sessions_per_week) VALUES (true,FAC,d0,5);
 -- a closed desk session that owns the fictional history
 INSERT INTO public.ritnome_facility_session(livemode,facility_id,user_id,auth_session,role,created_at,last_activity_at,expires_at,ended_at)
  VALUES (true,FAC,O,gen_random_uuid(),'owner',now(),now(),now(),now()) RETURNING id INTO FS;
 FOR k IN 1..6 LOOP
  INSERT INTO public.ritnome_participant_handle(livemode,facility_id,created_at) VALUES (true,FAC,(d0::timestamp+time '08:30') AT TIME ZONE 'America/Puerto_Rico') RETURNING handle_id INTO h;
  handles := handles||h;
 END LOOP;
 -- weekdays from d0 to yesterday; about one weekday in eleven skipped; Wednesdays add an afternoon session
 FOR d IN SELECT g::date FROM generate_series(d0,tday-1,interval '1 day') g LOOP
  CONTINUE WHEN extract(isodow FROM d) > 5;
  i := i+1;
  CONTINUE WHEN i % 11 = 4;
  FOR n IN 1..(CASE WHEN extract(isodow FROM d)=3 THEN 2 ELSE 1 END) LOOP
   t0 := (d::timestamp + CASE WHEN n=1 THEN time '10:00' ELSE time '14:00' END) AT TIME ZONE 'America/Puerto_Rico';
   hc := 6 + ((i*7+n*3) % 7);
   INSERT INTO public.ritnome_recreation_session(livemode,facility_id,session_id,facilitator_user_id,source,planned_minutes,status,started_at,ended_at)
    VALUES (true,FAC,FS,O,CASE WHEN n=2 AND i%2=0 THEN 'standalone' ELSE 'plan' END,30,'closed',t0,t0) RETURNING id INTO rs;
   m := 0;
   FOR j IN 1..(CASE WHEN n=2 THEN 2 ELSE 3 END) LOOP
    k := 1 + ((i*3 + j*5 + n) % 16);
    act := acts[k]; mins := lens[k]; md := CASE WHEN act = ANY(grp) THEN 'group' ELSE 'individual' END;
    bpm := CASE WHEN act='conga-party' THEN 84 + ((i+j)%5)*4 ELSE NULL END;
    payload := jsonb_strip_nulls(jsonb_build_object('mode',md,'language','es','group_bpm',bpm,'setting',CASE WHEN act='reaction-speed' THEN 'comfort' END,'headcount',hc,'participations',hc));
    INSERT INTO public.ritnome_activity_run(run_id,livemode,facility_id,session_id,facilitator_user_id,activity_key,mode,language,device_class,started_at,last_event_at,ended_at,status,headcount,participations,interactions,last_seq,recreation_session_id)
     VALUES (gen_random_uuid(),true,FAC,FS,O,act,md,'es','tablet',t0+make_interval(mins=>m),t0+make_interval(mins=>m+mins),t0+make_interval(mins=>m+mins),'closed',hc,hc,hc*6,2,rs) RETURNING run_id INTO run;
    INSERT INTO public.ritnome_activity_event(run_id,seq,kind,payload,received_at) VALUES (run,1,'start',payload,t0+make_interval(mins=>m)),(run,2,'end','{}'::jsonb,t0+make_interval(mins=>m+mins));
    -- individual progress for four of the six fictional participants; tempo only where the activity measures it individually
    FOR k IN 1..4 LOOP
     h := handles[1 + ((i + k + j) % 6)];
     IF act='reaction-speed' THEN bpm := 58 + ((i + k*3) % 7)*2; res := jsonb_build_object('bpm',bpm);
     ELSIF act IN ('recall','recognition','replay','the-fortress') THEN bpm := NULL; lvl := least(8, 2 + (i/6) + (k%2)); res := jsonb_build_object('level',lvl);
     ELSE bpm := NULL; res := '{"completed":1}'::jsonb; END IF;
     INSERT INTO public.ritnome_participant_progress(handle_id,run_id,seq,activity_key,setting,personal_bpm,minutes,result,recorded_at)
      VALUES (h,run,k,act,CASE WHEN act='reaction-speed' THEN 'comfort' ELSE 'default' END,bpm,mins,res,t0+make_interval(mins=>m+mins))
      ON CONFLICT DO NOTHING;
    END LOOP;
    m := m+mins;
   END LOOP;
   UPDATE public.ritnome_recreation_session SET ended_at=t0+make_interval(mins=>m) WHERE id=rs;
  END LOOP;
 END LOOP;
 RAISE NOTICE 'Demo facility % created for %', FAC, owner_email;
END $$;
