-- DEVELOPMENT ONLY. Private Coach Memory transaction prototype.
-- Apply after identity, memory and access-control drafts on an isolated database.
begin;
-- Strict allowlist: no unrestricted notes, credentials, names or arbitrary nested objects.
create function coach_memory_private.valid_memory_payload(event_kind text, p jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare k text; n numeric; v jsonb; d text;
begin
 if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>32768 then return false; end if;
 case event_kind
 when 'bpm_confirmation' then
  if not (p ?& array['bpm','source']) or (p-array['bpm','source'])<>'{}'::jsonb then return false; end if;
  return coalesce(jsonb_typeof(p->'bpm')='number' and (p->>'bpm') ~ '^[0-9]{1,4}$' and (p->>'bpm')::numeric between 1 and 1000 and p->>'source'='reaction_speed',false);
 when 'training_plan' then
  if not (p ?& array['stage','bpm','days','stations']) or (p-array['stage','bpm','days','stations'])<>'{}'::jsonb then return false; end if;
  if coalesce(p->>'stage','') not in ('5-6','7-8','9-10','11-12','13-14','15-17','other') then return false; end if;
  if jsonb_typeof(p->'days')<>'number' or coalesce(p->>'days','') not in ('2','3','4','5') then return false; end if;
  if p->'bpm'<>'null'::jsonb and (jsonb_typeof(p->'bpm')<>'number' or coalesce(p->>'bpm','') !~ '^[0-9]{1,4}$' or (p->>'bpm')::numeric not between 1 and 1000) then return false; end if;
  if jsonb_typeof(p->'stations')<>'array' then return false; end if;
  if jsonb_array_length(p->'stations') not between 1 and 7 then return false; end if;
  for v in select value from jsonb_array_elements(p->'stations') loop
   if v not in ('"recall"'::jsonb,'"recognition"'::jsonb,'"replay"'::jsonb,'"fortress"'::jsonb,'"zn"'::jsonb,'"zr"'::jsonb,'"enc"'::jsonb) then return false; end if;
   if p->'bpm'='null'::jsonb and v in ('"zn"'::jsonb,'"zr"'::jsonb,'"enc"'::jsonb) then return false; end if;
  end loop;
  return true;
 when 'goal' then
  if not (p ?& array['metric','baseline','target']) or (p-array['metric','baseline','target'])<>'{}'::jsonb then return false; end if;
  if coalesce(p->>'metric','') not in ('active_days','reaction_bpm','recall','recognition','replay','fortress') then return false; end if;
  for k in select unnest(array['baseline','target']) loop
   if jsonb_typeof(p->k)<>'number' or coalesce(p->>k,'') !~ '^[0-9]{1,5}$' then return false; end if;
  end loop;
  return (p->>'target')::numeric>(p->>'baseline')::numeric;
 when 'cycle_evaluation' then
  if not (p ?& array['start','days','prior_attempts','cycle_attempts','complete']) or (p-array['start','days','prior_attempts','cycle_attempts','complete'])<>'{}'::jsonb then return false; end if;
  if jsonb_typeof(p->'start')<>'string' or coalesce(p->>'start','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
  d:=p->>'start'; if to_char(d::date,'YYYY-MM-DD')<>d then return false; end if;
  if jsonb_typeof(p->'days')<>'number' or coalesce(p->>'days','') not in ('7','14','30') or jsonb_typeof(p->'complete')<>'boolean' then return false; end if;
  for k in select unnest(array['prior_attempts','cycle_attempts']) loop
   if jsonb_typeof(p->k)<>'number' or coalesce(p->>k,'') !~ '^[0-9]{1,7}$' then return false; end if;
  end loop;
  return true;
 when 'coaching_decision' then
  return coalesce(p ? 'reason' and (p-'reason')='{}'::jsonb and p->>'reason' in ('maintain','reinforce','measure_bpm','review_progress','collect_data'),false);
 when 'correction' then
  return coalesce(p ? 'reason' and (p-'reason')='{}'::jsonb and p->>'reason' in ('entry_error','invalid_measurement','incorrect_selection'),false);
 else return false;
 end case;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then return false;
end;
$$;

-- Both revocation and membership changes must lock membership then coach grant.
-- Verified actor must be derived by future trusted backend, never request body.
create function coach_memory_private.lock_memory_access(actor uuid,target_membership uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare g uuid;
begin
 if actor is null or target_membership is null then raise exception 'Access denied' using errcode='42501'; end if;
 perform 1 from public.athlete_identity_membership m where m.id=target_membership and m.starts_at<=clock_timestamp() and (m.ends_at is null or m.ends_at>clock_timestamp()) for update;
 if not found then raise exception 'Access denied' using errcode='42501'; end if;
 select x.id into g from coach_memory_private.coach_grant x where x.membership_id=target_membership and x.user_id=actor and x.revoked_at is null and x.granted_at<=clock_timestamp() for update;
 if not found then raise exception 'Access denied' using errcode='42501'; end if;
 return g;
end;
$$;

create function coach_memory_private.append_memory(actor uuid,target_membership uuid,event_kind text,event_date date,request_key uuid,p jsonb,correction_target uuid default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare g uuid; existing coach_memory_private.event%rowtype; result_id uuid;
begin
 g:=coach_memory_private.lock_memory_access(actor,target_membership);
 if request_key is null or event_date is null or event_date>(clock_timestamp() at time zone 'America/Puerto_Rico')::date or not coach_memory_private.valid_memory_payload(event_kind,p) then raise exception 'Invalid event' using errcode='22023'; end if;
 if (event_kind='correction') is distinct from (correction_target is not null) then raise exception 'Invalid correction' using errcode='22023'; end if;
 if correction_target is not null and not exists(select 1 from coach_memory_private.event e where e.id=correction_target and e.membership_id=target_membership and e.kind<>'correction') then raise exception 'Invalid correction' using errcode='22023'; end if;
 if event_kind='cycle_evaluation' and (p->>'start')::date+(p->>'days')::int-1 >= (clock_timestamp() at time zone 'America/Puerto_Rico')::date then raise exception 'Cycle not complete' using errcode='22023'; end if;
 insert into coach_memory_private.event(membership_id,author_id,grant_id,kind,effective_on,request_id,payload,supersedes_id)
 values(target_membership,actor,g,event_kind,event_date,request_key,p,correction_target)
 on conflict(author_id,request_id) do nothing returning id into result_id;
 if result_id is not null then return result_id; end if;
 select * into existing from coach_memory_private.event e where e.author_id=actor and e.request_id=request_key;
 if not found or existing.membership_id is distinct from target_membership or existing.kind is distinct from event_kind or existing.effective_on is distinct from event_date or existing.payload is distinct from p or existing.supersedes_id is distinct from correction_target then raise exception 'Request conflict' using errcode='22023'; end if;
 return existing.id;
end;
$$;

create function coach_memory_private.read_memory(actor uuid,target_membership uuid,page_size integer default 25,before_time timestamptz default null,before_id uuid default null)
returns table(id uuid,kind text,effective_on date,recorded_at timestamptz,payload jsonb,supersedes_id uuid)
language plpgsql security invoker set search_path='' as $$
begin
 perform coach_memory_private.lock_memory_access(actor,target_membership);
 if page_size is null or page_size not between 1 and 100 or (before_time is null)<>(before_id is null) then raise exception 'Invalid page' using errcode='22023'; end if;
 return query select e.id,e.kind,e.effective_on,e.recorded_at,e.payload,e.supersedes_id from coach_memory_private.event e where e.membership_id=target_membership
 and (before_time is null or (e.recorded_at,e.id)<(before_time,before_id))
 order by e.recorded_at desc,e.id desc limit page_size;
end;
$$;
revoke all on function coach_memory_private.valid_memory_payload(text,jsonb),coach_memory_private.lock_memory_access(uuid,uuid),coach_memory_private.append_memory(uuid,uuid,text,date,uuid,jsonb,uuid),coach_memory_private.read_memory(uuid,uuid,integer,timestamptz,uuid) from public,anon,authenticated;
-- No endpoint or execution grants. No update/delete operation.
commit;
