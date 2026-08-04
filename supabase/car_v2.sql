-- ============================================================================
--  Circuito Diario — Catálogo v2 del garaje (alerón/librea nuevos)
--
--  Pégalo en Supabase > SQL Editor > Run (después de car.sql).
--
--  1) car_wing_shape pasa a tener DEFAULT 'sin_aleron' en vez de
--     'cuello_cisne': cuello_cisne ahora es pieza premium (bloqueada), y
--     nadie ha tenido forma real de "ganársela" todavía. Se resetean TAMBIÉN
--     las filas ya existentes (todos los jugadores empiezan con el coche
--     básico, decisión explícita — nadie se queda con una pieza premium
--     gratis por haber jugado antes de que existiera el desbloqueo).
--  2) car_livery_pattern es columna nueva: el patrón de la franja ahora se
--     guarda aparte de su color (car_livery). Default 'simple' = el único
--     patrón libre, mismo aspecto que tenía la librea hasta ahora.
-- ============================================================================

alter table public.users alter column car_wing_shape set default 'sin_aleron';
update public.users set car_wing_shape = 'sin_aleron';

alter table public.users add column if not exists car_livery_pattern text not null default 'simple';
