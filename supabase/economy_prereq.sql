-- ============================================================================
--  Circuito Diario — Prerrequisito de seguridad para la economía de monedas
--
--  Pégalo en Supabase > SQL Editor > Run (después de car_v2.sql, ANTES de
--  economy.sql — economy.sql define save_loadout() más abajo, que necesita
--  las tablas inventory/catalog_pieces de economy.sql; ejecuta los dos
--  seguidos, en este orden).
--
--  Hoy current_streak/longest_streak/last_played y las columnas car_* se
--  escriben con un UPDATE directo del cliente contra `users`, protegido solo
--  por la policy users_update_self (auth.uid()=id, SIN restricción de
--  columna) — cualquiera puede hacer
--  supabase.from('users').update({current_streak: 700}) por REST/JS directo
--  sin tocar el binario de la app. Inofensivo hoy (cosmético); en cuanto la
--  economía confíe en current_streak (recompensa de racha) o en el loadout
--  real (piezas de pago), deja de serlo. Se cierra revocando el UPDATE de
--  esas columnas concretas y moviendo la escritura a funciones RPC.
-- ============================================================================

revoke update (current_streak, longest_streak, last_played) on public.users from authenticated;
revoke update (car_body_color, car_wing_shape, car_wing_color, car_livery, car_livery_pattern, car_lights_color) on public.users from authenticated;

-- ---- bump_streak(): misma lógica que bumpStreak() en api.js, movida al
-- servidor. Sin argumentos: el día se calcula aquí (UTC), nunca se confía en
-- una fecha que mande el cliente (si no, un cliente podría llamar con fechas
-- inventadas para simular "días nuevos" y granjear racha infinita). Mismo
-- desfase ya aceptado en otros sitios del proyecto entre día UTC (aquí) y día
-- LOCAL del dispositivo (attempts.day vía todayKey()) — ver aviso en
-- daily-reminder-cron.sql; slop cosmético, no un vector de abuso.
create or replace function public.bump_streak()
returns table(current_streak int, longest_streak int, changed boolean, is_new_longest boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_yesterday date := v_today - 1;
  v_cur int; v_lng int; v_last date;
  v_new_cur int; v_new_lng int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select u.current_streak, u.longest_streak, u.last_played
    into v_cur, v_lng, v_last
    from public.users u where u.id = auth.uid();

  if v_last = v_today then
    return query select coalesce(v_cur, 0), coalesce(v_lng, 0), false, false;
    return;
  end if;

  v_new_cur := case when v_last = v_yesterday then coalesce(v_cur, 0) + 1 else 1 end;
  v_new_lng := greatest(coalesce(v_lng, 0), v_new_cur);

  update public.users
    set current_streak = v_new_cur, longest_streak = v_new_lng, last_played = v_today
    where id = auth.uid();

  return query select v_new_cur, v_new_lng, true, (v_new_cur > coalesce(v_lng, 0));
end;
$$;

grant execute on function public.bump_streak() to authenticated;

-- NOTA: save_loadout() (la RPC que sustituye a saveLoadout() en api.js) se
-- define en economy.sql, no aquí — necesita las tablas inventory/
-- catalog_pieces para validar qué piezas posees, y esas se crean allí.
