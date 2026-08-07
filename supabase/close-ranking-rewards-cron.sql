-- ============================================================================
--  Tarea programada: lanza la Edge Function `close-ranking-rewards` cada día
--  a las 02:00 UTC — bien pasada la medianoche de España tanto en CET como
--  en CEST, para minimizar jugadores cuyo último intento de "ayer" aún no
--  haya llegado cuando se cierra el día. attempts.day se guarda en fecha
--  LOCAL del dispositivo (todayKey()), no UTC — mismo desfase ya aceptado en
--  daily-reminder-cron.sql, aquí con más margen horario a propósito porque
--  esta vez el cierre reparte monedas, no solo un aviso.
--
--  OJO horario: a diferencia de daily-reminder (que si se dispara "tarde" en
--  la franja solo cambia CUÁNDO llega un push), aquí la hora exacta no
--  afecta a la corrección — el cron cierra "el día de ayer en UTC" venga
--  cuando venga disparado, la idempotencia real está en el índice único
--  dentro de credit_wallet. No hace falta tocar esto en el cambio de hora
--  de España; se deja en UTC fijo adrede.
--
--  Pégalo entero en Supabase > SQL Editor > New query > Run, DESPUÉS de
--  desplegar la función (`supabase functions deploy close-ranking-rewards`).
-- ============================================================================

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'close-ranking-rewards',
  '0 2 * * *', -- 02:00 UTC
  $$
  select net.http_post(
    url := 'https://qmdgbdgezlcoydmsimal.supabase.co/functions/v1/close-ranking-rewards',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtZGdiZGdlemxjb3lkbXNpbWFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxNzEyOTYsImV4cCI6MjA5OTc0NzI5Nn0.SIlNpwGyZS4WqOXHKh46j3ypylm9n84-wuTpAaczyPo'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Para comprobar que quedó programada:
--   select * from cron.job where jobname = 'close-ranking-rewards';
-- Para reprogramar:
--   select cron.unschedule('close-ranking-rewards');
--   -- y vuelve a correr el select cron.schedule(...) de arriba con la hora nueva.
