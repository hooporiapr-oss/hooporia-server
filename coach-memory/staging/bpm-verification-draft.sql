-- Development draft only. No legacy standings changes.
begin;
create table coach_memory_private.bpm_measurement (
 id uuid primary key default gen_random_uuid(),
 athlete_id uuid not null references public.athlete_identity(id),
 recorded_by uuid not null references auth.users(id),
 request_id uuid not null unique,
 bpm integer not null check (bpm between 1 and 1000),
 measured_at timestamptz not null,
 received_at timestamptz not null default clock_timestamp(),
 source text not null check(source = 'reaction_speed'),
 provenance text not null check(provenance in ('coach_observed','authenticated_client')),
 check(measured_at <= received_at),
 unique(id,athlete_id)
);
alter table public.athlete_identity_membership add constraint cm_membership_athlete_unique unique(id,athlete_id);
create table coach_memory_private.bpm_confirmation (
 id uuid primary key default gen_random_uuid(),
 measurement_id uuid not null,
 athlete_id uuid not null,
 membership_id uuid not null references public.athlete_identity_membership(id),
 confirmed_by uuid not null references auth.users(id),
 confirmed_at timestamptz not null default now(),
 request_id uuid not null unique,
 foreign key(measurement_id,athlete_id) references coach_memory_private.bpm_measurement(id,athlete_id),
 foreign key(membership_id,athlete_id) references public.athlete_identity_membership(id,athlete_id),
 unique(measurement_id,membership_id)
);
alter table coach_memory_private.bpm_measurement enable row level security;
alter table coach_memory_private.bpm_confirmation enable row level security;
revoke all on coach_memory_private.bpm_measurement,coach_memory_private.bpm_confirmation from public,anon,authenticated,coach_memory_backend,coach_memory_executor;
-- No runtime grants or write endpoints until source submission, scope checks,
-- same-athlete membership enforcement and confirmation transactions are tested.
-- Neither authenticated client provenance nor coach observation proves timing accuracy.
commit;
