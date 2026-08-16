-- ============================================================================
--  Cron de la Corona mundial: concede la corona al 1.º del día anterior.
--
--  Corre a las 00:20 UTC, DESPUÉS del cierre de recompensas de ranking
--  (close-ranking-rewards, 00:10) para no pelearse con él por las mismas
--  filas de `attempts`. Como grant_world_crowns es idempotente, un solapamiento
--  tampoco haría daño — el orden es por higiene, no por corrección.
--
--  Requiere pg_cron (ya activo: lo usan daily-reminder y close-ranking-rewards).
--  Pégalo en Supabase > SQL Editor > Run, DESPUÉS de supabase/frames.sql.
-- ============================================================================

select cron.schedule(
  'grant-world-crowns',
  '20 0 * * *',
  $$ select public.grant_world_crowns(); $$
);

-- Comprobar que quedó programado:
--   select * from cron.job where jobname = 'grant-world-crowns';
--
-- Conceder la corona de un día concreto a mano (p. ej. para repartir las
-- atrasadas de días ya jugados):
--   select public.grant_world_crowns('2026-08-14');
--
-- Quitarlo:
--   select cron.unschedule('grant-world-crowns');
