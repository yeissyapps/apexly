-- ============================================================================
--  DEV ONLY — LIMPIEZA. Estas dos funciones (dev_advance_streak_day,
--  dev_grant_coins) se usaron durante el desarrollo para probar la racha de
--  7 días y comprar sobres sin esperar días reales entre partidas. Estaban
--  con `grant execute ... to authenticated`, así que CUALQUIER jugador podía
--  llamarlas directamente (sin pasar por la UI ni por el flag DEV_WEATHER en
--  App.js) para regalarse monedas en bucle o falsear su racha — un agujero
--  real de integridad de la economía si llegaban a producción con jugadores
--  reales, algo que ya estaba avisado en la versión anterior de este
--  archivo y se quedó pendiente.
--
--  Pégalo en Supabase > SQL Editor > Run ANTES de publicar en producción.
-- ============================================================================

drop function if exists public.dev_advance_streak_day();
drop function if exists public.dev_grant_coins(int);
