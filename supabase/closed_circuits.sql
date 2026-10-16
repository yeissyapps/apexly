-- ============================================================================
--  Circuitos CERRADOS en el diario (2.4.9) — barrera del servidor.
--
--  Desde el 2026-11-01 el circuito del día es un circuito cerrado de 2
--  vueltas (src/generator.js, CLOSED_FROM). Una versión vieja de la app
--  generaría ESE MISMO DÍA la trazada de siempre, y su tiempo acabaría en el
--  mismo ranking que los del cerrado. El force update (min_build) lo evita
--  casi siempre, pero no si falla la red al comprobarlo (la app nunca se
--  bloquea por un fallo de red) ni en versiones anteriores a la 2.4.0.
--
--  La barrera: en un circuito cerrado la vuelta ACABA DONDE EMPEZÓ (la meta
--  es la salida); en una trazada la meta queda a cientos de unidades de la
--  salida (medido: >= 940 en 60 días). Desde CLOSED_FROM:
--    - submit_lap rechaza las trazas cuya última muestra quede a más de
--      CLOSED_MAX_GAP de la primera (o sin traza) -> 'UPDATE_REQUIRED';
--    - submit_time (solo lo usan versiones viejas, sin traza) se rechaza
--      siempre -> 'UPDATE_REQUIRED'.
--  Antes de esa fecha no cambia nada.
--
--  Si se cambia la fecha, cambiarla también en src/generator.js.
--
--  submit_lap y submit_time se reescriben ENTERAS (copia de
--  lap_validation.sql y submit_time.sql + la barrera). Si alguna vez se toca
--  una de ellas, partir de este archivo, no de los otros.
--
--  Pégalo en Supabase > SQL Editor > Run. Seguro de correr ya: hasta el día
--  del cambio se comporta igual que ahora.
-- ============================================================================

create or replace function public.closed_circuits_from()
returns date
language sql
immutable
as $$ select date '2026-11-01' $$;

-- ¿La traza acaba donde empezó? Muestras [t, x, y, ...].
create or replace function public.lap_trace_closes(p_trace jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  a jsonb;
  b jsonb;
begin
  if p_trace is null or jsonb_typeof(p_trace) <> 'array' or jsonb_array_length(p_trace) < 2 then
    return false;
  end if;
  a := p_trace -> 0;
  b := p_trace -> -1;
  if jsonb_typeof(a) <> 'array' or jsonb_typeof(b) <> 'array'
     or coalesce(jsonb_typeof(a -> 1), '') <> 'number' or coalesce(jsonb_typeof(a -> 2), '') <> 'number'
     or coalesce(jsonb_typeof(b -> 1), '') <> 'number' or coalesce(jsonb_typeof(b -> 2), '') <> 'number' then
    return false;
  end if;
  -- CLOSED_MAX_GAP = 250: el coche cruza la meta a menos de un ancho de
  -- pista de la salida; una trazada acaba a 940 o más.
  return sqrt(power((b ->> 1)::numeric - (a ->> 1)::numeric, 2)
            + power((b ->> 2)::numeric - (a ->> 2)::numeric, 2)) <= 250;
end;
$$;

create or replace function public.submit_lap(p_day date, p_ms int, p_trace jsonb)
returns table (is_best boolean, best_ms int, prev_ms int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enforce boolean := false; -- ver MODO VIGILANCIA en lap_validation.sql
  v_uid     uuid := auth.uid();
  v_prev    int;
  v_today   date := (now() at time zone 'utc')::date;
  v_problem text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  -- Mismos límites que submit_time.
  if p_day < v_today - 1 or p_day > v_today + 1 then raise exception 'DAY_OUT_OF_RANGE'; end if;
  if p_ms < 5000 or p_ms > 600000 then raise exception 'MS_OUT_OF_RANGE'; end if;

  -- Barrera de los circuitos cerrados (ver cabecera). Esta SÍ rechaza
  -- siempre: no es una sospecha de trampa, es otra pista.
  if p_day >= public.closed_circuits_from() and not public.lap_trace_closes(p_trace) then
    raise exception 'UPDATE_REQUIRED';
  end if;

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

grant execute on function public.submit_lap(date, int, jsonb) to authenticated;

create or replace function public.submit_time(p_day date, p_ms int)
returns table (is_best boolean, best_ms int, prev_ms int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_prev  int;
  v_today date := (now() at time zone 'utc')::date;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  -- El día lo manda el cliente (fecha LOCAL del jugador, ver src/daily.js);
  -- se acepta el desfase de una franja horaria y ni un día más.
  if p_day < v_today - 1 or p_day > v_today + 1 then
    raise exception 'DAY_OUT_OF_RANGE';
  end if;

  -- Solo lo llaman versiones viejas (sin traza), que generan la trazada:
  -- desde el día de los circuitos cerrados, nada (ver cabecera).
  if p_day >= public.closed_circuits_from() then
    raise exception 'UPDATE_REQUIRED';
  end if;

  -- Suelo y techo de cordura: solo corta lo físicamente imposible.
  if p_ms < 5000 or p_ms > 600000 then
    raise exception 'MS_OUT_OF_RANGE';
  end if;

  select a.best_ms into v_prev
    from public.attempts a
   where a.user_id = v_uid and a.day = p_day;

  -- No mejora: se devuelve el estado tal cual, sin escribir.
  if v_prev is not null and v_prev <= p_ms then
    return query select false, v_prev, v_prev;
    return;
  end if;

  insert into public.attempts (user_id, day, best_ms, updated_at)
  values (v_uid, p_day, p_ms, now())
  on conflict (user_id, day) do update
    set best_ms = excluded.best_ms,
        updated_at = now();

  return query select true, p_ms, v_prev;
end;
$$;

revoke all on function public.submit_time(date, int) from public;
grant execute on function public.submit_time(date, int) to authenticated;
