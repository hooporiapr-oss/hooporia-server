-- Trial rules. Run after apply-local.sh on a fresh database. Prints one row per check.
\set ON_ERROR_STOP on
CREATE TEMP TABLE r(name text, pass boolean); GRANT ALL ON r TO service_role;
INSERT INTO auth.users(id,email) VALUES ('77777777-7777-7777-7777-777777777777','trial@a') ON CONFLICT DO NOTHING;
INSERT INTO auth.sessions(id,user_id) VALUES ('aaaa7777-0000-0000-0000-000000000007','77777777-7777-7777-7777-777777777777') ON CONFLICT DO NOTHING;
SET ROLE service_role;
INSERT INTO public.licenses(id,code,school_name,product) VALUES ('aaaaaaaa-0000-0000-0000-0000000000a7','LIC-T','T','ritnome_institutional') ON CONFLICT DO NOTHING;
INSERT INTO public.ritnome_enrollment(livemode,owner_id,facility_id,facility_name,facility_type,approved_license_id,checkout_session_id,stripe_customer_id) VALUES (true,'77777777-7777-7777-7777-777777777777','fac77777-0000-0000-0000-000000000007','T','residence','aaaaaaaa-0000-0000-0000-0000000000a7','cs_live_T1','cus_T1');
INSERT INTO public.ritnome_subscription_registry(livemode,facility_id,stripe_customer_id,stripe_subscription_id,stripe_price_id,license_id,billing_status,paid_through) VALUES (true,'fac77777-0000-0000-0000-000000000007','cus_T1','sub_T1','price_1UgP8ZCuedlcmwMmeEZr9ev2','aaaaaaaa-0000-0000-0000-0000000000a7','pending',NULL);
INSERT INTO public.ritnome_institution_memberships(livemode,user_id,facility_id,active,role) VALUES (true,'77777777-7777-7777-7777-777777777777','fac77777-0000-0000-0000-000000000007',true,'owner');
INSERT INTO public.ritnome_stripe_inbox(livemode,stripe_event_id,subscription_id,event_type,event_created) VALUES (true,'evt_T1','sub_T1','customer.subscription.updated',1),(true,'evt_T2','sub_T1','customer.subscription.updated',2),(true,'evt_T3','sub_T1','customer.subscription.updated',3),(true,'evt_T4','sub_T1','invoice.paid',4);
INSERT INTO r SELECT 'pending: no access', NOT public.ritnome_institution_authorized(true,'77777777-7777-7777-7777-777777777777','aaaa7777-0000-0000-0000-000000000007','price_1UgP8ZCuedlcmwMmeEZr9ev2');
-- 1. first trial commits
INSERT INTO r SELECT 'trial commit accepted', public.ritnome_commit_decision(true,'evt_T1','sub_T1',0,'trialing',now()+interval '14 days','reconcile','verified_trial_period')='committed';
INSERT INTO r SELECT 'trialing with future paid_through: access granted', public.ritnome_institution_authorized(true,'77777777-7777-7777-7777-777777777777','aaaa7777-0000-0000-0000-000000000007','price_1UgP8ZCuedlcmwMmeEZr9ev2');
-- 2. a second trial extension is refused (paid_through no longer NULL)
DO $$ BEGIN
 BEGIN PERFORM public.ritnome_commit_decision(true,'evt_T2','sub_T1',1,'trialing',now()+interval '20 days','reconcile','verified_trial_period'); INSERT INTO r VALUES('second trial extension refused',false);
 EXCEPTION WHEN OTHERS THEN INSERT INTO r VALUES('second trial extension refused',SQLERRM LIKE '%cannot extend%'); END;
END $$;
-- 3. a trial longer than 15 days is refused even as a first entitlement
UPDATE public.ritnome_subscription_registry SET paid_through=NULL,billing_status='pending' WHERE stripe_subscription_id='sub_T1';
DO $$ DECLARE rev bigint; BEGIN
 SELECT revision INTO rev FROM public.ritnome_subscription_registry WHERE stripe_subscription_id='sub_T1';
 BEGIN PERFORM public.ritnome_commit_decision(true,'evt_T2','sub_T1',rev,'trialing',now()+interval '16 days','reconcile','verified_trial_period'); INSERT INTO r VALUES('16-day trial refused',false);
 EXCEPTION WHEN OTHERS THEN INSERT INTO r VALUES('16-day trial refused',SQLERRM LIKE '%cannot extend%'); END;
END $$;
-- 4. a non-trial non-active status still cannot set a first paid_through
DO $$ DECLARE rev bigint; BEGIN
 SELECT revision INTO rev FROM public.ritnome_subscription_registry WHERE stripe_subscription_id='sub_T1';
 BEGIN PERFORM public.ritnome_commit_decision(true,'evt_T3','sub_T1',rev,'past_due',now()+interval '14 days','reconcile','x'); INSERT INTO r VALUES('past_due cannot set first entitlement',false);
 EXCEPTION WHEN OTHERS THEN INSERT INTO r VALUES('past_due cannot set first entitlement',SQLERRM LIKE '%cannot extend%'); END;
END $$;
-- 5. after the trial, a paid active period extends as before
DO $$ DECLARE rev bigint; BEGIN
 SELECT revision INTO rev FROM public.ritnome_subscription_registry WHERE stripe_subscription_id='sub_T1';
 PERFORM public.ritnome_commit_decision(true,'evt_T2','sub_T1',rev,'trialing',now()+interval '14 days','reconcile','verified_trial_period');
 SELECT revision INTO rev FROM public.ritnome_subscription_registry WHERE stripe_subscription_id='sub_T1';
 INSERT INTO r SELECT 'paid period after trial extends', public.ritnome_commit_decision(true,'evt_T4','sub_T1',rev,'active',now()+interval '44 days','reconcile','verified_paid_period')='committed';
END $$;
SELECT name, CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS outcome FROM r;
SELECT count(*) FILTER (WHERE pass) AS pass, count(*) FILTER (WHERE NOT pass) AS fail FROM r;
