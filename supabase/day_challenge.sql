-- ============================================================================
--  Reto del día — +15 monedas, 1 vez al día por usuario (JC, 2026-10-05).
--
--  Mismo patrón que claim_share_reward: idempotente por wallet_transactions,
--  con su propio índice único (user_id, day) para reason = 'challenge' — no se
--  toca wallet_tx_once_per_day, que ya han redefinido varios archivos.
--
--  Qué reto toca y si se ha cumplido lo decide el cliente (src/dayChallenge.js),
--  igual que los tiempos: el servidor solo garantiza que se cobra una vez.
--
--  El día lo manda el cliente porque los retos van por fecha LOCAL (como el
--  circuito); se acepta el desfase de una franja horaria, igual que submit_time.
--
--  Pégalo en Supabase > SQL Editor > Run.
-- ============================================================================

alter table public.wallet_transactions drop constraint if exists wallet_transactions_reason_check;
alter table public.wallet_transactions add constraint wallet_transactions_reason_check
  check (reason in ('streak', 'ranking', 'pack_open', 'share', 'referral', 'gp', 'monthly',
                    'duel_wager', 'duel_payout', 'duel_refund', 'challenge'));

create unique index if not exists wallet_tx_challenge_once
  on public.wallet_transactions (user_id, day) where reason = 'challenge';

create or replace function public.claim_day_challenge(p_day date)
returns table(granted boolean, new_balance int)
language plpgsql security definer set search_path = public
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_rows int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_day < v_today - 1 or p_day > v_today + 1 then
    raise exception 'DAY_OUT_OF_RANGE';
  end if;

  insert into public.wallet_transactions (user_id, day, reason, amount)
  values (auth.uid(), p_day, 'challenge', 15)
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return query select false, (select balance from public.wallet where user_id = auth.uid());
    return;
  end if;

  insert into public.wallet (user_id, balance) values (auth.uid(), 15)
  on conflict (user_id) do update set balance = wallet.balance + excluded.balance, updated_at = now();

  return query select true, (select balance from public.wallet where user_id = auth.uid());
end;
$$;

revoke all on function public.claim_day_challenge(date) from public;
grant execute on function public.claim_day_challenge(date) to authenticated;
