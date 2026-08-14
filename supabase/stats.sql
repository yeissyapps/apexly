-- ============================================================================
--  Stats de jugador — contadores de por vida para el Perfil.
--
--  Por qué una tabla nueva y no calcularlo de `attempts`: `attempts` solo
--  guarda UNA fila por (usuario, día) con tu MEJOR tiempo, así que no sabe
--  cuántas vueltas diste, cuánto te chocaste ni cuánto tiempo estuviste en
--  pista. Eso son datos de la vuelta, no del día, y se perdían al terminar.
--
--  Estos números son ESTÉTICOS (perfil/presumir), no entran en el ranking,
--  así que se aceptan tal y como los manda el cliente — mismo nivel de
--  confianza que los splits de sector. Lo que SÍ decide el ranking
--  (`attempts.best_ms`) sigue con su propia validación aparte.
--
--  Pégalo entero en Supabase > SQL Editor > New query > Run.
-- ============================================================================

create table if not exists public.player_stats (
  user_id    uuid primary key references public.users (id) on delete cascade,
  laps       integer not null default 0 check (laps >= 0),
  crashes    integer not null default 0 check (crashes >= 0),
  race_ms    bigint  not null default 0 check (race_ms >= 0),
  best_ms    integer,
  updated_at timestamptz not null default now()
);

alter table public.player_stats enable row level security;

-- Lectura pública: hace falta para poder enseñar stats de otros jugadores más
-- adelante (perfil de un rival desde el ranking). Hoy solo se lee el propio.
drop policy if exists player_stats_select_all on public.player_stats;
create policy player_stats_select_all on public.player_stats
  for select to authenticated using (true);

-- Sin policies de insert/update: se escribe SOLO por la función de abajo, para
-- que nadie pueda ponerse los contadores a mano con un update directo.
create or replace function public.record_lap(p_ms integer, p_crashes integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ms  integer := greatest(0, coalesce(p_ms, 0));
  v_cr  integer := greatest(0, coalesce(p_crashes, 0));
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- Tope de cordura: una vuelta de más de 10 minutos es un dato roto (app en
  -- segundo plano, reloj del móvil cambiado...), no una vuelta lenta. Se
  -- cuenta la vuelta pero sin envenenar el tiempo total acumulado.
  if v_ms > 600000 then
    v_ms := 0;
  end if;

  insert into public.player_stats (user_id, laps, crashes, race_ms, best_ms)
  values (v_uid, 1, v_cr, v_ms, nullif(v_ms, 0))
  on conflict (user_id) do update set
    laps       = player_stats.laps + 1,
    crashes    = player_stats.crashes + v_cr,
    race_ms    = player_stats.race_ms + v_ms,
    best_ms    = case
                   when v_ms = 0 then player_stats.best_ms
                   when player_stats.best_ms is null then v_ms
                   else least(player_stats.best_ms, v_ms)
                 end,
    updated_at = now();
end;
$$;

grant execute on function public.record_lap(integer, integer) to authenticated;
