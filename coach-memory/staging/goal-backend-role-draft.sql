-- DEVELOPMENT ONLY: apply after existing Coach Memory role drafts in disposable local CI.
begin;
create function coach_memory_private.server_save_goal(actor uuid,session_key uuid,token_exp bigint,target_membership uuid,event_date date,request_key uuid,p jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
begin
 if not coach_memory_private.active_session(actor,session_key,token_exp) then raise exception 'Session denied' using errcode='28000'; end if;
 if not coach_memory_private.valid_memory_payload('goal',p) then raise exception 'Invalid goal' using errcode='22023'; end if;
 if p->>'metric'='active_days' and (p->>'target')::numeric>7 then raise exception 'Invalid weekly target' using errcode='22023'; end if;
 return coach_memory_private.append_memory(actor,target_membership,'goal',event_date,request_key,p);
end $$;
revoke all on function coach_memory_private.server_save_goal(uuid,uuid,bigint,uuid,date,uuid,jsonb) from public,anon,authenticated;
grant coach_memory_executor to postgres;
grant create on schema coach_memory_private to coach_memory_executor;
alter function coach_memory_private.server_save_goal(uuid,uuid,bigint,uuid,date,uuid,jsonb) owner to coach_memory_executor;
set local role coach_memory_executor;
grant execute on function coach_memory_private.server_save_goal(uuid,uuid,bigint,uuid,date,uuid,jsonb) to coach_memory_backend;
reset role;
revoke create on schema coach_memory_private from coach_memory_executor;
revoke coach_memory_executor from postgres;
commit;
