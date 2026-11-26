-- Development only. No runtime grants. Preserve exact BPM confirmation used by each plan.
begin;
alter table coach_memory_private.event add constraint cm_event_membership_unique unique(id,membership_id);
alter table coach_memory_private.bpm_confirmation add constraint cm_confirmation_membership_unique unique(id,membership_id);
create table coach_memory_private.plan_bpm_binding (
 event_id uuid primary key,
 membership_id uuid not null,
 confirmation_id uuid not null,
 foreign key(event_id,membership_id) references coach_memory_private.event(id,membership_id),
 foreign key(confirmation_id,membership_id) references coach_memory_private.bpm_confirmation(id,membership_id)
);
alter table coach_memory_private.plan_bpm_binding enable row level security;
revoke all on coach_memory_private.plan_bpm_binding from public,anon,authenticated,coach_memory_backend,coach_memory_executor;
create function coach_memory_private.save_confirmed_bpm_plan(actor uuid,session_key uuid,token_exp bigint,target_membership uuid,target_confirmation uuid,event_date date,request_key uuid,p jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare result_id uuid; value_bpm integer; prior uuid;
begin
 if not coach_memory_private.active_session(actor,session_key,token_exp) then raise exception 'Session denied' using errcode='28000'; end if;
 perform coach_memory_private.lock_memory_access(actor,target_membership);
 if p is null or jsonb_typeof(p)<>'object' or p ? 'bpm' or target_confirmation is null then raise exception 'Invalid plan' using errcode='22023'; end if;
 select b.bpm into value_bpm from coach_memory_private.bpm_confirmation c join coach_memory_private.bpm_measurement b on b.id=c.measurement_id and b.athlete_id=c.athlete_id
 where c.id=target_confirmation and c.membership_id=target_membership and (c.confirmed_at at time zone 'America/Puerto_Rico')::date<=event_date and (b.measured_at at time zone 'America/Puerto_Rico')::date<=event_date;
 if not found then raise exception 'Invalid confirmation' using errcode='22023';end if;
 -- Existing append operation validates all plan fields and retry payload.
 result_id:=coach_memory_private.append_memory(actor,target_membership,'training_plan',event_date,request_key,p||jsonb_build_object('bpm',value_bpm));
 insert into coach_memory_private.plan_bpm_binding(event_id,membership_id,confirmation_id) values(result_id,target_membership,target_confirmation) on conflict(event_id) do nothing;
 select confirmation_id into prior from coach_memory_private.plan_bpm_binding where event_id=result_id;
 if prior is distinct from target_confirmation then raise exception 'Confirmation conflict' using errcode='22023'; end if;
 return result_id;
end $$;
revoke all on function coach_memory_private.save_confirmed_bpm_plan(uuid,uuid,bigint,uuid,uuid,date,uuid,jsonb) from public,anon,authenticated,coach_memory_backend,coach_memory_executor;
commit;
