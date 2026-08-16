-- ============================================================================
--  Marcos del ranking — 5.ª categoría de pieza, y la única que ven los demás.
--
--  Las otras piezas (chasis, pintura, alerón, librea) solo se aprecian en tu
--  garaje. El marco se pinta en tu fila del ranking, que es lo que mira todo
--  el mundo.
--
--  LA CORONA MUNDIAL NO ENTRA EN catalog_pieces A PROPÓSITO: esa tabla es de
--  donde sortea open_pack, así que meterla ahí la haría comprable con monedas
--  y dejaría de ser un logro. Se concede sola (ver grant_world_crowns).
--
--  Pégalo entero en Supabase > SQL Editor > New query > Run.
-- ============================================================================

-- 1) Columna. 'sin_marco' = como se ve hoy.
alter table public.users
  add column if not exists car_frame text not null default 'sin_marco';

-- 2) Marcos sorteables (la corona NO va aquí).
insert into public.catalog_pieces (category, piece_id, rarity, hex) values
  ('frame', 'filo',     'rara',  null),
  ('frame', 'esquinas', 'rara',  null),
  ('frame', 'doble',    'epica', null)
on conflict (category, piece_id) do update set rarity = excluded.rarity;

-- 3) save_loadout con marco. Igual que con el chasis: la firma es parte de la
--    identidad de la función en Postgres, así que la de 7 argumentos hay que
--    borrarla o seguiría siendo llamable saltándose la validación del marco.
drop function if exists public.save_loadout(text, text, text, text, text, text, text);

create or replace function public.save_loadout(
  p_chassis text, p_frame text,
  p_body_color text, p_wing_shape text, p_wing_color text,
  p_livery text, p_livery_pattern text, p_lights_color text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_free_colors text[] := array['#ffffff','#1a1a1c','#ffd23f','#ff5a1f','#ff5c5c','#4fa9ff','#3fae5c','#6b4a2f'];
  v_free_lights text[] := array['#fff6cf','#ffb84d'];
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;

  if not (p_chassis = 'gt' or exists(
    select 1 from public.inventory
    where user_id = v_uid and category = 'chassis' and piece_id = p_chassis
  )) then raise exception 'PIECE_NOT_OWNED: chassis'; end if;

  -- El marco incluye la corona: no se compra, pero SÍ se equipa una vez
  -- ganada, y en el inventario se ve igual que cualquier otra pieza.
  if not (p_frame = 'sin_marco' or exists(
    select 1 from public.inventory
    where user_id = v_uid and category = 'frame' and piece_id = p_frame
  )) then raise exception 'PIECE_NOT_OWNED: frame'; end if;

  if not (p_body_color = any(v_free_colors) or exists(
    select 1 from public.catalog_pieces cp
    join public.inventory i on i.category = cp.category and i.piece_id = cp.piece_id
    where cp.category = 'color' and cp.hex = p_body_color and i.user_id = v_uid
  )) then raise exception 'PIECE_NOT_OWNED: body_color'; end if;

  if not (p_wing_shape = 'sin_aleron' or exists(
    select 1 from public.inventory where user_id = v_uid and category = 'wing' and piece_id = p_wing_shape
  )) then raise exception 'PIECE_NOT_OWNED: wing_shape'; end if;

  if not (p_wing_color = any(v_free_colors) or exists(
    select 1 from public.catalog_pieces cp
    join public.inventory i on i.category = cp.category and i.piece_id = cp.piece_id
    where cp.category = 'color' and cp.hex = p_wing_color and i.user_id = v_uid
  )) then raise exception 'PIECE_NOT_OWNED: wing_color'; end if;

  if p_livery is not null and not (p_livery = any(v_free_colors) or exists(
    select 1 from public.catalog_pieces cp
    join public.inventory i on i.category = cp.category and i.piece_id = cp.piece_id
    where cp.category = 'color' and cp.hex = p_livery and i.user_id = v_uid
  )) then raise exception 'PIECE_NOT_OWNED: livery_color'; end if;

  if not (p_livery_pattern = 'simple' or exists(
    select 1 from public.inventory where user_id = v_uid and category = 'livery' and piece_id = p_livery_pattern
  )) then raise exception 'PIECE_NOT_OWNED: livery_pattern'; end if;

  if not (p_lights_color = any(v_free_lights)) then
    raise exception 'PIECE_NOT_OWNED: lights_color';
  end if;

  update public.users set
    car_chassis = p_chassis,
    car_frame = p_frame,
    car_body_color = p_body_color,
    car_wing_shape = p_wing_shape,
    car_wing_color = p_wing_color,
    car_livery = p_livery,
    car_livery_pattern = p_livery_pattern,
    car_lights_color = p_lights_color
  where id = v_uid;
end;
$$;

grant execute on function public.save_loadout(text, text, text, text, text, text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
--  4) La Corona mundial: se concede al 1.º del día.
--
--  Va en SQL puro y con su propio cron, no dentro de la Edge Function
--  close-ranking-rewards, para que se pueda instalar pegando esto y sin
--  redesplegar nada. Es idempotente: `on conflict do nothing` sobre la PK de
--  inventory, así que correrlo mil veces sobre el mismo día no duplica nada y
--  quien ya la tenga no la vuelve a "ganar".
-- ----------------------------------------------------------------------------
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
  -- El 1.º del día = el mejor tiempo. Si nadie corrió, no hay corona.
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
  return v_granted;
end;
$$;

-- Solo la ejecuta el cron (service_role), nunca un cliente.
--
-- OJO CON EL `public`: en Postgres toda función nace con EXECUTE concedido al
-- pseudo-rol PUBLIC, así que revocar solo a `authenticated, anon` NO cierra
-- nada — se hereda igualmente por PUBLIC. Se comprobó en caliente: un jugador
-- normal pudo llamarla y conceder una corona. Y no es inofensivo, porque
-- acepta fecha: cualquiera podría pasar un día antiguo que ganó él y
-- adjudicarse la corona sin esperar al cron.
--
-- Este es el mismo patrón que ya usa credit_wallet (economy.sql), que sí
-- estaba bien cerrada.
revoke execute on function public.grant_world_crowns(date) from public, anon, authenticated;
grant execute on function public.grant_world_crowns(date) to service_role;

-- Comprobación de categorías del catálogo (la corona NO debe aparecer).
select category, count(*) from public.catalog_pieces group by category order by category;
