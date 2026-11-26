-- Development only. Exact bound prescription lookup; no public execution.
begin;
create function coach_memory_private.server_get_bpm_plan(actor uuid,session_key uuid,token_exp bigint,target_membership uuid,target_plan uuid,target_station text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not coach_memory_private.active_session(actor,session_key,token_exp) then raise exception 'Session denied' using errcode='28000';end if;
 perform coach_memory_private.lock_memory_access(actor,target_membership);
 if target_plan is null or target_station is null or target_station not in ('recall','recognition','replay','fortress','zn','zr','enc','ritnome') then raise exception 'Invalid selection' using errcode='22023';end if;
 select jsonb_build_object('plan_id',e.id,'membership_id',e.membership_id,'confirmation_id',c.id,'bpm',b.bpm,'station',target_station,'effective_on',e.effective_on,'stage',e.payload->>'stage')
 into result
 from coach_memory_private.event e
 join coach_memory_private.plan_bpm_binding p on p.event_id=e.id and p.membership_id=e.membership_id
 join coach_memory_private.bpm_confirmation c on c.id=p.confirmation_id and c.membership_id=p.membership_id
 join coach_memory_private.bpm_measurement b on b.id=c.measurement_id and b.athlete_id=c.athlete_id
 where e.id=target_plan and e.membership_id=target_membership and e.kind='training_plan'
 and e.effective_on<=(clock_timestamp() at time zone 'America/Puerto_Rico')::date
 and (e.payload->'stations') ? target_station
 and (target_station<>'ritnome' or (e.payload->>'stage' not in ('5-6','7-8') and b.bpm between 40 and 200))
 and e.payload->'bpm'=to_jsonb(b.bpm)
 and not exists(select 1 from coach_memory_private.event correction where correction.membership_id=e.membership_id and correction.supersedes_id=e.id);
 if result is null then raise exception 'Prescription unavailable' using errcode='22023';end if;
 return result;
end $$;
revoke all on function coach_memory_private.server_get_bpm_plan(uuid,uuid,bigint,uuid,uuid,text) from public,anon,authenticated;
-- Match the temporary installer membership used by the preceding backend draft.
grant coach_memory_executor to postgres;
grant create on schema coach_memory_private to coach_memory_executor;
alter function coach_memory_private.server_get_bpm_plan(uuid,uuid,bigint,uuid,uuid,text) owner to coach_memory_executor;
set local role coach_memory_executor;
grant execute on function coach_memory_private.server_get_bpm_plan(uuid,uuid,bigint,uuid,uuid,text) to coach_memory_backend;
reset role;
revoke create on schema coach_memory_private from coach_memory_executor;
revoke coach_memory_executor from postgres;
commit;
