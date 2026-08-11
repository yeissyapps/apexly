-- ============================================================================
--  Recompensa por compartir el resultado — 1 vez al día por usuario, mismo
--  patrón que grant_daily_reward: idempotente vía wallet_transactions + el
--  índice único que ya protege streak/ranking (se le añade 'share').
--
--  Pégalo en Supabase > SQL Editor > Run (después de economy.sql).
-- ============================================================================

alter table public.wallet_transactions drop constraint if exists wallet_transactions_reason_check;
alter table public.wallet_transactions add constraint wallet_transactions_reason_check
  check (reason in ('streak', 'ranking', 'pack_open', 'share'));

drop index if exists wallet_tx_once_per_day;
create unique index wallet_tx_once_per_day
  on public.wallet_transactions (user_id, day, reason) where reason in ('streak', 'ranking', 'share');

create or replace function public.claim_share_reward()
returns table(granted boolean, new_balance int)
language plpgsql security definer set search_path = public
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_rows int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  insert into public.wallet_transactions (user_id, day, reason, amount)
  values (auth.uid(), v_day, 'share', 5)
  on conflict (user_id, day, reason) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return query select false, (select balance from public.wallet where user_id = auth.uid());
    return;
  end if;

  insert into public.wallet (user_id, balance) values (auth.uid(), 5)
  on conflict (user_id) do update set balance = wallet.balance + excluded.balance, updated_at = now();

  return query select true, (select balance from public.wallet where user_id = auth.uid());
end;
$$;
grant execute on function public.claim_share_reward() to authenticated;
