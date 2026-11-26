-- DEVELOPMENT ONLY. Dedicated NOLOGIN role; never assign to browser roles.
-- Private trusted server entry points. The definer is deliberately a separate
-- NOLOGIN capability role, not postgres or a broadly privileged service role.
-- Requires all previous drafts. Do not apply to production.
begin;
create role coach_memory_executor nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
create role coach_memory_backend nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
grant usage on schema coach_memory_private to coach_memory_executor,coach_memory_backend;
grant usage on schema auth,public to coach_memory_executor;
grant select(id,is_anonymous) on auth.users to coach_memory_executor;
grant select(id,user_id,not_after) on auth.sessions to coach_memory_executor;
grant select,update on public.athlete_identity_membership to coach_memory_executor;
grant select,update on coach_memory_private.coach_grant to coach_memory_executor;
grant select,insert on coach_memory_private.event to coach_memory_executor;
-- SELECT FOR UPDATE requires an applicable UPDATE policy as well as SELECT.
-- Permit visibility for row locking only; WITH CHECK false prohibits actual updates.
create policy cm_exec_membership_lock on public.athlete_identity_membership for update to coach_memory_executor using(true) with check(false);
create policy cm_exec_grant_lock on coach_memory_private.coach_grant for update to coach_memory_executor using(true) with check(false);
create policy cm_exec_membership_read on public.athlete_identity_membership for select to coach_memory_executor using(true);
create policy cm_exec_grant_read on coach_memory_private.coach_grant for select to coach_memory_executor using(true);
create policy cm_exec_event_read on coach_memory_private.event for select to coach_memory_executor using(true);
create policy cm_exec_event_insert on coach_memory_private.event for insert to coach_memory_executor with check(true);
grant execute on function coach_memory_private.active_session(uuid,uuid,bigint),coach_memory_private.lock_memory_access(uuid,uuid),coach_memory_private.valid_memory_payload(text,jsonb),coach_memory_private.append_memory(uuid,uuid,text,date,uuid,jsonb,uuid),coach_memory_private.read_memory(uuid,uuid,integer,timestamptz,uuid) to coach_memory_executor;
-- The trusted backend must validate the exact bearer token with Supabase Auth.
-- Caller-supplied actor/session arguments are NOT a browser authentication API.
-- These wrappers are private, executable only by the future server login role
-- via membership in coach_memory_backend. No login credentials created here.
create function coach_memory_private.server_save_plan(actor uuid,session_key uuid,token_exp bigint,target_membership uuid,event_date date,request_key uuid,p jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
begin
 if not coach_memory_private.active_session(actor,session_key,token_exp) then raise exception 'Session denied' using errcode='28000'; end if;
 -- Until verified source binding is implemented, pilot accepts memory-only plans.
 if p->'bpm' is distinct from 'null'::jsonb then raise exception 'Verified BPM binding required' using errcode='22023'; end if;
 return coach_memory_private.append_memory(actor,target_membership,'training_plan',event_date,request_key,p);
end $$;
create function coach_memory_private.server_read_memory(actor uuid,session_key uuid,token_exp bigint,target_membership uuid,page_size integer,before_time timestamptz,before_id uuid)
returns table(id uuid,kind text,effective_on date,recorded_at timestamptz,payload jsonb,supersedes_id uuid)
language plpgsql security definer set search_path='' as $$
begin
 if not coach_memory_private.active_session(actor,session_key,token_exp) then raise exception 'Session denied' using errcode='28000'; end if;
 return query select * from coach_memory_private.read_memory(actor,target_membership,page_size,before_time,before_id);
end $$;
revoke all on function coach_memory_private.server_save_plan(uuid,uuid,bigint,uuid,date,uuid,jsonb),coach_memory_private.server_read_memory(uuid,uuid,bigint,uuid,integer,timestamptz,uuid) from public,anon,authenticated;
-- The managed local Supabase installer is not a superuser. Allow only
-- the current installer to assume the newly created executor during ownership transfer.
-- This role is new in this transaction; the grant is removed before commit.
grant coach_memory_executor to current_user;
grant create on schema coach_memory_private to coach_memory_executor;
alter function coach_memory_private.server_save_plan(uuid,uuid,bigint,uuid,date,uuid,jsonb) owner to coach_memory_executor;
alter function coach_memory_private.server_read_memory(uuid,uuid,bigint,uuid,integer,timestamptz,uuid) owner to coach_memory_executor;
revoke create on schema coach_memory_private from coach_memory_executor;
revoke coach_memory_executor from current_user;
grant execute on function coach_memory_private.server_save_plan(uuid,uuid,bigint,uuid,date,uuid,jsonb),coach_memory_private.server_read_memory(uuid,uuid,bigint,uuid,integer,timestamptz,uuid) to coach_memory_backend;
commit;
