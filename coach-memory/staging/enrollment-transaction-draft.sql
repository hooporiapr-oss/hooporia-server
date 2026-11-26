-- DEVELOPMENT ONLY: private transaction prototype, not a deployed endpoint.
-- Apply after identity, memory and access-control drafts in isolated testing.
begin;
create table coach_memory_private.enrollment_approval (
 id uuid primary key default gen_random_uuid(),
 program_key text not null check(length(trim(program_key)) between 1 and 200),
 approved_by uuid not null references auth.users(id) on delete restrict,
 athlete_user_id uuid references auth.users(id) on delete restrict,
 guardian_user_id uuid references auth.users(id) on delete restrict,
 approved_at timestamptz not null default now(),
 expires_at timestamptz not null,
 revoked_at timestamptz,
 check(expires_at>approved_at),
 check(athlete_user_id is null or guardian_user_id is null or athlete_user_id<>guardian_user_id)
);
create table coach_memory_private.enrollment_receipt (
 approval_id uuid primary key references coach_memory_private.enrollment_approval(id) on delete restrict,
 athlete_id uuid not null unique references public.athlete_identity(id) on delete restrict,
 membership_id uuid not null unique references public.athlete_identity_membership(id) on delete restrict,
 enrolled_by uuid not null references auth.users(id) on delete restrict,
 enrolled_at timestamptz not null default now()
);
alter table coach_memory_private.enrollment_approval enable row level security;
alter table coach_memory_private.enrollment_receipt enable row level security;
revoke all on coach_memory_private.enrollment_approval,coach_memory_private.enrollment_receipt from public,anon,authenticated;
-- Approval creation is intentionally not exposed. A trusted operator must verify
-- identity, duplicate enrollment risk, authority and account ownership independently.
-- No browser may call this function. Actor must originate from verified session.
create function coach_memory_private.consume_enrollment(actor uuid, approval uuid)
returns table(athlete_id uuid,membership_id uuid)
language plpgsql security invoker set search_path='' as $$
declare
 a coach_memory_private.enrollment_approval%rowtype;
 g uuid;
 new_athlete uuid;
 new_membership uuid;
begin
 if actor is null or approval is null then raise exception 'Enrollment denied' using errcode='42501'; end if;
 select * into a from coach_memory_private.enrollment_approval x where x.id=approval for update;
 if not found or a.revoked_at is not null or a.approved_at>now() or a.expires_at<=now() then
   raise exception 'Enrollment denied' using errcode='42501';
 end if;
 select x.id into g from coach_memory_private.admin_grant x
 where x.user_id=actor and x.program_key=a.program_key and x.revoked_at is null and x.granted_at<=now() for update;
 if not found then raise exception 'Enrollment denied' using errcode='42501'; end if;
 if not coach_memory_private.can_manage_program(a.approved_by,a.program_key) then
   raise exception 'Enrollment denied' using errcode='42501';
 end if;
 -- One receipt per approval. Retries do not create duplicate identities.
 select x.athlete_id,x.membership_id into new_athlete,new_membership
 from coach_memory_private.enrollment_receipt x where x.approval_id=approval;
 if found then return query select new_athlete,new_membership; return; end if;
 insert into public.athlete_identity default values returning id into new_athlete;
 insert into public.athlete_identity_membership(athlete_id,program_key)
 values(new_athlete,a.program_key) returning id into new_membership;
 if a.athlete_user_id is not null then
 insert into public.athlete_identity_access(athlete_id,user_id,access_role) values(new_athlete,a.athlete_user_id,'athlete');
 end if;
 if a.guardian_user_id is not null then
 insert into public.athlete_identity_access(athlete_id,user_id,access_role) values(new_athlete,a.guardian_user_id,'guardian');
 end if;
 insert into coach_memory_private.enrollment_receipt(approval_id,athlete_id,membership_id,enrolled_by)
 values(approval,new_athlete,new_membership,actor);
 return query select new_athlete,new_membership;
end;
$$;
revoke all on function coach_memory_private.consume_enrollment(uuid,uuid) from public,anon,authenticated;
-- No grants to browser or runtime roles in this draft. No linking of legacy rows.
commit;
