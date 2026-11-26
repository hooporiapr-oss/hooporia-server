-- DEVELOPMENT ONLY. Requires actual Supabase auth.users/auth.sessions schema review.
-- No browser grants. Run only in isolated test environment.
begin;
create function coach_memory_private.active_session(actor uuid,session_key uuid,token_exp bigint)
returns boolean language sql volatile security invoker set search_path='' as $$
 select actor is not null and session_key is not null and token_exp>extract(epoch from clock_timestamp()) and exists(
 select 1 from auth.sessions s join auth.users u on u.id=s.user_id
 where s.id=session_key and s.user_id=actor and u.is_anonymous is false
 and (s.not_after is null or s.not_after>clock_timestamp())
 );
$$;
revoke all on function coach_memory_private.active_session(uuid,uuid,bigint) from public,anon,authenticated;
commit;
