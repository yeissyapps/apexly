-- ============================================================================
--  gp_sector_bests — mejor tiempo de cada sector GEOGRÁFICO (0-2) de una
--  ronda del Grand Prix, entre TODOS los jugadores del grupo, en CUALQUIERA
--  de sus 3 vueltas. Mismo patrón exacto que sector_bests (ver sectors.sql):
--  una fila por (gp_id, day_index, sector) con el mejor tiempo hasta ahora,
--  escrita SOLO a través de submit_gp_sector_best (nunca insert/update
--  directo), que solo deja pasar la escritura si de verdad mejora.
--
--  Por qué hace falta esto y no basta con "tu mejor intento anterior"
--  (refSectors, ya existente): JC pidió que el morado compare "con respecto
--  al resto de vueltas de los jugadores del grupo" — no solo contigo mismo.
--
--  `sector` es el índice GEOGRÁFICO del circuito (0, 1 o 2 — el tramo, no la
--  vuelta): un intento del GP manda 9 valores (3 vueltas × 3 sectores cada
--  una), y cada uno compite por su posición (gp_id, day_index, sector) sin
--  importar de qué vuelta salió — exactamente como en la F1 real, donde el
--  sector morado de la sesión puede venir de cualquier vuelta.
--
--  Pégalo en Supabase > SQL Editor > Run (después de grandprix.sql).
-- ============================================================================

create table if not exists public.gp_sector_bests (
  gp_id      uuid not null references public.grand_prix (id) on delete cascade,
  day_index  int not null,
  sector     smallint not null,
  ms         integer not null,
  holder_id  uuid references public.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (gp_id, day_index, sector)
);

alter table public.gp_sector_bests enable row level security;

drop policy if exists gp_sector_bests_select_members on public.gp_sector_bests;
create policy gp_sector_bests_select_members on public.gp_sector_bests for select to authenticated
  using (gp_id in (select id from public.grand_prix where group_id in (select public.my_group_ids())));

-- Sin políticas de insert/update: la tabla solo se escribe vía la función de
-- abajo (SECURITY DEFINER), que además impone el "solo si mejora".
create or replace function public.submit_gp_sector_best(p_gp_id uuid, p_day_index int, p_sector smallint, p_ms integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_gp_id not in (select id from public.grand_prix where group_id in (select public.my_group_ids())) then
    raise exception 'NOT_A_MEMBER';
  end if;

  insert into public.gp_sector_bests (gp_id, day_index, sector, ms, holder_id, updated_at)
  values (p_gp_id, p_day_index, p_sector, p_ms, auth.uid(), now())
  on conflict (gp_id, day_index, sector) do update
    set ms = excluded.ms, holder_id = excluded.holder_id, updated_at = excluded.updated_at
    where gp_sector_bests.ms > excluded.ms;
end;
$$;

grant execute on function public.submit_gp_sector_best(uuid, int, smallint, integer) to authenticated;
