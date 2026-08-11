-- ============================================================================
--  Grand Prix — campeonato semanal por grupo (v1: bucle núcleo, sin premio en
--  monedas todavía — ver plan). 7 circuitos EXCLUSIVOS del grupo (sembrados
--  'gp-<id>-<day_index>', no la fecha global), formato clasificación: las 2
--  primeras vueltas de cada circuito son práctica (el cliente NO llama a
--  submit_gp_result para ellas), desde la 3ª cada intento clasifica y aquí
--  se queda con tu mejor tiempo — igual que el resto de la app, mejor-de-N.
--
--  Mismo patrón que career.sql/groups.sql: RLS select-scoped (a los grupos a
--  los que perteneces, vía el helper my_group_ids() de groups.sql — este
--  archivo debe pegarse DESPUÉS de groups.sql), ESCRITURA SOLO vía RPC
--  security definer (sin policies de insert/update).
--
--  Pégalo en Supabase > SQL Editor > Run (después de groups.sql).
-- ============================================================================

create table if not exists public.grand_prix (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups (id) on delete cascade,
  created_by    uuid references public.users (id) on delete set null,
  started_at    timestamptz not null default now(),
  circuit_count int not null default 7,
  status        text not null default 'active' check (status in ('active', 'finished'))
);

-- Un GP activo como máximo por grupo (JC: "uno activo por grupo").
create unique index if not exists gp_one_active_per_group
  on public.grand_prix (group_id) where status = 'active';

create table if not exists public.gp_results (
  gp_id      uuid not null references public.grand_prix (id) on delete cascade,
  day_index  int  not null check (day_index >= 1),
  user_id    uuid not null references public.users (id) on delete cascade,
  ms         int  not null check (ms > 0),
  sector_ms  int[], -- splits de sector de LA VUELTA QUE CLASIFICÓ este ms (para la "batalla de sectores"), opcional
  updated_at timestamptz not null default now(),
  primary key (gp_id, day_index, user_id)
);
create index if not exists gp_results_gp_day on public.gp_results (gp_id, day_index);

-- Si la tabla ya existía de antes de añadir sector_ms (ejecuciones previas
-- de este archivo), añade la columna sin perder datos.
alter table public.gp_results add column if not exists sector_ms int[];

-- Log de notificaciones del cron gp-tick (ronda abierta / última llamada /
-- terminado) — la clave única es la que garantiza que no se manda dos veces
-- aunque el cron se solape, no el chequeo de tiempo (mismo criterio que
-- wallet_transactions en economy.sql). Solo lo toca gp-tick vía service_role.
create table if not exists public.gp_notify_log (
  gp_id      uuid not null references public.grand_prix (id) on delete cascade,
  kind       text not null, -- 'round_open' | 'last_chance' | 'finished'
  day_index  int  not null default 0,
  sent_at    timestamptz not null default now(),
  primary key (gp_id, kind, day_index)
);
alter table public.gp_notify_log enable row level security;
-- Sin policies: nadie autenticado puede leer/escribir directamente, solo
-- service_role (que se salta RLS) desde la Edge Function.

alter table public.grand_prix enable row level security;
alter table public.gp_results enable row level security;

-- ---- RLS: solo lees el GP (y sus resultados) de tus propios grupos --------
drop policy if exists grand_prix_select on public.grand_prix;
create policy grand_prix_select on public.grand_prix for select to authenticated
  using (group_id in (select public.my_group_ids()));

drop policy if exists gp_results_select on public.gp_results;
create policy gp_results_select on public.gp_results for select to authenticated
  using (gp_id in (select id from public.grand_prix where group_id in (select public.my_group_ids())));

-- Las escrituras van SIEMPRE por las funciones de abajo — sin policies de
-- insert/update, quedan bloqueadas a propósito.

-- ---- Arrancar un Grand Prix para un grupo -----------------------------------
create or replace function public.start_grand_prix(p_group_id uuid)
returns public.grand_prix
language plpgsql
security definer
set search_path = public
as $$
declare
  gp public.grand_prix;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_group_id not in (select public.my_group_ids()) then raise exception 'NOT_A_MEMBER'; end if;
  begin
    insert into public.grand_prix (group_id, created_by) values (p_group_id, auth.uid())
      returning * into gp;
  exception when unique_violation then
    raise exception 'GP_ALREADY_ACTIVE';
  end;
  return gp;
end;
$$;

-- ---- Clasificar un tiempo para una ronda ------------------------------------
-- Válido solo si: eres miembro del grupo dueño del GP, el GP sigue activo, el
-- day_index está dentro de circuit_count, esa ronda ya ha "abierto" (han
-- pasado (day_index-1) * 24h desde started_at) Y TE UNISTE AL GRUPO ANTES DE
-- QUE ESA RONDA CERRARA — un amigo que se une a mitad de temporada empieza
-- de 0 puntos y suma desde la ronda en curso (puede jugarla, la que esté
-- abierta cuando se une), pero no puede volver atrás a clasificar rondas ya
-- cerradas antes de que existiera en el grupo. El cliente decide cuándo
-- LLAMAR (vueltas de práctica no llaman a esto), pero el servidor es quien
-- manda en todo lo demás.
--
-- OJO firma: se añadió p_sector_ms (4º parámetro) para la batalla de
-- sectores. `create or replace` NO sustituye la función vieja de 3
-- parámetros (para Postgres son dos funciones distintas por firma) — hay que
-- borrar la vieja explícitamente o quedan las dos y PostgREST no sabe cuál
-- usar.
drop function if exists public.submit_gp_result(uuid, int, int);
create or replace function public.submit_gp_result(p_gp_id uuid, p_day_index int, p_ms int, p_sector_ms int[] default null)
returns table(is_best boolean, prev_ms int)
language plpgsql
security definer
set search_path = public
as $$
declare
  gp public.grand_prix;
  v_prev int;
  v_joined timestamptz;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_ms is null or p_ms <= 0 then raise exception 'INVALID_MS'; end if;

  select * into gp from public.grand_prix where id = p_gp_id;
  if gp.id is null then raise exception 'GP_NOT_FOUND'; end if;
  if gp.group_id not in (select public.my_group_ids()) then raise exception 'NOT_A_MEMBER'; end if;
  if gp.status <> 'active' then raise exception 'GP_NOT_ACTIVE'; end if;
  if p_day_index is null or p_day_index < 1 or p_day_index > gp.circuit_count then
    raise exception 'INVALID_DAY_INDEX';
  end if;
  if gp.started_at + (p_day_index - 1) * interval '24 hours' > now() then
    raise exception 'ROUND_NOT_OPEN';
  end if;

  select gm.joined_at into v_joined from public.group_members gm
    where gm.group_id = gp.group_id and gm.user_id = auth.uid();
  if v_joined is null then raise exception 'NOT_A_MEMBER'; end if;
  if v_joined >= gp.started_at + p_day_index * interval '24 hours' then
    raise exception 'JOINED_AFTER_ROUND';
  end if;

  select r.ms into v_prev from public.gp_results r
    where r.gp_id = p_gp_id and r.day_index = p_day_index and r.user_id = auth.uid();

  insert into public.gp_results (gp_id, day_index, user_id, ms, sector_ms)
    values (p_gp_id, p_day_index, auth.uid(), p_ms, p_sector_ms)
  on conflict (gp_id, day_index, user_id) do update
    set ms = excluded.ms, sector_ms = excluded.sector_ms, updated_at = now()
    where gp_results.ms > excluded.ms;

  return query select (v_prev is null or p_ms < v_prev), v_prev;
end;
$$;

grant execute on function public.start_grand_prix(uuid)                       to authenticated;
grant execute on function public.submit_gp_result(uuid, int, int, int[])      to authenticated;
