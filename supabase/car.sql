-- ============================================================================
--  Circuito Diario — Personalización del coche (garaje)
--
--  Pégalo en Supabase > SQL Editor > Run (después de schema.sql).
--  Guarda el "loadout" elegido por cada usuario. Cubierto por las policies de
--  RLS que ya existen en users (users_select_all / users_update_self) — no
--  hace falta crear políticas nuevas.
-- ============================================================================

alter table public.users add column if not exists car_body_color   text not null default '#ffd23f';
alter table public.users add column if not exists car_wing_shape   text not null default 'cuello_cisne';
alter table public.users add column if not exists car_wing_color   text not null default '#0f1218';
alter table public.users add column if not exists car_livery       text;
alter table public.users add column if not exists car_lights_color text not null default '#fff6cf';
