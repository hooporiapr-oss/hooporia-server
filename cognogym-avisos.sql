-- ════════════════════════════════════════════════════════════════
--  COGNOGYM.COM — "AVÍSAME CADA LUNES"
--
--  The list of people who asked to be told about each new weekly
--  challenge on cognogym.com. One row per email or phone number.
--
--  Nobody reads this table from a browser: RLS is on with no
--  policies, and the only way in is cg_aviso_apuntar(), which the
--  server (avisos.js) calls with the service key. The page never
--  sees the list, not even its own row.
--
--  Unsubscribing never deletes a row: "baja" gets a date, and the
--  row stays as the record that this person asked to stop. Signing
--  up again clears it.
--
--  Run the whole file in the Supabase SQL editor. Running it twice
--  breaks nothing.
--
--  Every new signup is also emailed to cognogym@gmail.com by the
--  server, with how many are on the list, so nobody has to open
--  Supabase to keep up. The table is still the full record.
--
--  To see the list:
--      select contacto, tipo, reto, creado from cg_avisos
--      where baja is null order by creado;
-- ════════════════════════════════════════════════════════════════

create table if not exists public.cg_avisos (
  id        uuid primary key default gen_random_uuid(),
  contacto  text not null,                 -- email in lower case, or phone digits (1 + 10)
  tipo      text not null check (tipo in ('email', 'tel')),
  reto      text,                          -- the challenge they were looking at
  creado    timestamptz not null default now(),
  baja      timestamptz                    -- when they asked to stop; null = still on the list
);
create unique index if not exists cg_avisos_contacto on public.cg_avisos (contacto);

alter table public.cg_avisos enable row level security;
revoke all on public.cg_avisos from anon, authenticated;

-- Returns 'nuevo' (added, or back after a baja), 'ya' (already on the
-- list) or 'mal' (not an email or a phone number).
create or replace function public.cg_aviso_apuntar(p_contacto text, p_reto text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  c text := btrim(coalesce(p_contacto, ''));
  t text;
  r text := left(nullif(btrim(coalesce(p_reto, '')), ''), 80);
  antes timestamptz;
  existe boolean;
begin
  if position('@' in c) > 0 then
    c := lower(c); t := 'email';
    if length(c) > 120 or c !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' then return 'mal'; end if;
  else
    c := regexp_replace(c, '[^0-9]', '', 'g'); t := 'tel';
    if length(c) = 10 then c := '1' || c; end if;          -- 787 / 939 numbers written without the 1
    if length(c) <> 11 or left(c, 1) <> '1' then return 'mal'; end if;
  end if;

  select true, baja into existe, antes from cg_avisos where contacto = c;
  if existe then
    if antes is not null then
      update cg_avisos set baja = null, reto = coalesce(r, reto) where contacto = c;
      return 'nuevo';
    end if;
    return 'ya';
  end if;

  insert into cg_avisos (contacto, tipo, reto) values (c, t, r)
  on conflict (contacto) do nothing;
  return 'nuevo';
end $$;

revoke all on function public.cg_aviso_apuntar(text, text) from public, anon, authenticated;
grant execute on function public.cg_aviso_apuntar(text, text) to service_role;

-- How many are on the list now (for the email to cognogym@gmail.com).
create or replace function public.cg_avisos_total()
returns integer
language sql
security definer
set search_path = public
as $$ select count(*)::int from cg_avisos where baja is null $$;

revoke all on function public.cg_avisos_total() from public, anon, authenticated;
grant execute on function public.cg_avisos_total() to service_role;
