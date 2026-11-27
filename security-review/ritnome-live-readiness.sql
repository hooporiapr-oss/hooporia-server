-- Run after the base migrations, legacy license permission release and live enrollment extension.
BEGIN;
CREATE FUNCTION public.ritnome_live_release_ready() RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT NOT has_table_privilege('anon','public.licenses','SELECT,INSERT,UPDATE,DELETE')
 AND NOT has_table_privilege('authenticated','public.licenses','SELECT,INSERT,UPDATE,DELETE')
 AND NOT has_any_column_privilege('anon','public.licenses','SELECT')
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='licenses')
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_tables WHERE schemaname='public' AND tablename IN ('bm_players','bm_campaigns','dia_players','payouts'))
 AND (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('ritnome_enrollment','ritnome_subscription_registry','ritnome_stripe_inbox','ritnome_decision_audit','ritnome_institution_memberships') AND c.relrowsecurity)=5
 AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['public.ritnome_enrollment','public.ritnome_subscription_registry','public.ritnome_stripe_inbox','public.ritnome_decision_audit','public.ritnome_institution_memberships']) AS t(name) WHERE has_table_privilege('anon',t.name,'SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('authenticated',t.name,'SELECT,INSERT,UPDATE,DELETE'))
 AND has_function_privilege('service_role','public.ritnome_live_claim_checkout(uuid,uuid)','EXECUTE')
 AND has_function_privilege('service_role','public.ritnome_live_bind_checkout(uuid,uuid,text,text,text,text)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.ritnome_live_bind_checkout(uuid,uuid,text,text,text,text)','EXECUTE')
 AND NOT has_function_privilege('anon','public.ritnome_live_bind_checkout(uuid,uuid,text,text,text,text)','EXECUTE');
$$;
REVOKE ALL ON FUNCTION public.ritnome_live_release_ready() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ritnome_live_release_ready() TO service_role;
COMMIT;
