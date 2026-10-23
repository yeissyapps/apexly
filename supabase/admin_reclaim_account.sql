-- ============================================================================
--  Recuperar una cuenta perdida (JC, 2026-10-23: Andros y Josema13).
--
--  Qué pasa: las cuentas son anónimas — lo único que ata el móvil a su
--  cuenta es la sesión guardada en el propio móvil. Si esa sesión se pierde
--  (token de refresco rechazado, app reinstalada...), la app crea una cuenta
--  anónima NUEVA y vacía y pide un nombre. La cuenta vieja sigue intacta en
--  el servidor, pero el móvil ya no es ella.
--
--  Qué hace esto: mueve TODO lo de la cuenta vieja (tiempos, monedas,
--  piezas, avatar, racha, duelos, grupos...) a la cuenta nueva con la que el
--  móvil está conectado ahora, y le devuelve el nombre de siempre. Lo que
--  hubiera hecho la cuenta nueva (unas vueltas, un nombre provisional) se
--  descarta. Todo en una transacción: si algo falla, no cambia nada.
--
--  Cómo se usa:
--   1. Pégalo en Supabase > SQL Editor > Run (crea las funciones; solo se
--      pueden llamar desde el SQL Editor, nunca desde la app).
--   2. Pide al jugador que entre con un nombre PROVISIONAL cualquiera (p.ej.
--      "Andros2"): así su cuenta nueva tiene fila y se la puede localizar.
--   3. Ejecuta, con el nombre de siempre y el provisional:
--        select public.admin_reclaim_account('Andros', 'Andros2');
--   4. El jugador cierra la app del todo y la vuelve a abrir. Si le vuelve a
--      salir la pantalla del nombre, escribe su nombre DE SIEMPRE y entra en
--      su cuenta (el móvil aún recordaba el provisional).
--
--  Si el jugador está atascado en la pantalla del nombre y no puede poner
--  uno provisional, ver la consulta del final para localizar su cuenta nueva
--  por fecha y usar admin_move_account(id_viejo, id_nuevo).
-- ============================================================================

create or replace function public.admin_move_account(p_old uuid, p_new uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old  public.users%rowtype;
  v_nick text;
  v_ref  text;
  r      record;
  v_n    int;
  v_log  text := '';
begin
  if p_old is null or p_new is null or p_old = p_new then
    raise exception 'IDS_INVALIDOS';
  end if;
  select * into v_old from public.users where id = p_old;
  if not found then raise exception 'CUENTA_VIEJA_NO_EXISTE'; end if;
  if not exists (select 1 from auth.users where id = p_new) then
    raise exception 'CUENTA_NUEVA_NO_EXISTE_EN_AUTH';
  end if;
  v_nick := v_old.nickname;
  v_ref  := v_old.referral_code;

  -- 1. Fuera la cuenta nueva (la provisional): sus filas se van en cascada
  --    por las claves foráneas, y los "dueño de sector" pasan a null.
  delete from public.users where id = p_new;

  -- 2. Copia de la fila vieja con el id nuevo. Nombre y código de
  --    invitación son únicos: provisionales hasta borrar la vieja.
  insert into public.users
  select * from jsonb_populate_record(
    null::public.users,
    -- (provisional corto: por si hay un límite de 16 caracteres en el nombre)
    to_jsonb(v_old) || jsonb_build_object('id', p_new, 'nickname', left(v_nick, 12) || '~mv', 'referral_code', null)
  );

  -- 3. Toda columna que apunte a public.users(id) pasa de la vieja a la
  --    nueva (se descubren solas: si mañana hay una tabla nueva, entra).
  for r in
    select kcu.table_schema, kcu.table_name, kcu.column_name
      from information_schema.referential_constraints rc
      join information_schema.key_column_usage kcu
        on kcu.constraint_schema = rc.constraint_schema and kcu.constraint_name = rc.constraint_name
      join information_schema.key_column_usage pk
        on pk.constraint_schema = rc.unique_constraint_schema and pk.constraint_name = rc.unique_constraint_name
     where pk.table_schema = 'public' and pk.table_name = 'users' and pk.column_name = 'id'
  loop
    execute format('update %I.%I set %I = $1 where %I = $2', r.table_schema, r.table_name, r.column_name, r.column_name)
      using p_new, p_old;
    get diagnostics v_n = row_count;
    if v_n > 0 then v_log := v_log || format('%s.%s: %s · ', r.table_name, r.column_name, v_n); end if;
  end loop;

  -- 4. Fuera la fila vieja (ya no le apunta nada) y nombre de siempre.
  delete from public.users where id = p_old;
  update public.users set nickname = v_nick, referral_code = v_ref where id = p_new;

  return 'OK ' || v_nick || ' -> ' || p_new || ' · ' || v_log;
end;
$$;

create or replace function public.admin_reclaim_account(p_old_nick text, p_new_nick text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old uuid;
  v_new uuid;
begin
  select id into v_old from public.users where lower(nickname) = lower(trim(p_old_nick));
  if v_old is null then raise exception 'NO_EXISTE: %', p_old_nick; end if;
  select id into v_new from public.users where lower(nickname) = lower(trim(p_new_nick));
  if v_new is null then raise exception 'NO_EXISTE: %', p_new_nick; end if;
  return public.admin_move_account(v_old, v_new);
end;
$$;

-- Solo desde el SQL Editor (rol postgres): nadie desde la app.
revoke all on function public.admin_move_account(uuid, uuid) from public, anon, authenticated;
revoke all on function public.admin_reclaim_account(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Localizar una cuenta nueva SIN nombre (jugador atascado en la pantalla del
-- nombre): cuentas anónimas creadas en los últimos 3 días que aún no tienen
-- fila en public.users. Si coincide la hora con cuando le pasó, esa es.
--
--   select a.id, a.created_at, a.last_sign_in_at
--     from auth.users a
--     left join public.users u on u.id = a.id
--    where u.id is null and a.created_at > now() - interval '3 days'
--    order by a.created_at desc;
--
-- y entonces:  select public.admin_move_account(
--                (select id from public.users where nickname = 'Andros'),
--                '<id de la consulta de arriba>');
-- ---------------------------------------------------------------------------
