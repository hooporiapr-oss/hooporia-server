-- Coach Memory — program administrator operations (trusted operator = License Admin).
-- Apply after the identity, memory, access-control, enrollment, engine, session and role drafts.
-- Callable only by an authenticated License Admin user (public.is_admin()) who holds an active
-- administrator grant for the program. Nothing here is reachable by coaches, athletes or anon.
-- Memberships get a coach-facing roster label; it is not an identity and is never matched by name.
begin;
-- License Admin provides public.is_admin() in production. A disposable database without it gets a stub that admits nobody.
do $$ begin if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='is_admin') then
 execute 'create function public.is_admin() returns boolean language sql stable as $f$ select false $f$'; end if; end $$;
alter table public.athlete_identity_membership add column if not exists label text check(label is null or length(btrim(label)) between 1 and 80);

-- The acting administrator: a verified, non-anonymous License Admin session.
create or replace function coach_memory_private.admin_actor()
returns uuid language plpgsql stable security invoker set search_path='' as $$
declare u uuid := (select auth.uid());
begin
 if u is null or not coalesce(public.is_admin(), false) then raise exception 'Access denied' using errcode='42501'; end if;
 if exists(select 1 from auth.users x where x.id=u and x.is_anonymous is true) then raise exception 'Access denied' using errcode='42501'; end if;
 return u;
end $$;
revoke all on function coach_memory_private.admin_actor() from public,anon,authenticated;

-- One-time per program: the administrator grants themselves management of that program.
create or replace function public.cm_admin_bootstrap(p_program text)
returns boolean language plpgsql security definer set search_path='' as $$
declare u uuid := coach_memory_private.admin_actor(); k text := btrim(coalesce(p_program,''));
begin
 if length(k) not between 1 and 200 then raise exception 'Invalid program' using errcode='22023'; end if;
 insert into coach_memory_private.admin_grant(user_id,program_key) values(u,k)
 on conflict do nothing;
 return true;
end $$;

-- Programs this administrator manages, with counts.
create or replace function public.cm_admin_programs()
returns table(program_key text, active_memberships bigint)
language plpgsql security definer set search_path='' as $$
declare u uuid := coach_memory_private.admin_actor();
begin
 return query select g.program_key,
  (select count(*) from public.athlete_identity_membership m where m.program_key=g.program_key and m.starts_at<=clock_timestamp() and (m.ends_at is null or m.ends_at>clock_timestamp()))
 from coach_memory_private.admin_grant g where g.user_id=u and g.revoked_at is null and g.granted_at<=clock_timestamp()
 order by g.program_key;
end $$;

-- Enroll one verified athlete: the administrator is the approver and the enroller (same verified session).
create or replace function public.cm_admin_enroll(p_program text, p_label text)
returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid := coach_memory_private.admin_actor(); k text := btrim(coalesce(p_program,'')); l text := btrim(coalesce(p_label,''));
 a uuid; r record;
begin
 if length(k) not between 1 and 200 then raise exception 'Invalid program' using errcode='22023'; end if;
 if length(l) not between 1 and 80 then raise exception 'Invalid label' using errcode='22023'; end if;
 if not coach_memory_private.can_manage_program(u,k) then raise exception 'Access denied' using errcode='42501'; end if;
 insert into coach_memory_private.enrollment_approval(program_key,approved_by,expires_at) values(k,u,clock_timestamp()+interval '1 hour') returning id into a;
 select * into r from coach_memory_private.consume_enrollment(u,a);
 update public.athlete_identity_membership set label=l where id=r.membership_id;
 return r.membership_id;
end $$;

-- Memberships of a program with their coaches (emails shown to the administrator only).
create or replace function public.cm_admin_memberships(p_program text)
returns table(membership_id uuid, label text, starts_at timestamptz, ends_at timestamptz, coaches jsonb)
language plpgsql security definer set search_path='' as $$
declare u uuid := coach_memory_private.admin_actor(); k text := btrim(coalesce(p_program,''));
begin
 if not coach_memory_private.can_manage_program(u,k) then raise exception 'Access denied' using errcode='42501'; end if;
 return query select m.id,m.label,m.starts_at,m.ends_at,
  coalesce((select jsonb_agg(jsonb_build_object('email',x.email,'granted_at',g.granted_at) order by x.email)
            from coach_memory_private.coach_grant g join auth.users x on x.id=g.user_id
            where g.membership_id=m.id and g.revoked_at is null),'[]'::jsonb)
 from public.athlete_identity_membership m where m.program_key=k
 order by (m.ends_at is not null), lower(m.label), m.starts_at;
end $$;

create or replace function public.cm_admin_set_label(p_membership uuid, p_label text)
returns boolean language plpgsql security definer set search_path='' as $$
declare u uuid := coach_memory_private.admin_actor(); l text := btrim(coalesce(p_label,'')); k text;
begin
 if length(l) not between 1 and 80 then raise exception 'Invalid label' using errcode='22023'; end if;
 select program_key into k from public.athlete_identity_membership where id=p_membership for update;
 if not found or not coach_memory_private.can_manage_program(u,k) then raise exception 'Access denied' using errcode='42501'; end if;
 update public.athlete_identity_membership set label=l where id=p_membership;
 return true;
end $$;

-- End a membership (history is preserved; coaches lose access from now on).
create or replace function public.cm_admin_end_membership(p_membership uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare u uuid := coach_memory_private.admin_actor(); k text;
begin
 select program_key into k from public.athlete_identity_membership where id=p_membership for update;
 if not found or not coach_memory_private.can_manage_program(u,k) then raise exception 'Access denied' using errcode='42501'; end if;
 update public.athlete_identity_membership set ends_at=clock_timestamp() where id=p_membership and ends_at is null;
 return true;
end $$;

-- Does a coach account exist for this email? (yes/no only; no identifiers are returned)
create or replace function public.cm_admin_coach_exists(p_email text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 perform coach_memory_private.admin_actor();
 return exists(select 1 from auth.users x where lower(x.email)=lower(btrim(coalesce(p_email,''))) and x.is_anonymous is not true);
end $$;

-- Grant a named coach access to one membership. Idempotent while the grant is active.
create or replace function public.cm_admin_grant_coach(p_membership uuid, p_email text)
returns boolean language plpgsql security definer set search_path='' as $$
declare u uuid := coach_memory_private.admin_actor(); k text; c uuid;
begin
 select x.id into c from auth.users x where lower(x.email)=lower(btrim(coalesce(p_email,''))) and x.is_anonymous is not true;
 if c is null then raise exception 'No coach account with that email' using errcode='22023'; end if;
 select program_key into k from public.athlete_identity_membership where id=p_membership and starts_at<=clock_timestamp() and (ends_at is null or ends_at>clock_timestamp()) for update;
 if not found or not coach_memory_private.can_manage_program(u,k) then raise exception 'Access denied' using errcode='42501'; end if;
 if exists(select 1 from coach_memory_private.coach_grant g where g.membership_id=p_membership and g.user_id=c and g.revoked_at is null) then return true; end if;
 insert into coach_memory_private.coach_grant(user_id,membership_id,granted_by) values(c,p_membership,u);
 return true;
end $$;

-- Revoke a coach's access to one membership (same lock order as the engine: membership, then grant).
create or replace function public.cm_admin_revoke_coach(p_membership uuid, p_email text)
returns boolean language plpgsql security definer set search_path='' as $$
declare u uuid := coach_memory_private.admin_actor(); k text; c uuid;
begin
 select x.id into c from auth.users x where lower(x.email)=lower(btrim(coalesce(p_email,'')));
 select program_key into k from public.athlete_identity_membership where id=p_membership for update;
 if not found or not coach_memory_private.can_manage_program(u,k) then raise exception 'Access denied' using errcode='42501'; end if;
 perform 1 from coach_memory_private.coach_grant g where g.membership_id=p_membership and g.user_id=c and g.revoked_at is null for update;
 update coach_memory_private.coach_grant set revoked_at=clock_timestamp() where membership_id=p_membership and user_id=c and revoked_at is null;
 return found;
end $$;

revoke all on function public.cm_admin_bootstrap(text),public.cm_admin_programs(),public.cm_admin_enroll(text,text),public.cm_admin_memberships(text),
 public.cm_admin_set_label(uuid,text),public.cm_admin_end_membership(uuid),public.cm_admin_coach_exists(text),public.cm_admin_grant_coach(uuid,text),public.cm_admin_revoke_coach(uuid,text) from public,anon;
grant execute on function public.cm_admin_bootstrap(text),public.cm_admin_programs(),public.cm_admin_enroll(text,text),public.cm_admin_memberships(text),
 public.cm_admin_set_label(uuid,text),public.cm_admin_end_membership(uuid),public.cm_admin_coach_exists(text),public.cm_admin_grant_coach(uuid,text),public.cm_admin_revoke_coach(uuid,text) to authenticated;
commit;
