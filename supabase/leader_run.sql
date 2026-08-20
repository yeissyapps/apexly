-- ============================================================================
--  Vuelta del líder — traza de la mejor vuelta del día de cada jugador, para
--  poder dibujar EN CARRERA el coche de quien va 1.º hoy (con su livery real
--  y a opacidad completa, como si compartierais circuito).
--
--  Tu propio fantasma NO vive aquí: ese sigue siendo local (AsyncStorage, ver
--  src/ghost.js) y no cambia. Esta tabla es solo para que los demás puedan
--  verte a TI cuando eres el líder.
--
--  Una fila por jugador y día: se sobrescribe solo cuando mejoras tu marca,
--  el mismo criterio que `attempts` (mejor-de-N). La traza va como jsonb
--  ([[t,x,y,h], ...] ya redondeado en cliente, ~800 muestras en una vuelta de
--  40s).
--
--  Mismo patrón que economy.sql / career.sql: RLS de SELECT para todos los
--  autenticados (el líder del día es información pública del ranking, igual
--  que su tiempo), ESCRITURA SOLO por RPC.
--
--  Pégalo en Supabase > SQL Editor > Run.
-- ============================================================================

create table if not exists public.daily_runs (
  day        text not null,
  user_id    uuid not null references public.users (id) on delete cascade,
  ms         integer not null check (ms > 0),
  trace      jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (day, user_id)
);

-- El único acceso real es "dame la vuelta del líder de hoy" = ordenar por ms
-- dentro de un día.
create index if not exists daily_runs_day_ms on public.daily_runs (day, ms);

alter table public.daily_runs enable row level security;

-- Lectura abierta a autenticados: para dibujar al líder hace falta su traza,
-- y su tiempo ya es público en el ranking. No hay nada privado en una traza
-- (son coordenadas dentro del circuito del día).
drop policy if exists daily_runs_select_all on public.daily_runs;
create policy daily_runs_select_all on public.daily_runs
  for select to authenticated using (true);

-- Guarda tu traza SOLO si mejora la que ya tenías ese día (o si no había).
-- Sin policies de insert/update: se entra únicamente por aquí.
create or replace function public.submit_daily_run(p_day text, p_ms int, p_trace jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  -- Tope de tamaño: una vuelta legítima ronda las 800 muestras. Sin esto,
  -- cualquiera podría empujar un jsonb enorme y comerse la cuota.
  if jsonb_array_length(p_trace) > 3000 then
    raise exception 'TRACE_TOO_LARGE';
  end if;

  insert into public.daily_runs (day, user_id, ms, trace)
  values (p_day, auth.uid(), p_ms, p_trace)
  on conflict (day, user_id) do update
    set ms = excluded.ms,
        trace = excluded.trace,
        updated_at = now()
    where public.daily_runs.ms > excluded.ms;
end;
$$;

revoke all on function public.submit_daily_run(text, int, jsonb) from public;
grant execute on function public.submit_daily_run(text, int, jsonb) to authenticated;
