-- ════════════════════════════════════════════════════════════════
--  COGNOGYM.COM/DEBATE — EL DEBATE DEL DÍA / THE DAILY BUCKET
--
--  One basketball question a day, one anonymous vote per person.
--
--  The day turns at 7:00 a.m. Puerto Rico time: a question dated
--  2026-11-16 is open from 7:00 a.m. that day until 6:59 a.m. the
--  next. Nothing has to run for that to happen — every read works
--  out "today" from the clock, so a question appears on its own.
--
--  The questions themselves are NOT in this file or in any repo: the
--  repos are public, and next week's debate would be readable today.
--  They are loaded from a separate file kept off GitHub.
--
--  Nobody reads these tables from a browser: RLS is on with no
--  policies, and the server (debate.js) calls the functions below
--  with the service key. A visitor is a random id their phone keeps;
--  "red" is a one-way hash of their network that the server makes, so
--  one network can't stuff the box. No names, emails or phones.
--
--  Run the whole file in the Supabase SQL editor. Running it twice
--  breaks nothing and erases no votes.
-- ════════════════════════════════════════════════════════════════

create table if not exists public.cg_preguntas (
  fecha      date primary key,                  -- the day it is open (from 7:00 a.m. PR)
  categoria  text not null,                     -- prefieres, harias, debate, antes, razon, fanatico
  domingo    boolean not null default false,    -- El Gran Debate del Domingo
  es         text not null,
  en         text not null,
  opciones   jsonb not null,                    -- [{"id":"a","es":"…","en":"…"}, …] two to four
  arte       text,                              -- the day's artwork, a path on cognogym.com/debate/
  creado     timestamptz not null default now(),
  check (jsonb_typeof(opciones) = 'array' and jsonb_array_length(opciones) between 2 and 4)
);

create table if not exists public.cg_votos (
  id         bigserial primary key,
  fecha      date not null references public.cg_preguntas (fecha) on delete cascade,
  opcion     text not null,
  visitante  text not null,
  red        text not null,
  creado     timestamptz not null default now(),
  unique (fecha, visitante)                     -- one vote per phone per question
);
create index if not exists cg_votos_red on public.cg_votos (fecha, red);

alter table public.cg_preguntas enable row level security;
alter table public.cg_votos enable row level security;
revoke all on public.cg_preguntas, public.cg_votos from anon, authenticated;

-- Today's debate day in Puerto Rico: the date changes at 7:00 a.m.
create or replace function public.cg_debate_dia()
returns date language sql stable as $$
  select ((now() at time zone 'America/Puerto_Rico') - interval '7 hours')::date
$$;

-- When the next question opens (7:00 a.m. PR tomorrow), for the countdown.
create or replace function public.cg_debate_proximo()
returns timestamptz language sql stable as $$
  select ((public.cg_debate_dia() + 1) + time '07:00') at time zone 'America/Puerto_Rico'
$$;

-- One question with its real counts. Null if there is none that day.
create or replace function public.cg_debate_resumen(p_fecha date)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'fecha', p.fecha, 'categoria', p.categoria, 'domingo', p.domingo,
    'es', p.es, 'en', p.en, 'arte', p.arte,
    'opciones', (select json_agg(json_build_object('id', o->>'id', 'es', o->>'es', 'en', o->>'en',
                   'votos', (select count(*) from cg_votos v where v.fecha = p.fecha and v.opcion = o->>'id')) order by ord)
                 from jsonb_array_elements(p.opciones) with ordinality as x(o, ord)),
    'total', (select count(*) from cg_votos v where v.fecha = p.fecha))
  from cg_preguntas p where p.fecha = p_fecha
$$;

-- Everything the page needs on arrival.
create or replace function public.cg_debate_hoy(p_visitante text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'dia', public.cg_debate_dia(),
    'proximo', public.cg_debate_proximo(),
    'hoy', public.cg_debate_resumen(public.cg_debate_dia()),
    'mio', (select opcion from cg_votos where fecha = public.cg_debate_dia() and visitante = p_visitante),
    'ayer', public.cg_debate_resumen((select max(fecha) from cg_preguntas where fecha < public.cg_debate_dia())))
$$;

-- A vote. Only today's question takes votes; past ones are closed and
-- future ones don't exist yet as far as the page is concerned.
--   estado: ok · ya (already voted — returns what they chose) · cerrada · mal · limite
create or replace function public.cg_debate_votar(p_fecha date, p_opcion text, p_visitante text, p_red text)
returns json language plpgsql security definer set search_path = public as $$
declare
  dia date := public.cg_debate_dia();
  prev text;
begin
  if p_visitante is null or p_visitante !~ '^[a-z0-9-]{8,64}$' or coalesce(p_red, '') = '' then
    return json_build_object('estado', 'mal');
  end if;
  if p_fecha is distinct from dia or not exists (select 1 from cg_preguntas where fecha = dia) then
    return json_build_object('estado', 'cerrada');
  end if;
  if not exists (select 1 from cg_preguntas p, jsonb_array_elements(p.opciones) o where p.fecha = dia and o->>'id' = p_opcion) then
    return json_build_object('estado', 'mal');
  end if;
  select opcion into prev from cg_votos where fecha = dia and visitante = p_visitante;
  if prev is not null then
    return json_build_object('estado', 'ya', 'mio', prev, 'resumen', public.cg_debate_resumen(dia));
  end if;
  -- a school or a family shares one network; 40 votes a day from one is plenty
  if (select count(*) from cg_votos where fecha = dia and red = p_red) >= 40 then
    return json_build_object('estado', 'limite');
  end if;
  insert into cg_votos (fecha, opcion, visitante, red) values (dia, p_opcion, p_visitante, p_red)
  on conflict (fecha, visitante) do nothing;
  return json_build_object('estado', 'ok', 'mio', (select opcion from cg_votos where fecha = dia and visitante = p_visitante),
                           'resumen', public.cg_debate_resumen(dia));
end $$;

-- Past debates, newest first, with final results. p_antes pages back.
create or replace function public.cg_debate_archivo(p_antes date default null, p_n int default 10)
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(public.cg_debate_resumen(f) order by f desc), '[]'::json)
  from (select fecha f from cg_preguntas
        where fecha < public.cg_debate_dia() and (p_antes is null or fecha < p_antes)
        order by fecha desc limit least(greatest(coalesce(p_n, 10), 1), 30)) s
$$;

revoke all on function public.cg_debate_resumen(date), public.cg_debate_hoy(text),
  public.cg_debate_votar(date, text, text, text), public.cg_debate_archivo(date, int) from public, anon, authenticated;
grant execute on function public.cg_debate_hoy(text), public.cg_debate_votar(date, text, text, text),
  public.cg_debate_archivo(date, int) to service_role;
