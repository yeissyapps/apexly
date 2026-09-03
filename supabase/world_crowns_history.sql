-- ============================================================================
--  Historial de coronas mundiales — cuántas veces ha sido cada uno 1.º del
--  mundo, no solo SI lo ha sido alguna vez.
--
--  JC: "molaría que fuera acumulativo y que en el ranking se pudiera ver las
--  veces que ha quedado primero del mundo".
--
--  Por qué hacía falta: grant_world_crowns (frames.sql) concede la corona con
--  `insert ... on conflict (user_id, category, piece_id) do nothing` sobre
--  inventory — la PRIMERA vez que ganas se crea la fila, la vez 50 no hace
--  nada porque ya la tenías. Ganar una vez o cincuenta se veía IGUAL: no
--  había ningún sitio donde quedara el número.
--
--  Pégalo en Supabase > SQL Editor > Run, DESPUÉS de frames.sql (reemplaza su
--  función grant_world_crowns por una que además apunta el historial).
-- ============================================================================

-- Una fila por (jugador, día) ganado. La PK compuesta es la idempotencia
-- real: correr grant_world_crowns mil veces sobre el mismo día para el mismo
-- ganador no duplica nada, sin necesitar una columna aparte de "último día
-- contado" que se pueda desincronizar si algún día se concede una corona
-- antigua a mano fuera de orden (ver world-crown-cron.sql).
create table if not exists public.world_crowns (
  user_id uuid not null references public.users (id) on delete cascade,
  day     date not null,
  primary key (user_id, day)
);

alter table public.world_crowns enable row level security;

-- Público como el resto del ranking (attempts/users ya lo son): todo el
-- mundo puede ver cuántas veces ha ganado cada uno, es la gracia de la
-- pieza — "es la única [pieza] que ve el resto", mismo criterio que ya
-- deja frames.sql por escrito.
create policy world_crowns_select_all on public.world_crowns
  for select using (true);

-- Vista agregada: un solo count(*) reutilizable desde el cliente en vez de
-- repetirlo en cada pantalla de ranking que quiera enseñar el número.
create or replace view public.world_win_counts as
  select user_id, count(*)::int as wins
    from public.world_crowns
   group by user_id;

-- grant_world_crowns, reemplazada: todo igual que en frames.sql, más el
-- insert al historial. Mismo `on conflict do nothing` de idempotencia.
create or replace function public.grant_world_crowns(p_day date default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := coalesce(p_day, (now() at time zone 'utc')::date - 1);
  v_winner uuid;
  v_granted int;
begin
  select user_id into v_winner
    from public.attempts
   where day = v_day
   order by best_ms asc
   limit 1;

  if v_winner is null then return 0; end if;

  insert into public.inventory (user_id, category, piece_id)
  values (v_winner, 'frame', 'corona')
  on conflict (user_id, category, piece_id) do nothing;

  get diagnostics v_granted = row_count;

  insert into public.world_crowns (user_id, day) values (v_winner, v_day)
  on conflict (user_id, day) do nothing;

  return v_granted;
end;
$$;

-- Mismo cierre que ya tenía (fix_crown_grants.sql): solo el cron, nunca un
-- cliente. create or replace NO conserva los grants de la versión anterior
-- en todos los casos, así que se repite explícito por si acaso.
revoke execute on function public.grant_world_crowns(date) from public, anon, authenticated;
grant execute on function public.grant_world_crowns(date) to service_role;
