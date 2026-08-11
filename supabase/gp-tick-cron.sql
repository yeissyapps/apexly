-- ============================================================================
--  Tarea programada: lanza la Edge Function `gp-tick` cada 15 minutos.
--
--  A diferencia de daily-reminder/close-ranking-rewards (una vez al día, hora
--  fija UTC), un Grand Prix arranca a la hora que decida cada grupo — así que
--  hace falta comprobar con frecuencia si a alguno le toca abrir ronda, avisar
--  de última llamada o cerrar. La idempotencia real vive en gp_notify_log
--  (índice único), así que da igual que el intervalo se solape con la
--  duración de una ejecución.
--
--  Pégalo entero en Supabase > SQL Editor > New query > Run, DESPUÉS de haber
--  desplegado la función (`supabase functions deploy gp-tick`).
-- ============================================================================

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'gp-tick',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://qmdgbdgezlcoydmsimal.supabase.co/functions/v1/gp-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtZGdiZGdlemxjb3lkbXNpbWFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxNzEyOTYsImV4cCI6MjA5OTc0NzI5Nn0.SIlNpwGyZS4WqOXHKh46j3ypylm9n84-wuTpAaczyPo'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Para comprobar que quedó programada:
--   select * from cron.job where jobname = 'gp-tick';
-- Para desactivarla:
--   select cron.unschedule('gp-tick');
