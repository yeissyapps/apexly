-- ============================================================================
--  submit_lap — tiempo del día + traza en UNA llamada, con la traza revisada
--  en el servidor (auditoría, 2026-10-05).
--
--  Hasta ahora submit_time aceptaba cualquier número entre 5 y 600 s, y la
--  traza iba aparte (submit_daily_run) y solo si mejorabas. La clave anon va
--  dentro de la app, así que cualquiera podía mandar un tiempo sin conducir.
--
--  submit_lap exige la traza de la vuelta y comprueba que es físicamente
--  posible: que empieza en la salida, que su última muestra coincide con el
--  tiempo, que el reloj no va hacia atrás, que el coche no se teletransporta
--  ni supera la velocidad máxima del juego (MAX_SPEED = 250 u/s en
--  src/config.js; se tolera hasta 400 por muestra y 260 de media, porque los
--  rebotes contra el muro y el viento empujan). No demuestra que la vuelta
--  siga el trazado — eso exigiría resimular en el servidor —, pero ya no basta
--  con mandar un número: hay que fabricar 700 puntos coherentes.
--
--  MODO VIGILANCIA (v_enforce = false): una traza que no cuadra NO se
--  rechaza; el tiempo entra igual y queda apuntada en `lap_flags`. Rechazar
--  vueltas buenas por un umbral mal calibrado sería mucho peor que dejar
--  pasar una trampa unos días. Cuando `lap_flags` lleve un tiempo sin
--  falsos positivos de jugadores legítimos, cambia v_enforce a true y vuelve
--  a correr este archivo. Para revisar:
--    select f.*, u.nickname from public.lap_flags f
--    join public.users u on u.id = f.user_id order by f.created_at desc;
--
--  submit_time se queda para las versiones viejas. Cuando min_build obligue
--  a todos a esta versión, ciérralo:
--    revoke execute on function public.submit_time(date, int) from authenticated;
--
--  Pégalo en Supabase > SQL Editor > Run.
-- ============================================================================

create table if not exists public.lap_flags (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.users (id) on delete cascade,
  day        date not null,
  ms         int not null,
  reason     text not null,
  created_at timestamptz not null default now()
);
alter table public.lap_flags enable row level security; -- sin policies: solo servidor

-- null si la traza es coherente con `p_ms`; si no, el motivo.
-- Muestra: [t_ms, x, y, heading], como la graba src/Game.js.
create or replace function public.lap_trace_problem(p_ms int, p_trace jsonb)
returns text
language plpgsql
immutable
as $$
declare
  n       int;
  e       jsonb;
  t numeric; x numeric; y numeric;
  pt numeric; px numeric; py numeric;
  first_t numeric;
  dt numeric; d numeric;
  total   numeric := 0;
begin
  if p_trace is null or jsonb_typeof(p_trace) <> 'array' then return 'NO_TRACE'; end if;
  n := jsonb_array_length(p_trace);
  if n > 3000 then return 'TRACE_TOO_LARGE'; end if;
  -- Se graba una muestra cada ~50 ms (el cliente reduce a 3000 como mucho).
  if n < least(p_ms / 250, 2000) then return 'TOO_FEW_SAMPLES'; end if;

  for e in select value from jsonb_array_elements(p_trace) loop
    -- Comprobación de tipo ANTES de convertir (sin bloque de excepción: uno
    -- por muestra serían ~800 subtransacciones por vuelta).
    if jsonb_typeof(e) <> 'array'
       or coalesce(jsonb_typeof(e -> 0), '') <> 'number'
       or coalesce(jsonb_typeof(e -> 1), '') <> 'number'
       or coalesce(jsonb_typeof(e -> 2), '') <> 'number' then
      return 'BAD_SAMPLE';
    end if;
    t := (e ->> 0)::numeric; x := (e ->> 1)::numeric; y := (e ->> 2)::numeric;
    if pt is null then
      first_t := t;
    else
      dt := t - pt;
      d := sqrt(power(x - px, 2) + power(y - py, 2));
      if dt < 0 then return 'TIME_BACKWARDS'; end if;
      if dt = 0 then
        if d > 5 then return 'TELEPORT'; end if;
      elsif d * 1000 / dt > 400 then
        return 'TOO_FAST_SAMPLE';
      end if;
      total := total + d;
    end if;
    pt := t; px := x; py := y;
  end loop;

  if first_t > 1000 then return 'LATE_START'; end if;
  if abs(pt - p_ms) > 60 then return 'END_MISMATCH'; end if;
  if total * 1000 / p_ms > 260 then return 'TOO_FAST_AVG'; end if;
  return null;
end;
$$;

create or replace function public.submit_lap(p_day date, p_ms int, p_trace jsonb)
returns table (is_best boolean, best_ms int, prev_ms int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enforce boolean := false; -- ver MODO VIGILANCIA en la cabecera
  v_uid     uuid := auth.uid();
  v_prev    int;
  v_today   date := (now() at time zone 'utc')::date;
  v_problem text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  -- Mismos límites que submit_time.
  if p_day < v_today - 1 or p_day > v_today + 1 then raise exception 'DAY_OUT_OF_RANGE'; end if;
  if p_ms < 5000 or p_ms > 600000 then raise exception 'MS_OUT_OF_RANGE'; end if;

  v_problem := public.lap_trace_problem(p_ms, p_trace);
  if v_problem is not null then
    if v_enforce then raise exception 'BAD_TRACE:%', v_problem; end if;
    insert into public.lap_flags (user_id, day, ms, reason) values (v_uid, p_day, p_ms, v_problem);
  end if;

  select a.best_ms into v_prev from public.attempts a where a.user_id = v_uid and a.day = p_day;
  if v_prev is not null and v_prev <= p_ms then
    return query select false, v_prev, v_prev;
    return;
  end if;

  insert into public.attempts (user_id, day, best_ms, updated_at)
  values (v_uid, p_day, p_ms, now())
  on conflict (user_id, day) do update set best_ms = excluded.best_ms, updated_at = now();

  -- La traza del mejor tiempo, para el coche del líder (antes submit_daily_run,
  -- en otra llamada que podía fallar sola y dejar tiempo sin traza).
  if v_problem is null or v_problem not in ('NO_TRACE', 'TRACE_TOO_LARGE', 'BAD_SAMPLE') then
    insert into public.daily_runs (day, user_id, ms, trace)
    values (p_day::text, v_uid, p_ms, p_trace)
    on conflict (day, user_id) do update
      set ms = excluded.ms, trace = excluded.trace, updated_at = now()
      where public.daily_runs.ms > excluded.ms;
  end if;

  return query select true, p_ms, v_prev;
end;
$$;

revoke all on function public.submit_lap(date, int, jsonb) from public;
grant execute on function public.submit_lap(date, int, jsonb) to authenticated;
