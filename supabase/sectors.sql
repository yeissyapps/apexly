-- ============================================================================
--  Sectores (mejor tiempo de sector del día, para el "morado" estilo F1).
--
--  Morado = mejor tiempo de ESE sector entre TODOS los jugadores hoy (no "más
--  rápido que el líder de la general en ese punto" — así es como funciona de
--  verdad en la F1, y de paso es mucho más barato: no hace falta la traza de
--  nadie, solo el mínimo por sector).
--
--  Solo se guarda UNA fila por (día, sector): el mejor tiempo hasta ahora. Se
--  escribe SIEMPRE a través de la función submit_sector_best (nunca por
--  insert/update directo), que solo deja pasar la escritura si de verdad
--  mejora — así un cliente no puede "hacer trampa" mandando un tiempo falso
--  más bajo sin que sea real, y no hay condición de carrera entre dos
--  jugadores acabando a la vez.
--
--  Pégalo entero en Supabase > SQL Editor > New query > Run.
-- ============================================================================

create table if not exists public.sector_bests (
  day        date not null,
  sector     smallint not null,
  ms         integer not null,
  holder_id  uuid references public.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (day, sector)
);

alter table public.sector_bests enable row level security;

drop policy if exists sector_bests_select_all on public.sector_bests;
create policy sector_bests_select_all on public.sector_bests for select to authenticated using (true);

-- Sin políticas de insert/update: la tabla solo se escribe vía la función de
-- abajo (SECURITY DEFINER), que además impone el "solo si mejora".
create or replace function public.submit_sector_best(p_day date, p_sector smallint, p_ms integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.sector_bests (day, sector, ms, holder_id, updated_at)
  values (p_day, p_sector, p_ms, auth.uid(), now())
  on conflict (day, sector) do update
    set ms = excluded.ms, holder_id = excluded.holder_id, updated_at = excluded.updated_at
    where sector_bests.ms > excluded.ms;
end;
$$;

grant execute on function public.submit_sector_best(date, smallint, integer) to authenticated;
