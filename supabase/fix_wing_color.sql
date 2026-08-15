-- ============================================================================
--  ARREGLO: el color de alerón por defecto no existía en el catálogo.
--
--  QUÉ PASABA: CAR_DEFAULTS.wingColor era '#0f1218' (el negro del splitter,
--  tomado prestado), pero ese hex NO está en CAR_COLORS ni en la lista de
--  colores libres de save_loadout. Como el garaje manda SIEMPRE el loadout
--  entero en cada toque, la validación del servidor lo rechazaba con
--  'PIECE_NOT_OWNED: wing_color' y NADA se guardaba: ni el color, ni el
--  alerón, ni la librea, ni el chasis.
--
--  POR QUÉ NADIE LO VIO: Garage.apply() hacía `saveLoadout(next).catch(() => {})`,
--  así que la app pintaba el cambio como si hubiera funcionado. Detectado con
--  41 de 51 usuarios atascados (todos los que nunca tocaron el color del
--  alerón, que es lo normal).
--
--  El cliente ya usa '#1a1a1c' (negro, libre y en catálogo) como valor por
--  defecto. Esto arregla a los que ya tienen el valor fantasma guardado.
--
--  Pégalo en Supabase > SQL Editor > Run.
-- ============================================================================

update public.users
   set car_wing_color = '#1a1a1c'
 where car_wing_color = '#0f1218';

-- Comprobación: debe devolver 0 filas.
select count(*) as todavia_atascados
  from public.users
 where car_wing_color = '#0f1218';
