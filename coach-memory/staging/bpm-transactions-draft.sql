-- Isolated development only. Owner-executed tests; no runtime grants.
begin;
create function coach_memory_private.submit_observed_bpm(actor uuid,session_key uuid,token_exp bigint,target_membership uuid,request_key uuid,value_bpm integer,measurement_time timestamptz)
returns uuid language plpgsql security invoker set search_path='' as $$
declare athlete uuid; result_id uuid; old coach_memory_private.bpm_measurement%rowtype;
begin
 if not coach_memory_private.active_session(actor,session_key,token_exp) then raise exception 'Session denied' using errcode='28000'; end if;
 perform coach_memory_private.lock_memory_access(actor,target_membership);
 select m.athlete_id into strict athlete from public.athlete_identity_membership m where m.id=target_membership and measurement_time>=m.starts_at;
 if request_key is null or value_bpm is null or value_bpm not between 1 and 1000 or measurement_time is null or measurement_time>clock_timestamp() then raise exception 'Invalid measurement' using errcode='22023'; end if;
 insert into coach_memory_private.bpm_measurement(athlete_id,recorded_by,request_id,bpm,measured_at,source,provenance) values(athlete,actor,request_key,value_bpm,measurement_time,'reaction_speed','coach_observed') on conflict(request_id) do nothing returning id into result_id;
 if result_id is not null then return result_id; end if;
 select * into old from coach_memory_private.bpm_measurement where request_id=request_key;
 if old.athlete_id is distinct from athlete or old.recorded_by is distinct from actor or old.bpm is distinct from value_bpm or old.measured_at is distinct from measurement_time then raise exception 'Request conflict' using errcode='22023'; end if;
 return old.id;
exception when no_data_found then raise exception 'Invalid measurement scope' using errcode='22023';
end $$;
create function coach_memory_private.confirm_observed_bpm(actor uuid,session_key uuid,token_exp bigint,target_membership uuid,target_measurement uuid,request_key uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare athlete uuid; result_id uuid; old coach_memory_private.bpm_confirmation%rowtype;
begin
 if not coach_memory_private.active_session(actor,session_key,token_exp) then raise exception 'Session denied' using errcode='28000'; end if;
 perform coach_memory_private.lock_memory_access(actor,target_membership);
 select m.athlete_id into strict athlete from public.athlete_identity_membership m where m.id=target_membership;
 if request_key is null or not exists(select 1 from coach_memory_private.bpm_measurement b join public.athlete_identity_membership m on m.id=target_membership where b.id=target_measurement and b.athlete_id=athlete and b.provenance='coach_observed' and b.measured_at>=m.starts_at) then raise exception 'Invalid measurement' using errcode='22023'; end if;
 insert into coach_memory_private.bpm_confirmation(measurement_id,athlete_id,membership_id,confirmed_by,request_id) values(target_measurement,athlete,target_membership,actor,request_key) on conflict do nothing returning id into result_id;
 if result_id is not null then return result_id; end if;
 select * into old from coach_memory_private.bpm_confirmation where request_id=request_key;
 if not found or old.measurement_id is distinct from target_measurement or old.membership_id is distinct from target_membership or old.confirmed_by is distinct from actor then raise exception 'Request conflict' using errcode='22023'; end if;
 return old.id;
end $$;
revoke all on function coach_memory_private.submit_observed_bpm(uuid,uuid,bigint,uuid,uuid,integer,timestamptz),coach_memory_private.confirm_observed_bpm(uuid,uuid,bigint,uuid,uuid,uuid) from public,anon,authenticated,coach_memory_backend,coach_memory_executor;
commit;
