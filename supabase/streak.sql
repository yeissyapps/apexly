-- ============================================================================
--  Circuito Diario — Racha (v0.5)
--
--  Pégalo en Supabase > SQL Editor > Run (después de schema.sql).
--  Añade la racha de días seguidos a la tabla de usuarios. Se actualiza desde
--  el cliente al terminar el primer intento del día (RLS: cada uno la suya).
-- ============================================================================

alter table public.users add column if not exists current_streak int  not null default 0;
alter table public.users add column if not exists longest_streak int  not null default 0;
alter table public.users add column if not exists last_played    date;
