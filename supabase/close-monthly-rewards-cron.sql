-- ============================================================================
--  Tarea programada: lanza la Edge Function `close-monthly-rewards` el día 1
--  de cada mes a las 02:30 UTC — después de close-ranking-rewards (02:00
--  UTC), que ya cierra el último día del mes anterior; así el último día
--  cuenta también en el reparto de puntos mensual antes de que se calcule.
--
--  Igual que close-ranking-rewards: la hora exacta no afecta a la
--  corrección (cierra "el mes anterior en UTC" venga cuando venga
--  disparado), la idempotencia real está en el índice único dentro de
--  credit_wallet (reason='monthly'). No hace falta tocar esto en el cambio
--  de hora de España.
--
--  Pégalo entero en Supabase > SQL Editor > New query > Run, DESPUÉS de
--  desplegar la función (`supabase functions deploy close-monthly-rewards`)
--  y de correr monthly_reward.sql.
-- ============================================================================

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'close-monthly-rewards',
  '30 2 1 * *', -- 02:30 UTC, día 1 de cada mes
  $$
  select net.http_post(
    url := 'https://qmdgbdgezlcoydmsimal.supabase.co/functions/v1/close-monthly-rewards',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtZGdiZGdlemxjb3lkbXNpbWFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxNzEyOTYsImV4cCI6MjA5OTc0NzI5Nn0.SIlNpwGyZS4WqOXHKh46j3ypylm9n84-wuTpAaczyPo'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Para comprobar que quedó programada:
--   select * from cron.job where jobname = 'close-monthly-rewards';
-- Para reprogramar:
--   select cron.unschedule('close-monthly-rewards');
--   -- y vuelve a correr el select cron.schedule(...) de arriba con la hora nueva.
-- Para probarla ya, sin esperar al día 1:
--   select net.http_post(url := 'https://qmdgbdgezlcoydmsimal.supabase.co/functions/v1/close-monthly-rewards', headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtZGdiZGdlemxjb3lkbXNpbWFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxNzEyOTYsImV4cCI6MjA5OTc0NzI5Nn0.SIlNpwGyZS4WqOXHKh46j3ypylm9n84-wuTpAaczyPo'), body := '{}'::jsonb);
