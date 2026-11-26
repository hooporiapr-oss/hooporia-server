-- DEVELOPMENT CANDIDATE ONLY. Do not apply to hosted database without review.
-- No legacy tables altered and no historical data copied by this schema.
begin;
create table public.athlete_identity (
 id uuid primary key default gen_random_uuid(),
 created_at timestamptz not null default now()
);
create table public.athlete_identity_access (
 athlete_id uuid not null references public.athlete_identity(id) on delete restrict,
 user_id uuid not null references auth.users(id) on delete restrict,
 access_role text not null check(access_role in ('athlete','guardian')),
 granted_at timestamptz not null default now(),
 revoked_at timestamptz,
 primary key(athlete_id,user_id)
);
create table public.athlete_identity_membership (
 id uuid primary key default gen_random_uuid(),
 athlete_id uuid not null references public.athlete_identity(id) on delete restrict,
 program_key text not null check(length(trim(program_key))>0),
 team_key text,
 starts_at timestamptz not null default now(),
 ends_at timestamptz,
 check(ends_at is null or ends_at>=starts_at)
);
create table public.athlete_identity_record_link (
 source_table text not null check(source_table in ('hooporia_mobi_runs','vr_mobile_standings','vr_reaction_speed_standings')),
 source_id bigint not null,
 athlete_id uuid not null references public.athlete_identity(id) on delete restrict,
 verified_at timestamptz not null default now(),
 verified_by uuid not null references auth.users(id) on delete restrict,
 primary key(source_table,source_id)
);
-- No public writes; trusted enrollment/linking must be implemented and separately audited.
alter table public.athlete_identity enable row level security;
alter table public.athlete_identity_access enable row level security;
alter table public.athlete_identity_membership enable row level security;
alter table public.athlete_identity_record_link enable row level security;
revoke all on public.athlete_identity,public.athlete_identity_access,public.athlete_identity_membership,public.athlete_identity_record_link from public,anon,authenticated;
grant select on public.athlete_identity,public.athlete_identity_access to authenticated;
create policy athlete_access_self on public.athlete_identity_access for select to authenticated using (user_id=(select auth.uid()) and revoked_at is null);
create policy athlete_identity_self on public.athlete_identity for select to authenticated using (exists(select 1 from public.athlete_identity_access a where a.athlete_id=athlete_identity.id and a.user_id=(select auth.uid()) and a.revoked_at is null));
-- Membership and source links deliberately inaccessible to browser roles.
-- No coach bypass, name lookup, public linking endpoint or parent self-claim.
commit;
