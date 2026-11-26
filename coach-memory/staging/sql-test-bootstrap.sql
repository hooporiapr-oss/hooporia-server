-- Synthetic fixtures for disposable PostgreSQL only.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users(id uuid primary key,is_anonymous boolean not null default false,email text);
create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id),not_after timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to authenticated,anon;
grant execute on function auth.uid() to authenticated,anon;
-- License Admin stand-in: production has public.is_admin() backed by the admins table.
create table public.admins(user_id uuid primary key);
create function public.is_admin() returns boolean language sql stable as $$ select exists(select 1 from public.admins a where a.user_id=auth.uid()) $$;
grant execute on function public.is_admin() to authenticated,anon;
