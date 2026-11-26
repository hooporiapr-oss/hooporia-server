-- Development only; run after BPM plan binding draft. Isolated PostgreSQL tests.
begin;
grant select,insert on coach_memory_private.bpm_measurement,coach_memory_private.bpm_confirmation,coach_memory_private.plan_bpm_binding to coach_memory_executor;
create policy cm_measurement_read on coach_memory_private.bpm_measurement for select to coach_memory_executor using(true);
create policy cm_measurement_insert on coach_memory_private.bpm_measurement for insert to coach_memory_executor with check(true);
create policy cm_confirmation_read on coach_memory_private.bpm_confirmation for select to coach_memory_executor using(true);
create policy cm_confirmation_insert on coach_memory_private.bpm_confirmation for insert to coach_memory_executor with check(true);
create policy cm_binding_read on coach_memory_private.plan_bpm_binding for select to coach_memory_executor using(true);
create policy cm_binding_insert on coach_memory_private.plan_bpm_binding for insert to coach_memory_executor with check(true);
grant execute on function coach_memory_private.submit_observed_bpm(uuid,uuid,bigint,uuid,uuid,integer,timestamptz),coach_memory_private.confirm_observed_bpm(uuid,uuid,bigint,uuid,uuid,uuid),coach_memory_private.save_confirmed_bpm_plan(uuid,uuid,bigint,uuid,uuid,date,uuid,jsonb) to coach_memory_executor;
create function coach_memory_private.server_submit_bpm(actor uuid,session_key uuid,token_exp bigint,membership uuid,request_key uuid,bpm integer,measured_at timestamptz)
returns uuid language sql security definer set search_path='' as $$
 select coach_memory_private.submit_observed_bpm(actor,session_key,token_exp,membership,request_key,bpm,measured_at);
$$;
create function coach_memory_private.server_confirm_bpm(actor uuid,session_key uuid,token_exp bigint,membership uuid,measurement uuid,request_key uuid)
returns uuid language sql security definer set search_path='' as $$
 select coach_memory_private.confirm_observed_bpm(actor,session_key,token_exp,membership,measurement,request_key);
$$;
create function coach_memory_private.server_save_bpm_plan(actor uuid,session_key uuid,token_exp bigint,membership uuid,confirmation uuid,event_date date,request_key uuid,p jsonb)
returns uuid language sql security definer set search_path='' as $$
 select coach_memory_private.save_confirmed_bpm_plan(actor,session_key,token_exp,membership,confirmation,event_date,request_key,p);
$$;
revoke all on function coach_memory_private.server_submit_bpm(uuid,uuid,bigint,uuid,uuid,integer,timestamptz),coach_memory_private.server_confirm_bpm(uuid,uuid,bigint,uuid,uuid,uuid),coach_memory_private.server_save_bpm_plan(uuid,uuid,bigint,uuid,uuid,date,uuid,jsonb) from public,anon,authenticated;
grant coach_memory_executor to postgres;
grant create on schema coach_memory_private to coach_memory_executor;
alter function coach_memory_private.server_submit_bpm(uuid,uuid,bigint,uuid,uuid,integer,timestamptz) owner to coach_memory_executor;
alter function coach_memory_private.server_confirm_bpm(uuid,uuid,bigint,uuid,uuid,uuid) owner to coach_memory_executor;
alter function coach_memory_private.server_save_bpm_plan(uuid,uuid,bigint,uuid,uuid,date,uuid,jsonb) owner to coach_memory_executor;
set local role coach_memory_executor;
grant execute on function coach_memory_private.server_submit_bpm(uuid,uuid,bigint,uuid,uuid,integer,timestamptz),coach_memory_private.server_confirm_bpm(uuid,uuid,bigint,uuid,uuid,uuid),coach_memory_private.server_save_bpm_plan(uuid,uuid,bigint,uuid,uuid,date,uuid,jsonb) to coach_memory_backend;
reset role;
revoke create on schema coach_memory_private from coach_memory_executor;
revoke coach_memory_executor from postgres;
commit;
