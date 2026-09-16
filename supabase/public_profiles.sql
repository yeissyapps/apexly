-- ============================================================================
--  Perfiles públicos — JC, 2026-09-15: "quiero que se pueda entrar en el
--  perfil de cada jugador y que sea público su avatar y sus stats".
--
--  player_stats ya era de lectura pública desde el principio (stats.sql lo
--  dice explícito: "para poder enseñar stats de otros jugadores más
--  adelante"). Lo que faltaba: career_progress e inventory, que nacieron
--  con policies de "solo tú" porque entonces no había pantalla que
--  enseñara nada de otro jugador. wallet/wallet_transactions se QUEDAN
--  privados a propósito — las monedas no forman parte del perfil público.
--
--  Pégalo en Supabase > SQL Editor > Run.
-- ============================================================================

drop policy if exists career_progress_select_self on public.career_progress;
drop policy if exists career_progress_select_all on public.career_progress;
create policy career_progress_select_all on public.career_progress
  for select to authenticated using (true);

drop policy if exists inventory_select_self on public.inventory;
drop policy if exists inventory_select_all on public.inventory;
create policy inventory_select_all on public.inventory
  for select to authenticated using (true);
