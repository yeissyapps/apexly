-- ============================================================================
--  Grand Prix — recompensa económica de FIN DE TEMPORADA (JC, 2026-09-09).
--
--  Al terminar las 7 rondas, reparto 50/30/20 de una bolsa fija entre el
--  podio de la clasificación general — no por ronda suelta (eso multiplicaría
--  los eventos de pago por 7 y diluiría la sensación de campeonato). Pagado
--  por el cron gp-tick existente (rama "GP terminado"), reutilizando
--  credit_wallet (mismo RPC que ya usa close-ranking-rewards para el Diario).
--
--  credit_wallet hoy solo acepta p_reason='ranking' — hace falta sumar 'gp'
--  al motivo válido, mismo patrón que share_reward.sql ya usó para sumar
--  'share' al constraint de wallet_transactions.
--
--  Pégalo en Supabase > SQL Editor > Run (después de economy.sql).
-- ============================================================================

alter table public.wallet_transactions drop constraint if exists wallet_transactions_reason_check;
alter table public.wallet_transactions add constraint wallet_transactions_reason_check
  check (reason in ('streak', 'ranking', 'pack_open', 'share', 'referral', 'gp'));

-- El índice único de "una vez al día por motivo" (wallet_tx_once_per_day)
-- sigue sirviendo tal cual para 'gp': la Edge Function usa como `day` la
-- fecha real de cierre de la temporada, así que un cron que reprocese el
-- mismo GP terminado no puede pagar dos veces.
drop index if exists wallet_tx_once_per_day;
create unique index wallet_tx_once_per_day
  on public.wallet_transactions (user_id, day, reason) where reason in ('streak', 'ranking', 'gp');

create or replace function public.credit_wallet(p_user_id uuid, p_amount int, p_day date, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int;
begin
  if p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_reason not in ('ranking', 'gp') then raise exception 'INVALID_REASON'; end if;

  insert into public.wallet_transactions (user_id, day, reason, amount)
  values (p_user_id, p_day, p_reason, p_amount)
  on conflict (user_id, day, reason) where reason in ('streak', 'ranking', 'gp') do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return; end if;

  insert into public.wallet (user_id, balance) values (p_user_id, p_amount)
  on conflict (user_id) do update set balance = wallet.balance + excluded.balance, updated_at = now();
end;
$$;
