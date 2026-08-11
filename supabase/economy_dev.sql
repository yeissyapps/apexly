-- ============================================================================
--  DEV ONLY — herramientas de prueba para la economía (avanzar racha sin
--  esperar un día real, sumar monedas de prueba). Pégalo en Supabase para
--  poder probar todo el ciclo (racha de 7 días, comprar sobres) sin esperar
--  días reales entre partidas.
--
--  BORRAR estas dos funciones (drop function) antes de que la economía
--  llegue a jugadores reales — dejan que cualquier usuario autenticado se
--  adelante racha o se regale monedas, algo que solo tiene sentido durante
--  el desarrollo. La UI que las llama vive detrás del flag DEV_WEATHER en
--  App.js (ya false por defecto), pero las funciones en sí no dependen de
--  ese flag — hay que quitarlas de Supabase a mano.
-- ============================================================================

create or replace function public.dev_advance_streak_day()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  -- Nunca deja last_played más de 1 día atrás: si le das varias veces
  -- seguidas sin jugar en medio (fácil de hacer sin querer), antes rompía
  -- la racha entera en vez de "adelantarla" — con este tope, repetir el tap
  -- no hace nada nuevo hasta que juegues otra vez.
  update public.users
    set last_played = greatest(last_played - 1, ((now() at time zone 'utc')::date - 1))
    where id = auth.uid() and last_played is not null;

  -- grant_daily_reward() cobra como mucho una vez por DÍA REAL (a propósito
  -- — es la protección contra granjear días falsos, no depende de
  -- last_played). Sin esto, adelantar la racha varias veces en el mismo día
  -- real sube el número pero deja de sumar monedas a partir de la segunda
  -- vez. Se borra el cobro de "hoy" para poder probar cada tier otra vez.
  delete from public.wallet_transactions
    where user_id = auth.uid()
      and day = (now() at time zone 'utc')::date
      and reason = 'streak';
end;
$$;

grant execute on function public.dev_advance_streak_day() to authenticated;

create or replace function public.dev_grant_coins(p_amount int default 200)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_amount <= 0 or p_amount > 1000 then raise exception 'INVALID_AMOUNT'; end if;

  insert into public.wallet (user_id, balance) values (auth.uid(), p_amount)
  on conflict (user_id) do update
    set balance = wallet.balance + excluded.balance, updated_at = now();

  select balance into v_balance from public.wallet where user_id = auth.uid();
  return v_balance;
end;
$$;

grant execute on function public.dev_grant_coins(int) to authenticated;
