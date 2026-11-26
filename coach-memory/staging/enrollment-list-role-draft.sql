-- DEVELOPMENT ONLY. No legacy name matching, no enrollment self-approval.
begin;
grant select on coach_memory_private.enrollment_receipt to coach_memory_executor;
create policy cm_exec_receipt_read on coach_memory_private.enrollment_receipt for select to coach_memory_executor using(true);
create function coach_memory_private.server_list_enrollments(actor uuid,session_key uuid,token_exp bigint,after_id uuid,page_size integer)
returns table(membership_id uuid,program_key text)
language plpgsql security definer set search_path='' as $$
begin
 if not coach_memory_private.active_session(actor,session_key,token_exp) then raise exception 'Session denied' using errcode='28000'; end if;
 if page_size is null or page_size not between 1 and 100 then raise exception 'Invalid page' using errcode='22023'; end if;
 return query select m.id,m.program_key from public.athlete_identity_membership m
 join coach_memory_private.enrollment_receipt r on r.membership_id=m.id and r.athlete_id=m.athlete_id
 join coach_memory_private.coach_grant g on g.membership_id=m.id
 where g.user_id=actor and g.revoked_at is null and g.granted_at<=clock_timestamp()
 and m.starts_at<=clock_timestamp() and (m.ends_at is null or m.ends_at>clock_timestamp())
 and (after_id is null or m.id>after_id)
 order by m.id limit page_size;
end $$;
revoke all on function coach_memory_private.server_list_enrollments(uuid,uuid,bigint,uuid,integer) from public,anon,authenticated;
grant coach_memory_executor to postgres;
grant create on schema coach_memory_private to coach_memory_executor;
alter function coach_memory_private.server_list_enrollments(uuid,uuid,bigint,uuid,integer) owner to coach_memory_executor;
set local role coach_memory_executor;
grant execute on function coach_memory_private.server_list_enrollments(uuid,uuid,bigint,uuid,integer) to coach_memory_backend;
reset role;
revoke create on schema coach_memory_private from coach_memory_executor;
revoke coach_memory_executor from postgres;
commit;
