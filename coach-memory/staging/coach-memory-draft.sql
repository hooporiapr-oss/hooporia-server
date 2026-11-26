-- DEVELOPMENT DRAFT ONLY. Depends on athlete-identity-draft.sql.
-- Not a production migration. No browser access until verified enrollment and authorization are implemented.
begin;
create schema if not exists coach_memory_private;
revoke all on schema coach_memory_private from public,anon,authenticated;
create table coach_memory_private.coach_grant (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete restrict,
 membership_id uuid not null references public.athlete_identity_membership(id) on delete restrict,
 granted_by uuid not null references auth.users(id) on delete restrict,
 granted_at timestamptz not null default now(),
 revoked_at timestamptz,
 check(revoked_at is null or revoked_at>=granted_at),
 unique(id,membership_id,user_id)
);
create unique index coach_memory_active_grant on coach_memory_private.coach_grant(user_id,membership_id) where revoked_at is null;
create table coach_memory_private.event (
 id uuid primary key default gen_random_uuid(),
 membership_id uuid not null references public.athlete_identity_membership(id) on delete restrict,
 author_id uuid not null references auth.users(id) on delete restrict,
 grant_id uuid not null,
 kind text not null check(kind in ('bpm_confirmation','training_plan','goal','cycle_evaluation','coaching_decision','correction')),
 schema_version smallint not null default 1 check(schema_version=1),
 recorded_at timestamptz not null default now(),
 effective_on date not null,
 request_id uuid not null,
 payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=32768),
 supersedes_id uuid,
 unique(id,membership_id),
 unique(author_id,request_id),
 foreign key(grant_id,membership_id,author_id) references coach_memory_private.coach_grant(id,membership_id,user_id) on delete restrict,
 foreign key(supersedes_id,membership_id) references coach_memory_private.event(id,membership_id) on delete restrict,
 check((kind='correction')=(supersedes_id is not null))
);
create index coach_memory_event_membership_time on coach_memory_private.event(membership_id,recorded_at desc,id);
alter table coach_memory_private.coach_grant enable row level security;
alter table coach_memory_private.event enable row level security;
revoke all on all tables in schema coach_memory_private from public,anon,authenticated;
-- Default-deny: no browser policies or RPC endpoints. No direct client grants.
-- Future trusted backend must verify authenticated user, active membership/grant, scope,
-- payload schema, source ownership, idempotency, and revocation on EVERY request.
-- Append-only via trusted backend; no update/delete API. Corrections are new events.
-- No service-role credential in browser. Do not store coach codes, device keys, names or health notes.
commit;
