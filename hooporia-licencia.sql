-- ════════════════════════════════════════════════════════════════
--  LA LICENCIA DE UN EVENTO — lo que se cobra, una sola vez
--
--  Hooporia no cobra promesas. El único dinero que existe aquí es la
--  licencia de la plataforma, y la paga el programa:
--
--      $49 por equipo, por evento
--      $29 si la plantilla tiene menos de ocho
--      y si el evento no recogió ni una promesa, no se factura nada
--
--  Un evento es un reto. Un programa puede correr varios a lo largo
--  del año y cada uno es su propia licencia.
--
--  ── Por qué el precio vive aquí y no en el servidor ──────────────
--  Porque es la cuenta del dinero. El servidor pide la cifra y la
--  manda a Stripe; si la calculara él, habría dos sitios donde el
--  precio puede estar mal y sólo uno se podría revisar con un SELECT.
--  Aquí se puede mirar, en cualquier momento, qué se le debería
--  cobrar a un reto sin facturar nada:
--
--      select * from licencia_calculo('<id del reto>');
--
--  ── Lo que impide cobrar dos veces ───────────────────────────────
--  No es el botón del admin ni una comprobación del servidor: es el
--  índice único sobre challenge_id. Dos clics seguidos, dos pestañas
--  abiertas o un reintento de Stripe dan error de llave duplicada en
--  vez de dos facturas al mismo programa. Una factura de más a un
--  cliente no se arregla con una disculpa.
--
--  Se corre entero en el editor SQL de Supabase. Dos veces no rompe
--  nada.
-- ════════════════════════════════════════════════════════════════


-- ── 1. La tabla ───────────────────────────────────────────────────
create table if not exists public.licencias (
  id            uuid primary key default gen_random_uuid(),
  challenge_id  uuid not null references public.challenges(id) on delete cascade,
  campaign_id   uuid references public.campaigns(id) on delete set null,

  -- En centavos, como Stripe. Un float para dinero es cómo se pierde
  -- un centavo por redondeo y nadie sabe dónde.
  amount_cents  integer not null check (amount_cents >= 0),

  -- Con qué se decidió el precio, guardado tal como estaba el día de
  -- la factura. La plantilla cambia; lo que se cobró, no.
  roster        integer,
  promesas      integer,

  -- open → enviada → pagada. 'anulada' para una que se tuvo que
  -- retirar; no se borra la fila, que entonces se podría volver a
  -- facturar el mismo evento.
  estado        text not null default 'open'
                check (estado in ('open','enviada','pagada','anulada')),

  stripe_invoice_id text,
  stripe_hosted_url text,
  program_email text,
  program_name  text,

  created_at    timestamptz not null default now(),
  issued_at     timestamptz,
  paid_at       timestamptz,
  due_at        timestamptz
);

comment on table public.licencias is
  'Una fila por reto facturado. El unico dinero de Hooporia: la licencia de la plataforma que paga el programa. Nada que ver con las promesas de los padrinos, que no pasan por aqui.';

-- Lo que de verdad impide la factura doble. Las anuladas no cuentan:
-- si una se retira, el evento se tiene que poder volver a facturar.
create unique index if not exists licencias_un_reto
  on public.licencias (challenge_id)
  where estado <> 'anulada';

create index if not exists licencias_por_estado on public.licencias (estado);
create index if not exists licencias_por_stripe on public.licencias (stripe_invoice_id);


-- ── 2. El precio, en un sitio ─────────────────────────────────────
--  Cambiar la tarifa es cambiar estas tres líneas. El sitio web lo
--  dice con palabras en cinco páginas, que es otra cosa — pero el
--  número que se le cobra a alguien sale de aquí y de ningún otro
--  sitio.
create or replace function public.licencia_tarifa(p_roster integer)
returns integer
language sql
immutable
as $$
  select case when coalesce(p_roster, 0) < 8 then 2900 else 4900 end;
$$;

comment on function public.licencia_tarifa(integer) is
  'Centavos que cuesta la licencia de un evento segun el tamano de la plantilla: 2900 bajo ocho, 4900 de ocho en adelante.';


-- ── 3. Qué se le debería cobrar a un reto ─────────────────────────
--  No factura nada: calcula y dice. El servidor lo llama dos veces —
--  una para enseñárselo al admin antes de confirmar, y otra al
--  facturar de verdad— y las dos ven el mismo número.
--
--  La plantilla son los jugadores aprobados de la campaña, que es lo
--  que el programa llama su plantilla. Las promesas son las de este
--  reto, sin contar las anuladas: una promesa retirada no es una
--  promesa recogida.
create or replace function public.licencia_calculo(p_challenge uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto     record;
  v_roster   integer;
  v_promesas integer;
  v_ya       record;
  v_correo   text;
  v_nombre   text;
begin
  select ch.id, ch.name, ch.campaign_id, ch.closes_at, c.name as programa
    into v_reto
    from public.challenges ch
    left join public.campaigns c on c.id = ch.campaign_id
   where ch.id = p_challenge;

  if v_reto.id is null then
    return json_build_object('ok', false, 'why', 'no existe ese reto');
  end if;

  /* La plantilla que cuenta para el precio son los APROBADOS. Quien
     se apuntó y espera no es plantilla todavía: el entrenador puede
     decir que no, y cobrarle al programa por alguien que rechazó
     sería cobrarle por nada.

     Aquí ponía coalesce(p.active, true), y players no tiene ninguna
     columna 'active' — tiene 'status'. Se escribió a ojo antes de
     volcar el esquema, que es exactamente lo que el volcado existía
     para evitar. Postgres no se queja hasta que la función corre, y
     la función no corría hasta la primera factura: salió el día que
     se intentó cobrar de verdad. */
  select count(*) into v_roster
    from public.players p
   where p.campaign_id = v_reto.campaign_id
     and p.status = 'active';

  select count(*) into v_promesas
    from public.pledges pg
   where pg.challenge_id = p_challenge
     and coalesce(pg.invoice_status, '') <> 'void';

  -- ¿Ya tiene licencia? Se dice aquí para que el servidor no tenga
  -- que preguntarlo por separado y pueda equivocarse de pregunta.
  select l.id, l.estado, l.amount_cents, l.stripe_hosted_url
    into v_ya
    from public.licencias l
   where l.challenge_id = p_challenge
     and l.estado <> 'anulada'
   limit 1;

  -- A quién se le factura: el entrenador de la campaña con correo.
  select co.name, co.email into v_nombre, v_correo
    from public.coaches co
   where co.campaign_id = v_reto.campaign_id
     and co.email is not null
   order by co.created_at asc
   limit 1;

  return json_build_object(
    'ok',            true,
    'challenge_id',  v_reto.id,
    'challenge',     v_reto.name,
    'campaign_id',   v_reto.campaign_id,
    'programa',      v_reto.programa,
    'closes_at',     v_reto.closes_at,
    'roster',        v_roster,
    'promesas',      v_promesas,
    -- Sin promesas no hay cargo. Es lo que dice la página, así que
    -- tiene que ser lo que hace la base.
    'cobrable',      (v_promesas > 0),
    'amount_cents',  case when v_promesas > 0
                          then public.licencia_tarifa(v_roster)
                          else 0 end,
    'program_name',  v_nombre,
    'program_email', v_correo,
    'ya_facturada',  (v_ya.id is not null),
    'licencia',      case when v_ya.id is null then null else json_build_object(
                       'id', v_ya.id, 'estado', v_ya.estado,
                       'amount_cents', v_ya.amount_cents,
                       'url', v_ya.stripe_hosted_url) end
  );
end;
$$;

comment on function public.licencia_calculo(uuid) is
  'Que se le deberia cobrar a un reto por su licencia, sin facturar nada. Devuelve plantilla, promesas, si es cobrable (sin promesas no hay cargo), el importe en centavos, a quien se le factura, y si ya tiene licencia.';


-- ── 4. RLS ────────────────────────────────────────────────────────
--  Sólo el admin mira esto desde el navegador. El servidor de pagos
--  entra con la llave de servicio y se la salta, que es como tiene
--  que ser: quien factura es el servidor, no una página.
alter table public.licencias enable row level security;

drop policy if exists licencias_admin_ve on public.licencias;
create policy licencias_admin_ve on public.licencias
  for select using (public.is_admin());

-- Ni insert ni update ni delete desde el navegador. Ni para el admin:
-- una licencia se crea facturando, y facturar es del servidor.


-- ── 5. Comprobación ───────────────────────────────────────────────
--  La tarifa, que es lo único que se puede mirar sin datos:
select public.licencia_tarifa(0)  as sin_plantilla,   -- 2900
       public.licencia_tarifa(7)  as siete,           -- 2900
       public.licencia_tarifa(8)  as ocho,            -- 4900
       public.licencia_tarifa(30) as treinta;         -- 4900

--  Y lo que se le cobraría a un reto, sin cobrarle nada:
--     select * from licencia_calculo('<id del reto>');
