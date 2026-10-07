-- ============================================================================
--  Duelos: victoria por incomparecencia (JC, 2026-10-05: "gana el que corrió").
--
--  Sustituye expire_duels() de duels-cron.sql. Antes, un duelo aceptado que
--  llegaba al plazo con UNA sola vuelta devolvía la apuesta a los dos: aceptar
--  y no correr salía gratis, y quien sí se presentó no ganaba nada.
--
--  Ahora, al vencer los 15 minutos de un duelo 'accepted':
--    - si corrió uno solo -> 'finished', gana él y se lleva el bote (2x);
--    - si no corrió nadie -> 'expired', se devuelve la apuesta a los dos.
--  (Si corrieron los dos, el duelo ya se liquidó en submit_duel_run y no
--  llega aquí.)
--
--  Se hace en bucle, duelo a duelo, y no en un único UPDATE con CTEs: un mismo
--  jugador puede salir en dos duelos caducados en la misma pasada, y dos CTEs
--  que actualizan la misma fila de wallet en una sola sentencia no suman.
--
--  El cron ya programado (expire-duels, cada 2 min) llama a esta función por
--  su nombre, así que basta con correr este archivo: no hay que reprogramar.
--
--  Pégalo en Supabase > SQL Editor > Run.
-- ============================================================================

create or replace function public.expire_duels()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  d record;
begin
  update public.duels
    set status = 'expired'
    where status = 'pending' and accept_deadline < now();

  for d in
    update public.duels du
      set status = case when exists (select 1 from public.duel_runs r where r.duel_id = du.id)
                        then 'finished' else 'expired' end,
          winner_id = (select r.user_id from public.duel_runs r where r.duel_id = du.id limit 1)
      where du.status = 'accepted' and du.race_deadline < now()
      returning du.id, du.challenger_id, du.opponent_id, du.wager, du.winner_id
  loop
    if d.winner_id is not null then
      update public.wallet set balance = balance + d.wager * 2, updated_at = now() where user_id = d.winner_id;
      insert into public.wallet_transactions (user_id, day, reason, amount)
        values (d.winner_id, v_today, 'duel_payout', d.wager * 2);
    else
      update public.wallet set balance = balance + d.wager, updated_at = now()
        where user_id in (d.challenger_id, d.opponent_id);
      insert into public.wallet_transactions (user_id, day, reason, amount) values
        (d.challenger_id, v_today, 'duel_refund', d.wager),
        (d.opponent_id, v_today, 'duel_refund', d.wager);
    end if;
  end loop;
end;
$$;
