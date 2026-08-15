-- ============================================================================
--  PIEZAS NUEVAS — alerones, libreas y faros rehechos.
--
--  Cierra la lista que quedaba pendiente del catálogo (los chasis y la paleta
--  ya se hicieron: ver chassis.sql y palette_v2.sql).
--
--  QUÉ CAMBIA
--   · ALERONES: fuera 'barrido' y 'cola_de_pato'; entran 'labio' y 'biplano'.
--     'cuello_cisne' sube de rara a épica. Los cuatro de antes eran el mismo
--     rectángulo detrás del coche con dos milímetros de diferencia: en el
--     garaje se notaba, en pista no.
--   · LIBREAS: fuera 'diagonal'; entran 'flecha' (galón) y 'damero'.
--     'numero' baja de legendaria a épica. Son 4 sorteables en vez de 3.
--   · FAROS: pasan a ser piezas de verdad. Antes había un 'multicolor'
--     marcado como bloqueado que NO estaba en esta tabla: no salía en ningún
--     sobre, o sea una pieza imposible que había que excluir a mano del
--     recuento. Ahora hay dos libres (blanco, ámbar) y dos sorteables
--     (xenón, láser), y por eso aparece la categoría 'light'.
--
--  POR QUÉ RESETEA LO EQUIPADO: si se cambian los ids y NO se resetea, quien
--  llevara 'cola_de_pato' se queda con un valor que ya no está en el
--  catálogo. Y como el garaje manda el loadout ENTERO en cada toque,
--  save_loadout rechaza la operación completa: esa persona no puede volver a
--  guardar NADA. Es el bug que dejó atascados a 41 de 51 usuarios
--  (ver fix_wing_color.sql) y que ya volvió a asomar con los colores.
--
--  El inventario se vacía otra vez, como en palette_v2: estando en prueba
--  cerrada es el único momento en que rehacer el catálogo sale gratis.
--
--  Pégalo entero en Supabase > SQL Editor > New query > Run.
-- ============================================================================

-- 1) Catálogo sorteable de estas tres categorías, de cero.
delete from public.catalog_pieces where category in ('wing', 'livery', 'light');

insert into public.catalog_pieces (category, piece_id, rarity, hex) values
  -- Alerones: de discreto a bestia, que es lo que hace que subir de rareza
  -- se note desde la pista.
  ('wing',   'labio',        'rara',       null),
  ('wing',   'gt',           'rara',       null),
  ('wing',   'cuello_cisne', 'epica',      null),
  ('wing',   'biplano',      'legendaria', null),
  -- Libreas: las dos de arriba son las que NO se parecen a una raya.
  ('livery', 'doble',        'rara',       null),
  ('livery', 'flecha',       'rara',       null),
  ('livery', 'numero',       'epica',      null),
  ('livery', 'damero',       'legendaria', null),
  -- Faros: mismo mecanismo que los colores de carrocería, el hex es el valor
  -- que se guarda en users.car_lights_color (no hace falta columna nueva).
  ('light',  'xenon',        'rara',       '#a8d8ff'),
  ('light',  'laser',        'epica',      '#c9a2ff');

-- 2) Inventario a cero (decisión ya tomada con la paleta): si no, quedarían
--    filas apuntando a piece_id que ya no existen.
delete from public.inventory;

-- 3) RESETEAR LO EQUIPADO. Esta es la parte que evita el bug de arriba.
--    Los colores de carrocería NO se tocan: siguen siendo los de palette_v2.
update public.users set
  car_wing_shape     = 'sin_aleron',
  car_livery_pattern = 'simple',
  car_lights_color   = '#f4f1e4';  -- blanco nuevo (= CAR_DEFAULTS.lightsColor)

-- 4) save_loadout con las listas nuevas. Cambian dos cosas respecto a
--    palette_v2: los faros libres (el blanco cambia de hex) y, sobre todo,
--    que un faro NO libre ahora se valida contra el inventario — antes
--    cualquier faro fuera de la lista se rechazaba sin más, porque no había
--    faros que se pudieran ganar.
--
--    Si estas listas se separan de las de src/car.js, el jugador ve piezas
--    que no puede equipar. Lo detecta: node tools/check-catalog.mjs
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
  v_free_lights text[] := array['#f4f1e4','#ffb347'];
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

  -- Faros: libre, o ganado. Mismo patrón que los colores de carrocería —
  -- se localiza la pieza por su hex en catalog_pieces.
  if not (p_lights_color = any(v_free_lights) or exists(
    select 1 from public.catalog_pieces cp
    join public.inventory i on i.category = cp.category and i.piece_id = cp.piece_id
    where cp.category = 'light' and cp.hex = p_lights_color and i.user_id = v_uid
  )) then raise exception 'PIECE_NOT_OWNED: lights_color'; end if;

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

-- Comprobación. Debe salir: chassis 3, color 12, frame 3, light 2, livery 4,
-- wing 4  =  28 sorteables (= TOTAL_PIECES en src/car.js), inventario a 0, y
-- ningún usuario con una pieza equipada que ya no exista.
select category, count(*) from public.catalog_pieces group by category order by category;
select count(*) as total_sorteable from public.catalog_pieces;
select count(*) as piezas_en_inventario from public.inventory;
select count(*) as usuarios_atascados from public.users
 where car_wing_shape not in ('sin_aleron','labio','gt','cuello_cisne','biplano')
    or car_livery_pattern not in ('simple','doble','flecha','numero','damero')
    or car_lights_color not in ('#f4f1e4','#ffb347','#a8d8ff','#c9a2ff');
