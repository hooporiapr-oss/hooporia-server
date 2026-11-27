-- Ritnome institutional — Phase 3 staff management (dedicated live project only). Owner-only; facility derived from the session.
-- staff_list and staff_add are SECURITY DEFINER solely to read auth.users (email, existence); they are executable by service_role only.
CREATE FUNCTION public.ritnome_rep_staff_list(p_session uuid,p_price text)
RETURNS TABLE(user_id uuid,email text,role text,active boolean,created_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c record;
BEGIN
 SELECT * INTO c FROM public.ritnome_rep_session_check(p_session,p_price,false);
 IF NOT c.ok OR c.role NOT IN ('owner','manager') THEN RETURN; END IF;
 RETURN QUERY SELECT m.user_id,u.email::text,m.role,m.active,m.created_at FROM public.ritnome_institution_memberships m JOIN auth.users u ON u.id=m.user_id
  WHERE m.livemode=c.livemode AND m.facility_id=c.facility_id ORDER BY (m.role='owner') DESC,m.created_at;
END $$;
-- Attach an existing auth user (created by the server through Supabase Auth admin) to the facility with a role. Owner only; never re-roles the owner.
-- SECURITY DEFINER only to read auth.users; the facility still comes from the session.
CREATE FUNCTION public.ritnome_rep_staff_add(p_session uuid,p_price text,p_user uuid,p_role text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c record;
BEGIN
 SELECT * INTO c FROM public.ritnome_rep_session_check(p_session,p_price,true);
 IF NOT c.ok OR c.role<>'owner' THEN RETURN 'denied'; END IF;
 IF p_role NOT IN ('manager','facilitator') OR p_user IS NULL THEN RETURN 'invalid'; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_user) THEN RETURN 'no_user'; END IF;
 IF EXISTS(SELECT 1 FROM public.ritnome_institution_memberships m WHERE m.livemode=c.livemode AND m.user_id=p_user AND m.facility_id<>c.facility_id) THEN RETURN 'other_facility'; END IF;
 INSERT INTO public.ritnome_institution_memberships(livemode,user_id,facility_id,active,role) VALUES(c.livemode,p_user,c.facility_id,true,p_role)
  ON CONFLICT (livemode,user_id) DO UPDATE SET active=true,role=CASE WHEN public.ritnome_institution_memberships.role='owner' THEN 'owner' ELSE EXCLUDED.role END;
 RETURN 'ok';
END $$;
-- Deactivate / reactivate staff (owner only; the owner cannot deactivate themselves). Deactivation revokes access on the next request.
CREATE FUNCTION public.ritnome_rep_staff_set_active(p_session uuid,p_price text,p_user uuid,p_active boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c record; changed boolean;
BEGIN
 SELECT * INTO c FROM public.ritnome_rep_session_check(p_session,p_price,true);
 IF NOT c.ok OR c.role<>'owner' OR p_user=c.user_id THEN RETURN false; END IF;
 UPDATE public.ritnome_institution_memberships SET active=p_active WHERE livemode=c.livemode AND facility_id=c.facility_id AND user_id=p_user AND role<>'owner';
 changed:=FOUND;
 IF changed AND NOT p_active THEN UPDATE public.ritnome_facility_session SET ended_at=now() WHERE user_id=p_user AND ended_at IS NULL; END IF;
 RETURN changed;
END $$;
REVOKE ALL ON FUNCTION public.ritnome_rep_staff_list(uuid,text),public.ritnome_rep_staff_add(uuid,text,uuid,text),public.ritnome_rep_staff_set_active(uuid,text,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ritnome_rep_staff_list(uuid,text),public.ritnome_rep_staff_add(uuid,text,uuid,text),public.ritnome_rep_staff_set_active(uuid,text,uuid,boolean) TO service_role;
