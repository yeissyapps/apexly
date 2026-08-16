-- ============================================================================
--  ARREGLO: los usuarios NUEVOS nacían con piezas que ya no existen.
--
--  QUÉ PASABA: palette_v2.sql y pieces_v2.sql rehicieron el catálogo y
--  resetearon lo equipado con un `update public.users set ...`. Eso arregla a
--  quien YA existía, pero no toca los DEFAULT de las columnas — que seguían
--  siendo los del esquema original ('#ffd23f', '#0f1218', '#fff6cf').
--
--  Resultado: cada cuenta creada después de una migración nacía con un color
--  que no está en el catálogo. Y como el garaje manda el loadout ENTERO en
--  cada toque, save_loadout rechazaba la operación completa: esa persona no
--  podía guardar NADA del garaje, ni siquiera un color libre.
--
--  Es EXACTAMENTE el bug que dejó atascados a 41 de 51 usuarios
--  (ver fix_wing_color.sql), reaparecido por la puerta de atrás. Comprobado
--  en caliente: de 55 filas, las 2 creadas después de palette_v2 tenían
--  '#ffd23f' / '#0f1218' y el garaje les rechazaba hasta el rosso corsa.
--
--  LECCIÓN, para la próxima migración de catálogo: resetear filas NO basta.
--  Si un valor por defecto cambia, hay que cambiarlo en los tres sitios —
--  src/car.js (CAR_DEFAULTS), el `update` de la migración, y el DEFAULT de
--  la columna. Este archivo se queda como recordatorio.
--
--  Pégalo en Supabase > SQL Editor > Run.
-- ============================================================================

-- 1) DEFAULT de columna = lo mismo que CAR_DEFAULTS en src/car.js.
alter table public.users
  alter column car_body_color     set default '#f5c518',   -- amarillo
  alter column car_wing_color     set default '#17171a',   -- negro
  alter column car_lights_color   set default '#f4f1e4',   -- blanco
  alter column car_wing_shape     set default 'sin_aleron',
  alter column car_livery_pattern set default 'simple',
  alter column car_chassis        set default 'gt',
  alter column car_frame          set default 'sin_marco';

-- 2) Rescatar a quien ya nació atascado. Se compara contra las listas libres
--    de save_loadout: cualquiera que lleve algo fuera del catálogo vuelve a
--    los valores de fábrica.
update public.users set car_body_color = '#f5c518'
 where car_body_color not in ('#f0eee8','#17171a','#6e737a','#d32b1e','#1f5c3a','#2b5fb8','#f5c518','#e8611a')
   and car_body_color not in (select hex from public.catalog_pieces where category = 'color' and hex is not null);

update public.users set car_wing_color = '#17171a'
 where car_wing_color not in ('#f0eee8','#17171a','#6e737a','#d32b1e','#1f5c3a','#2b5fb8','#f5c518','#e8611a')
   and car_wing_color not in (select hex from public.catalog_pieces where category = 'color' and hex is not null);

update public.users set car_livery = null
 where car_livery is not null
   and car_livery not in ('#f0eee8','#17171a','#6e737a','#d32b1e','#1f5c3a','#2b5fb8','#f5c518','#e8611a')
   and car_livery not in (select hex from public.catalog_pieces where category = 'color' and hex is not null);

update public.users set car_lights_color = '#f4f1e4'
 where car_lights_color not in ('#f4f1e4','#ffb347')
   and car_lights_color not in (select hex from public.catalog_pieces where category = 'light' and hex is not null);

-- 3) Comprobación: los DEFAULT nuevos, y cuánta gente sigue atascada (0).
select column_name, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'users' and column_name like 'car_%'
 order by column_name;

select count(*) as usuarios_atascados from public.users
 where car_body_color not in ('#f0eee8','#17171a','#6e737a','#d32b1e','#1f5c3a','#2b5fb8','#f5c518','#e8611a')
    or car_wing_color not in ('#f0eee8','#17171a','#6e737a','#d32b1e','#1f5c3a','#2b5fb8','#f5c518','#e8611a')
    or car_lights_color not in ('#f4f1e4','#ffb347')
    or car_wing_shape not in ('sin_aleron','labio','gt','cuello_cisne','biplano')
    or car_livery_pattern not in ('simple','doble','flecha','numero','damero');
