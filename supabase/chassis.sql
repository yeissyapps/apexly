-- ============================================================================
--  Chasis elegible — columna, catálogo y validación.
--
--  El chasis es la 4.ª categoría de pieza (junto a color/wing/livery). Es SOLO
--  estético: la caja de colisión del juego sale de CONFIG.CAR_LENGTH/CAR_WIDTH
--  en el cliente y no depende del chasis, así que elegir uno ancho no da
--  ventaja. Si algún día eso cambiara, dejaría de ser justo el ranking.
--
--  Pégalo entero en Supabase > SQL Editor > New query > Run.
-- ============================================================================

-- 1) Columna en users. 'gt' es el coche de siempre: todos los que ya juegan se
--    quedan exactamente con el suyo.
alter table public.users
  add column if not exists car_chassis text not null default 'gt';

-- 2) Los chasis premium entran al catálogo, así que pueden salir en sobres.
insert into public.catalog_pieces (category, piece_id, rarity, hex) values
  ('chassis', 'clasico',   'rara',       null),
  ('chassis', 'monoplaza', 'epica',      null),
  ('chassis', 'prototipo', 'legendaria', null)
on conflict (category, piece_id) do update set rarity = excluded.rarity;

-- 3) save_loadout con chasis.
--    OJO: en Postgres la firma forma parte de la identidad de la función, así
--    que añadir un argumento CREA UNA FUNCIÓN NUEVA y la de 6 argumentos
--    seguiría existiendo y siendo llamable — dejaría una vía para escribir el
--    loadout saltándose la validación del chasis. Por eso se borra explícita.
drop function if exists public.save_loadout(text, text, text, text, text, text);

create or replace function public.save_loadout(
  p_chassis text,
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

  -- Chasis: 'gt' es libre; el resto hay que tenerlo en el inventario.
  if not (p_chassis = 'gt' or exists(
    select 1 from public.inventory
    where user_id = v_uid and category = 'chassis' and piece_id = p_chassis
  )) then raise exception 'PIECE_NOT_OWNED: chassis'; end if;

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
    car_body_color = p_body_color,
    car_wing_shape = p_wing_shape,
    car_wing_color = p_wing_color,
    car_livery = p_livery,
    car_livery_pattern = p_livery_pattern,
    car_lights_color = p_lights_color
  where id = v_uid;
end;
$$;

grant execute on function public.save_loadout(text, text, text, text, text, text, text) to authenticated;

-- Comprobación: 3 chasis en catálogo y la columna creada.
select category, count(*) from public.catalog_pieces group by category order by category;
