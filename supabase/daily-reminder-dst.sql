-- ============================================================================
--  Recordatorio diario: 20:00 de España todo el año + una sola vez al día.
--  (Auditoría, 2026-10-05.) Sustituye la programación de daily-reminder-cron.sql.
--
--  1. reminder_runs: cerrojo de "ya se mandó hoy". Solo la escribe la Edge
--     Function con service_role; RLS activado y SIN policies, así que nadie
--     más puede leerla ni escribirla.
--  2. El cron pasa de '0 18 * * *' a '0 18,19 * * *': la función decide cuál
--     de las dos llamadas cae en las 20:00 de Madrid (18 UTC en verano, 19 UTC
--     en invierno) y la otra no hace nada. Ya no hay que reprogramarlo en
--     octubre ni en marzo.
--
--  ORDEN: primero despliega la función nueva
--    npx supabase functions deploy daily-reminder
--  y después pega esto en Supabase > SQL Editor > Run.
-- ============================================================================

create table if not exists public.reminder_runs (
  day        date primary key,
  created_at timestamptz not null default now()
);
alter table public.reminder_runs enable row level security;

select cron.unschedule('daily-reminder');

select cron.schedule(
  'daily-reminder',
  '0 18,19 * * *', -- la función solo actúa en la que sea las 20:00 en Madrid
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

-- Comprobación:
--   select jobname, schedule from cron.job where jobname = 'daily-reminder';
