-- ============================================================================
--  Modo Carrera — progreso del jugador en la escalera de 10 niveles. El
--  circuito de cada nivel NO se guarda aquí: se genera en el cliente con el
--  mismo motor determinista del circuito diario (semilla 'career-N'), así
--  que solo hace falta persistir hasta dónde has llegado.
--
--  Mismo patrón que economy.sql: RLS select-self, ESCRITURA SOLO vía RPC
--  (sin policies de insert/update).
--
--  Pégalo en Supabase > SQL Editor > Run.
-- ============================================================================

create table if not exists public.career_progress (
  user_id    uuid primary key references public.users (id) on delete cascade,
  cleared    int not null default 0 check (cleared >= 0),
  updated_at timestamptz not null default now()
);

alter table public.career_progress enable row level security;

drop policy if exists career_progress_select_self on public.career_progress;
create policy career_progress_select_self on public.career_progress
  for select to authenticated using (auth.uid() = user_id);

-- Reclama el nivel p_level como superado. Solo avanza si es EXACTAMENTE el
-- siguiente de la escalera (cleared+1) — evita que alguien reclame el nivel
-- 10 sin haber pasado por los anteriores llamando la RPC a mano. p_ms se
-- guarda solo a título informativo (no hay premio en monedas por nivel en la
-- v1, así que no hay incentivo real a falsearlo).
create or replace function public.claim_career_level(p_level int, p_ms int)
returns table(cleared int)
language plpgsql security definer set search_path = public
as $$
declare
  v_cleared int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_level is null or p_level < 1 then raise exception 'INVALID_LEVEL'; end if;

  select coalesce(c.cleared, 0) into v_cleared
  from public.career_progress c where c.user_id = auth.uid();

  if p_level <> coalesce(v_cleared, 0) + 1 then
    raise exception 'WRONG_LEVEL';
  end if;

  insert into public.career_progress (user_id, cleared) values (auth.uid(), p_level)
  on conflict (user_id) do update
    set cleared = excluded.cleared, updated_at = now()
    where career_progress.cleared < excluded.cleared;

  return query select greatest(coalesce(v_cleared, 0), p_level);
end;
$$;
grant execute on function public.claim_career_level(int, int) to authenticated;
