-- ============================================================================
--  Tarea programada: lanza la Edge Function `daily-reminder` cada día a las
--  ~20:00 hora de España (verano, CEST = UTC+2 -> 18:00 UTC).
--
--  SUSTITUIDO por daily-reminder-dst.sql (2026-10-05), que programa 18:00 y
--  19:00 UTC y deja que la función elija la que cae en las 20:00 de Madrid —
--  ya no hay que reprogramar nada con el cambio de hora.
--
--  Pégalo entero en Supabase > SQL Editor > New query > Run, DESPUÉS de haber
--  desplegado la función (`supabase functions deploy daily-reminder`).
-- ============================================================================

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'daily-reminder',
  '0 18 * * *', -- 20:00 España (verano/CEST) = 18:00 UTC
  $$
  select net.http_post(
    url := 'https://qmdgbdgezlcoydmsimal.supabase.co/functions/v1/daily-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtZGdiZGdlemxjb3lkbXNpbWFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxNzEyOTYsImV4cCI6MjA5OTc0NzI5Nn0.SIlNpwGyZS4WqOXHKh46j3ypylm9n84-wuTpAaczyPo'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Para comprobar que quedó programada:
--   select * from cron.job where jobname = 'daily-reminder';
-- Para cambiar la hora más adelante (p. ej. al entrar el horario de invierno):
--   select cron.unschedule('daily-reminder');
--   -- y vuelve a correr el select cron.schedule(...) de arriba con la hora nueva.
