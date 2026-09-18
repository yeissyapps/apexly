-- ============================================================================
--  Duelos 1vs1 — reto directo entre dos jugadores con apuesta de monedas.
--
--  Nadie ve la traza del rival mientras corre (evita la ventaja injusta de
--  "esperar a ver cómo le fue al otro") — el reveal en el cliente
--  (DuelReveal.js) solo pinta los dos fantasmas juntos cuando YA están las
--  dos filas de duel_runs. La traza en sí es el MISMO formato que
--  daily_runs.trace (leader_run.sql): [[t,x,y,h], ...], así que Game.js no
--  necesita ningún cambio para capturarla — solo el destino del submit
--  cambia (submit_duel_run en vez de submit_daily_run).
--
--  Apuesta: se cobra a los DOS solo al ACEPTAR, nunca al retar (JC,
--  2026-09-17: "que retar en broma no bloquee saldo de nadie"). El bote vive
--  implícito en los dos saldos ya descontados — no hace falta una tabla de
--  escrow aparte, basta con no devolver nada hasta liquidar el duelo.
--
--  Plazos a propósito cortos (JC: "más dopamínico") — 10 min para aceptar,
--  15 min para correr una vez aceptado. supabase/duels-cron.sql se encarga
--  de expirar y devolver lo que corresponda.
--
--  Pégalo en Supabase > SQL Editor > Run (después de economy.sql, necesita
--  la tabla wallet).
-- ============================================================================

create table if not exists public.duels (
  id              uuid primary key default gen_random_uuid(),
  challenger_id   uuid not null references public.users (id) on delete cascade,
  opponent_id     uuid not null references public.users (id) on delete cascade,
  wager           integer not null check (wager > 0),
  status          text not null check (status in ('pending', 'accepted', 'declined', 'expired', 'finished')),
  created_at      timestamptz not null default now(),
  accept_deadline timestamptz not null,
  accepted_at     timestamptz,
  race_deadline   timestamptz,
  winner_id       uuid references public.users (id),
  check (challenger_id <> opponent_id)
);

-- create_duel comprueba "¿ya hay un pendiente/aceptado entre estos dos, en
-- cualquier dirección?" — este índice cubre esa consulta sin table scan.
create index if not exists duels_pair_status on public.duels (challenger_id, opponent_id, status);
create index if not exists duels_pair_status_rev on public.duels (opponent_id, challenger_id, status);

alter table public.duels enable row level security;

-- Cada uno ve solo los duelos donde participa — ni el reto en sí es visible
-- para nadie más, igual que un mensaje privado.
drop policy if exists duels_select_participants on public.duels;
create policy duels_select_participants on public.duels
  for select to authenticated using (auth.uid() in (challenger_id, opponent_id));

-- Sin policies de insert/update: todo el ciclo de vida pasa por las
-- funciones de abajo.

create table if not exists public.duel_runs (
  duel_id    uuid not null references public.duels (id) on delete cascade,
  user_id    uuid not null references public.users (id) on delete cascade,
  ms         integer not null check (ms > 0),
  trace      jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (duel_id, user_id)
);

alter table public.duel_runs enable row level security;

drop policy if exists duel_runs_select_participants on public.duel_runs;
create policy duel_runs_select_participants on public.duel_runs
  for select to authenticated using (
    exists (
      select 1 from public.duels d
      where d.id = duel_runs.duel_id
        and auth.uid() in (d.challenger_id, d.opponent_id)
    )
  );

-- wallet_transactions.reason (economy.sql, ampliado en referrals.sql /
-- share_reward.sql / gp_season_reward.sql / monthly_reward.sql) se amplía
-- otra vez para los tres motivos nuevos.
alter table public.wallet_transactions drop constraint if exists wallet_transactions_reason_check;
alter table public.wallet_transactions add constraint wallet_transactions_reason_check
  check (reason in ('streak', 'ranking', 'pack_open', 'share', 'referral', 'gp', 'monthly', 'duel_wager', 'duel_payout', 'duel_refund'));

-- ----------------------------------------------------------------------------
--  create_duel(): solo crea la fila 'pending'. Cero movimiento de dinero —
--  eso espera a accept_duel(). Bloquea un segundo reto mientras ya hay uno
--  pendiente/aceptado entre los mismos dos (en cualquier dirección), para no
--  acumular duelos duplicados si alguien pulsa RETAR varias veces.
-- ----------------------------------------------------------------------------
create or replace function public.create_duel(p_opponent_id uuid, p_wager int)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_opponent_id = auth.uid() then raise exception 'CANNOT_CHALLENGE_SELF'; end if;
  if p_wager is null or p_wager <= 0 then raise exception 'INVALID_WAGER'; end if;
  if not exists (select 1 from public.users where id = p_opponent_id) then
    raise exception 'OPPONENT_NOT_FOUND';
  end if;

  if exists (
    select 1 from public.duels
    where status in ('pending', 'accepted')
      and ((challenger_id = auth.uid() and opponent_id = p_opponent_id)
        or (challenger_id = p_opponent_id and opponent_id = auth.uid()))
  ) then
    raise exception 'DUEL_ALREADY_PENDING';
  end if;

  insert into public.duels (challenger_id, opponent_id, wager, status, accept_deadline)
  values (auth.uid(), p_opponent_id, p_wager, 'pending', now() + interval '10 minutes')
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_duel(uuid, int) from public;
grant execute on function public.create_duel(uuid, int) to authenticated;

-- ----------------------------------------------------------------------------
--  accept_duel(): el único sitio donde se cobra la apuesta. Los DOS
--  descuentos (retador + quien acepta) van en la MISMA función — si
--  cualquiera de los dos no llega a cubrir el saldo, la excepción revierte
--  la transacción entera (incluido el primer descuento, si ya se había
--  hecho), mismo idioma que open_pack() en economy.sql: UPDATE...WHERE
--  balance>=N condicional, nunca "leer saldo y luego escribir aparte".
-- ----------------------------------------------------------------------------
create or replace function public.accept_duel(p_duel_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_duel public.duels;
  v_today date := (now() at time zone 'utc')::date;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_duel from public.duels where id = p_duel_id for update;
  if not found then raise exception 'DUEL_NOT_FOUND'; end if;
  if v_duel.opponent_id <> auth.uid() then raise exception 'NOT_YOUR_DUEL'; end if;
  if v_duel.status <> 'pending' then raise exception 'DUEL_NOT_PENDING'; end if;
  if v_duel.accept_deadline < now() then raise exception 'DUEL_EXPIRED'; end if;

  update public.wallet set balance = balance - v_duel.wager, updated_at = now()
    where user_id = v_duel.challenger_id and balance >= v_duel.wager;
  if not found then raise exception 'CHALLENGER_INSUFFICIENT_FUNDS'; end if;

  update public.wallet set balance = balance - v_duel.wager, updated_at = now()
    where user_id = auth.uid() and balance >= v_duel.wager;
  if not found then raise exception 'INSUFFICIENT_FUNDS'; end if;

  insert into public.wallet_transactions (user_id, day, reason, amount) values
    (v_duel.challenger_id, v_today, 'duel_wager', -v_duel.wager),
    (auth.uid(), v_today, 'duel_wager', -v_duel.wager);

  update public.duels set
    status = 'accepted',
    accepted_at = now(),
    race_deadline = now() + interval '15 minutes'
  where id = p_duel_id;
end;
$$;

revoke all on function public.accept_duel(uuid) from public;
grant execute on function public.accept_duel(uuid) to authenticated;

-- ----------------------------------------------------------------------------
--  decline_duel(): nunca hubo dinero de por medio, así que no hay nada que
--  devolver — solo cierra el estado.
-- ----------------------------------------------------------------------------
create or replace function public.decline_duel(p_duel_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_duel public.duels;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_duel from public.duels where id = p_duel_id for update;
  if not found then raise exception 'DUEL_NOT_FOUND'; end if;
  if v_duel.opponent_id <> auth.uid() then raise exception 'NOT_YOUR_DUEL'; end if;
  if v_duel.status <> 'pending' then raise exception 'DUEL_NOT_PENDING'; end if;

  update public.duels set status = 'declined' where id = p_duel_id;
end;
$$;

revoke all on function public.decline_duel(uuid) from public;
grant execute on function public.decline_duel(uuid) to authenticated;

-- ----------------------------------------------------------------------------
--  submit_duel_run(): calcado de submit_daily_run (leader_run.sql) para la
--  parte de guardar la traza — se queda tu MEJOR intento dentro del duelo
--  (el intento extra del anuncio solo tiene sentido gracias a esto). La
--  diferencia real es lo que pasa cuando, al guardar, la fila del RIVAL YA
--  EXISTE: ese es el momento de liquidar — comparar ms, pagar el bote al
--  ganador o devolver la apuesta a los dos si empatan exacto.
--
--  `select ... for update` sobre la fila de duels serializa las llamadas
--  concurrentes de los dos jugadores para EL MISMO duelo: sin este lock,
--  si los dos terminan casi a la vez, cabe la carrera de que ninguno de los
--  dos vea todavía la fila del otro y el duelo se quede sin liquidar nunca.
--  Con el lock, quien llegue segundo SIEMPRE ve ya comprometida la fila del
--  primero.
-- ----------------------------------------------------------------------------
create or replace function public.submit_duel_run(p_duel_id uuid, p_ms int, p_trace jsonb)
returns table (duel_status text, winner_id uuid, opponent_done boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_duel        public.duels;
  v_rival_id    uuid;
  v_rival_ms    int;
  v_my_ms       int;
  v_today       date := (now() at time zone 'utc')::date;
  v_winner      uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if jsonb_array_length(p_trace) > 3000 then raise exception 'TRACE_TOO_LARGE'; end if;

  select * into v_duel from public.duels where id = p_duel_id for update;
  if not found then raise exception 'DUEL_NOT_FOUND'; end if;
  if auth.uid() not in (v_duel.challenger_id, v_duel.opponent_id) then raise exception 'NOT_YOUR_DUEL'; end if;
  if v_duel.status <> 'accepted' then raise exception 'DUEL_NOT_ACTIVE'; end if;
  if v_duel.race_deadline < now() then raise exception 'DUEL_EXPIRED'; end if;

  insert into public.duel_runs (duel_id, user_id, ms, trace)
  values (p_duel_id, auth.uid(), p_ms, p_trace)
  on conflict (duel_id, user_id) do update
    set ms = excluded.ms, trace = excluded.trace, updated_at = now()
    where public.duel_runs.ms > excluded.ms;

  v_rival_id := case when auth.uid() = v_duel.challenger_id then v_duel.opponent_id else v_duel.challenger_id end;
  select ms into v_rival_ms from public.duel_runs where duel_id = p_duel_id and user_id = v_rival_id;

  if v_rival_ms is null then
    -- El rival todavía no ha corrido: nada que liquidar todavía.
    return query select v_duel.status, null::uuid, false;
    return;
  end if;

  select ms into v_my_ms from public.duel_runs where duel_id = p_duel_id and user_id = auth.uid();

  if v_my_ms = v_rival_ms then
    -- Empate exacto: se devuelve a cada uno lo suyo, nadie gana ni pierde.
    update public.wallet set balance = balance + v_duel.wager, updated_at = now() where user_id = v_duel.challenger_id;
    update public.wallet set balance = balance + v_duel.wager, updated_at = now() where user_id = v_duel.opponent_id;
    insert into public.wallet_transactions (user_id, day, reason, amount) values
      (v_duel.challenger_id, v_today, 'duel_refund', v_duel.wager),
      (v_duel.opponent_id, v_today, 'duel_refund', v_duel.wager);
    v_winner := null;
  else
    v_winner := case when v_my_ms < v_rival_ms then auth.uid() else v_rival_id end;
    update public.wallet set balance = balance + (v_duel.wager * 2), updated_at = now() where user_id = v_winner;
    insert into public.wallet_transactions (user_id, day, reason, amount)
      values (v_winner, v_today, 'duel_payout', v_duel.wager * 2);
  end if;

  update public.duels set status = 'finished', winner_id = v_winner where id = p_duel_id;

  return query select 'finished'::text, v_winner, true;
end;
$$;

revoke all on function public.submit_duel_run(uuid, int, jsonb) from public;
grant execute on function public.submit_duel_run(uuid, int, jsonb) to authenticated;
