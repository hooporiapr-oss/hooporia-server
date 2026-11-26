-- DEVELOPMENT ONLY. Apply solely to an isolated test database after identity and memory drafts.
begin;
create table coach_memory_private.admin_grant (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete restrict,
 program_key text not null check(length(trim(program_key))>0),
 granted_at timestamptz not null default now(),
 revoked_at timestamptz,
 check(revoked_at is null or revoked_at>=granted_at)
);
create unique index admin_grant_active on coach_memory_private.admin_grant(user_id,program_key) where revoked_at is null;
alter table coach_memory_private.admin_grant enable row level security;
revoke all on coach_memory_private.admin_grant from public,anon,authenticated;
-- Internal invoker helpers: deliberately not executable by browser roles.
-- The future trusted backend must supply the actor from a verified, non-anonymous session,
-- never from the request body, and check permissions in the same transaction as the action.
create function coach_memory_private.can_manage_program(actor uuid, target_program text)
returns boolean language sql stable security invoker set search_path='' as $$
 select actor is not null and exists (
 select 1 from coach_memory_private.admin_grant g where g.user_id=actor
 and g.program_key=target_program and g.revoked_at is null and g.granted_at<=now());
$$;
create function coach_memory_private.can_access_memory(actor uuid, target_membership uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select actor is not null and exists (
 select 1 from coach_memory_private.coach_grant g
 join public.athlete_identity_membership m on m.id=g.membership_id
 where g.user_id=actor and m.id=target_membership and g.revoked_at is null
 and g.granted_at<=now() and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now()));
$$;
create function coach_memory_private.can_access_athlete(actor uuid, target_athlete uuid, requested_role text)
returns boolean language sql stable security invoker set search_path='' as $$
 select actor is not null and requested_role in ('athlete','guardian') and exists (
 select 1 from public.athlete_identity_access a where a.user_id=actor
 and a.athlete_id=target_athlete and a.access_role=requested_role
 and a.granted_at<=now() and a.revoked_at is null);
$$;
revoke all on function coach_memory_private.can_manage_program(uuid,text),coach_memory_private.can_access_memory(uuid,uuid),coach_memory_private.can_access_athlete(uuid,uuid,text) from public,anon,authenticated;
-- No grants to client roles; no endpoints; no automatic admin access to memory.
-- Bootstrap administrator only through trusted operator procedure, never self-registration.
commit;
