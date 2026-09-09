-- ============================================================================
--  Ranking del MES — recompensa económica de CIERRE DE MES (JC, 2026-09-09:
--  "tiene que ser un premio grande ya que es una recompensa mensual").
--
--  Al cerrar un mes de calendario, la mitad delantera de la clasificación
--  mensual (mismo criterio de puntos por percentil que ya pinta RankingTab —
--  ver pointsForDailyRank/bandValue en src/api.js) se lleva monedas de una
--  tabla fija de 10 bandas del 5% cada una (ver COIN_BANDS en src/api.js):
--  500/360/300/240/200/160/120/80/40/20. El top casi quintuplica el premio
--  semanal del Grand Prix (100, gp_season_reward.sql) y multiplica por 16 el
--  del ranking diario (30, close-ranking-rewards) — a propósito, es mensual.
--
--  Pagado por una Edge Function nueva (close-monthly-rewards) en su propio
--  cron mensual (ver close-monthly-rewards-cron.sql), reutilizando
--  credit_wallet — mismo mecanismo que ya usan el ranking diario y el GP.
--
--  credit_wallet hoy solo acepta 'ranking'/'gp' — se suma 'monthly'.
--
--  De paso se corrige un descuido de gp_season_reward.sql: al reescribir el
--  índice de una-vez-al-día se quedó sin 'share' (share_reward.sql SÍ lo
--  protegía) — se repone aquí para no perder esa protección.
--
--  Pégalo en Supabase > SQL Editor > Run (después de gp_season_reward.sql).
-- ============================================================================

alter table public.wallet_transactions drop constraint if exists wallet_transactions_reason_check;
alter table public.wallet_transactions add constraint wallet_transactions_reason_check
  check (reason in ('streak', 'ranking', 'pack_open', 'share', 'referral', 'gp', 'monthly'));

drop index if exists wallet_tx_once_per_day;
create unique index wallet_tx_once_per_day
  on public.wallet_transactions (user_id, day, reason)
  where reason in ('streak', 'ranking', 'share', 'gp', 'monthly');

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
  if p_reason not in ('ranking', 'gp', 'monthly') then raise exception 'INVALID_REASON'; end if;

  insert into public.wallet_transactions (user_id, day, reason, amount)
  values (p_user_id, p_day, p_reason, p_amount)
  on conflict (user_id, day, reason) where reason in ('streak', 'ranking', 'share', 'gp', 'monthly') do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return; end if;

  insert into public.wallet (user_id, balance) values (p_user_id, p_amount)
  on conflict (user_id) do update set balance = wallet.balance + excluded.balance, updated_at = now();
end;
$$;
