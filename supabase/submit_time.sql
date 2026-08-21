-- ============================================================================
--  submit_time — enviar el tiempo del día por RPC en vez de escribir la tabla.
--
--  ARREGLO A-01 de la auditoría. `attempts` era la ÚNICA tabla de tiempos que
--  el cliente escribía directamente: sus policies dejaban insert/update al
--  dueño de la fila sin validar nada, y la regla de "solo si mejora" vivía en
--  el cliente (src/api.js). Como la clave anon es pública y va dentro del APK,
--  cualquiera podía poner best_ms = 1, llevarse el marco `corona` (que
--  grant_world_crowns concede al min(best_ms) del día), cobrar el tercil alto
--  y envenenar el coche del líder.
--
--  Todo lo construido después ya seguía este patrón (submit_sector_best,
--  submit_daily_run, submit_gp_result). Esto solo termina de migrar la tabla
--  más antigua, que resultaba ser la del ranking principal.
--
--  Pégalo en Supabase > SQL Editor > Run. Es SEGURO correrlo ya: solo AÑADE
--  la función, no quita nada, así que las versiones ya instaladas siguen
--  funcionando igual. El cierre de la puerta va aparte, en lock_attempts.sql,
--  y NO se corre hasta que el force update haya vaciado las versiones viejas.
-- ============================================================================

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

  -- El día lo sigue mandando el cliente porque `attempts.day` es la fecha
  -- LOCAL del jugador (mismo criterio que el circuito del día, ver
  -- src/daily.js). Se acepta el desfase de una franja horaria y ni un día
  -- más: sin este tope se podrían rellenar días pasados a placer, que es
  -- media gracia del agujero que esto viene a cerrar.
  if p_day < v_today - 1 or p_day > v_today + 1 then
    raise exception 'DAY_OUT_OF_RANGE';
  end if;

  -- Suelo y techo de cordura. NO pretende distinguir una vuelta buena de una
  -- mala —eso no se puede hacer sin resimular la vuelta en servidor— solo
  -- corta lo físicamente imposible. Una vuelta real ronda los 40 s; 5 s es
  -- generoso de sobra para cualquier circuito corto sin dejar pasar el
  -- best_ms = 1 que convertía el ranking en papel mojado.
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

  -- prev_ms va null si era la primera vuelta del día: el cliente lo usa para
  -- el "a 0.043s de tu récord" y para saber a quién ha adelantado.
  return query select true, p_ms, v_prev;
end;
$$;

revoke all on function public.submit_time(date, int) from public;
grant execute on function public.submit_time(date, int) to authenticated;
