-- ============================================================================
--  PALETA NUEVA — catálogo de colores rehecho.
--
--  Los 8 libres pasan a ser colores nacionales de competición (rosso corsa,
--  verde británico, azul Francia...) en vez de primarios genéricos, y los 12
--  premium cambian de tono. Eso significa que CAMBIAN LOS HEX.
--
--  POR QUÉ ESTE ARCHIVO HACE MÁS QUE UN UPDATE DEL CATÁLOGO: si solo se
--  cambian los colores y NO se resetea lo que la gente lleva equipado, todo
--  el que tuviera un color viejo se queda con un hex que ya no está en el
--  catálogo. Y como el garaje manda el loadout ENTERO en cada toque,
--  save_loadout rechaza la operación completa: esa persona no puede volver a
--  guardar NADA del garaje. Es exactamente el bug que dejó atascados a 41 de
--  51 usuarios con '#0f1218' (ver supabase/fix_wing_color.sql).
--
--  Se aprovecha para vaciar `inventory`, como decidimos: estando en prueba
--  cerrada y con casi nadie coleccionando, es el único momento en que
--  rehacer el catálogo sale gratis.
--
--  Pégalo entero en Supabase > SQL Editor > New query > Run.
-- ============================================================================

-- 1) Fuera el catálogo de colores viejo y dentro el nuevo. Solo 'color': los
--    chasis, alerones, libreas y marcos no cambian de id aquí.
delete from public.catalog_pieces where category = 'color';

insert into public.catalog_pieces (category, piece_id, rarity, hex) values
  -- rara · metalizado
  ('color', 'azul_metalizado',    'rara',       '#3a6ea5'),
  ('color', 'verde_metalizado',   'rara',       '#3f7a52'),
  ('color', 'burdeos_metalizado', 'rara',       '#7a2038'),
  ('color', 'arena_metalizado',   'rara',       '#a8894f'),
  -- épica · cromado
  ('color', 'oro',                'epica',      '#d4af37'),
  ('color', 'plata',              'epica',      '#c0c0c0'),
  ('color', 'cobre',              'epica',      '#b06a3b'),
  ('color', 'acero',              'epica',      '#5b5f66'),
  -- legendaria · holográfico
  ('color', 'holo_arcoiris',      'legendaria', '#ff5c8a'),
  ('color', 'holo_aurora',        'legendaria', '#5ce87a'),
  ('color', 'holo_laguna',        'legendaria', '#ff6fa8'),
  ('color', 'holo_magma',         'legendaria', '#ffb84d');

-- 2) Inventario a cero (decisión tomada: catálogo nuevo, borrón y cuenta
--    nueva). Sin esto quedarían filas apuntando a piece_id que ya no existen.
delete from public.inventory;

-- 3) RESETEAR LO EQUIPADO. Esta es la parte que evita el bug descrito arriba:
--    nadie puede quedarse con un hex que ya no existe.
update public.users set
  car_body_color   = '#f5c518',  -- amarillo nuevo (= CAR_DEFAULTS.bodyColor)
  car_wing_color   = '#17171a',  -- negro nuevo    (= CAR_DEFAULTS.wingColor)
  car_livery       = null,
  car_livery_pattern = 'simple',
  car_wing_shape   = 'sin_aleron',
  car_chassis      = 'gt',
  car_frame        = 'sin_marco';

-- 4) save_loadout con la lista de colores libres NUEVA. Es la misma función
--    de frames.sql; solo cambia v_free_colors. Si esta lista se separa de la
--    de src/car.js, el jugador ve colores que no puede equipar — hay un
--    comprobador que lo detecta: node tools/check-catalog.mjs
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
  v_free_colors text[] := array['#f0eee8','#17171a','#6e737a','#d32b1e','#1f5c3a','#2b5fb8','#f5c518','#e8611a'];
  v_free_lights text[] := array['#fff6cf','#ffb84d'];
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;

  if not (p_chassis = 'gt' or exists(
    select 1 from public.inventory
    where user_id = v_uid and category = 'chassis' and piece_id = p_chassis
  )) then raise exception 'PIECE_NOT_OWNED: chassis'; end if;

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

-- Comprobación: 25 sorteables, 12 de ellos colores, e inventario a 0.
select category, count(*) from public.catalog_pieces group by category order by category;
select count(*) as piezas_en_inventario from public.inventory;
