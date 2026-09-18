-- ============================================================================
--  Caducidad de duelos — a diferencia de los demás cron de este proyecto
--  (daily-reminder, close-ranking-rewards, gp-tick), este NO llama a una
--  Edge Function: no hace falta avisar a nadie por push para expirar un
--  duelo, es trabajo puro de base de datos (cambiar estado + devolver
--  monedas), así que `expire_duels()` se programa directamente.
--
--  Dos plazos a expirar, los mismos de duels.sql:
--  - 'pending' pasado accept_deadline (10 min sin responder) → 'expired'.
--    Nadie pagó nada todavía (el cobro es al aceptar), así que no hay nada
--    que devolver.
--  - 'accepted' pasado race_deadline (15 min desde que se aceptó) sin que
--    LOS DOS hayan corrido → 'expired' + se devuelve la apuesta a los dos.
--    Por simplicidad y para no discutir "quién no se presentó": si al
--    caducar falta aunque sea una traza, se devuelve a los dos sin más —
--    nunca se declara ganador por incomparecencia.
--
--  Frecuencia cada 2 minutos: con una ventana de solo 15 minutos para
--  correr, un cron diario o cada 15 minutos (como gp-tick) dejaría el
--  reembolso colgado demasiado tiempo.
--
--  Pégalo en Supabase > SQL Editor > Run (después de duels.sql).
-- ============================================================================

create or replace function public.expire_duels()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
begin
  update public.duels
    set status = 'expired'
    where status = 'pending' and accept_deadline < now();

  with to_refund as (
    update public.duels
      set status = 'expired'
      where status = 'accepted' and race_deadline < now()
      returning id, challenger_id, opponent_id, wager
  ),
  credited as (
    update public.wallet w
      set balance = w.balance + r.wager, updated_at = now()
      from (
        select challenger_id as user_id, wager from to_refund
        union all
        select opponent_id as user_id, wager from to_refund
      ) r
      where w.user_id = r.user_id
      returning r.user_id, r.wager
  )
  insert into public.wallet_transactions (user_id, day, reason, amount)
  select user_id, v_today, 'duel_refund', wager from credited;
end;
$$;

-- Sin grant a authenticated: solo la llama el cron (dueño de la conexión =
-- el rol de Supabase que ejecuta pg_cron, ya con privilegios de servidor).

create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'expire-duels',
  '*/2 * * * *',
  $$ select public.expire_duels(); $$
);

-- Para comprobar que quedó programada:
--   select * from cron.job where jobname = 'expire-duels';
-- Para desactivarla:
--   select cron.unschedule('expire-duels');
