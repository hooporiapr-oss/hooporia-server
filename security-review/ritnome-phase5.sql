-- Ritnome institutional — Phase 5: participant handles at the station.
-- An activity token may list the facility's active handles (ids only; the label is derived in the app). Facility comes from the token's session.
CREATE FUNCTION public.ritnome_rep_token_handles(p_token_hash text,p_origin text,p_price text)
RETURNS TABLE(handle_id uuid,created_at timestamptz) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE t public.ritnome_activity_token%ROWTYPE; c record;
BEGIN
 SELECT * INTO t FROM public.ritnome_activity_token x WHERE x.token_hash=p_token_hash;
 IF NOT FOUND OR t.revoked_at IS NOT NULL OR t.origin<>p_origin THEN RETURN; END IF;
 SELECT * INTO c FROM public.ritnome_rep_session_check(t.session_id,p_price,false);
 IF NOT c.ok OR NOT c.handles_enabled THEN RETURN; END IF;
 RETURN QUERY SELECT h.handle_id,h.created_at FROM public.ritnome_participant_handle h WHERE h.livemode=c.livemode AND h.facility_id=c.facility_id AND h.retired_at IS NULL ORDER BY h.created_at;
END $$;
REVOKE ALL ON FUNCTION public.ritnome_rep_token_handles(text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ritnome_rep_token_handles(text,text,text) TO service_role;
