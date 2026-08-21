-- ============================================================================
--  register_push_token — un token de push pertenece a UN dispositivo, y un
--  dispositivo a UNA identidad.
--
--  PARCHE de A-02 (no el arreglo completo: recuperar la cuenta al reinstalar
--  sigue pendiente y es una decisión de producto, no un bug).
--
--  El problema: push_tokens tiene user_id como clave primaria y `token` SIN
--  unicidad, y el cliente hacía un upsert por user_id sin limpiar nada. Cada
--  reinstalación crea una identidad anónima nueva y deja la anterior colgando
--  del mismo token físico, para siempre. En producción se encontró un token
--  con ONCE identidades detrás.
--
--  Eso es lo que hacía que el recordatorio de las 20:00 llegara aunque
--  hubieras jugado (la identidad vieja "no había jugado hoy" y se quedaba el
--  token), y lo que puede mandarte un "te ha superado" de tu propia cuenta
--  antigua.
--
--  SOBRE EL DELETE: borra filas de OTROS user_id, cosa que RLS no permitiría,
--  y por eso va en security definer. Es deliberado: si dos identidades
--  comparten token es que son el mismo móvil. La contrapartida, asumida a
--  conciencia: quien conociera el token de otra persona podría reclamarlo y
--  dejarla sin notificaciones. El token solo se expone al propio dispositivo
--  (la policy de select es self-only), el daño máximo es quedarse sin push, y
--  es el mismo compromiso que hace cualquier implementación de push seria.
--
--  Pégalo en Supabase > SQL Editor > Run. Es seguro correrlo ya: añade la
--  función sin quitar las policies, así que las versiones ya instaladas
--  siguen registrando su token como hasta ahora.
-- ============================================================================

create or replace function public.register_push_token(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_token is null or length(p_token) = 0 then
    raise exception 'TOKEN_REQUIRED';
  end if;

  -- El móvil es este y quien lo usa ahora es este: las identidades que dejó
  -- atrás no tienen por qué seguir recibiendo nada.
  delete from public.push_tokens
   where token = p_token
     and user_id <> auth.uid();

  insert into public.push_tokens (user_id, token, updated_at)
  values (auth.uid(), p_token, now())
  on conflict (user_id) do update
    set token = excluded.token,
        updated_at = now();
end;
$$;

revoke all on function public.register_push_token(text) from public;
grant execute on function public.register_push_token(text) to authenticated;


-- ----------------------------------------------------------------------------
--  LIMPIEZA DE UNA SOLA VEZ (opcional)
--
--  Lo de arriba evita que se creen huérfanas nuevas, pero no toca las que ya
--  existen. Esto deja, de cada token repetido, solo la fila más reciente.
--
--  MIRA PRIMERO qué se llevaría:
--
--    select user_id, token, updated_at from public.push_tokens t
--     where exists (select 1 from public.push_tokens t2
--                    where t2.token = t.token and t2.updated_at > t.updated_at)
--     order by updated_at desc;
--
--  Y cuando la lista sea la que esperas, descomenta y corre:
--
--  delete from public.push_tokens t
--   where exists (select 1 from public.push_tokens t2
--                  where t2.token = t.token and t2.updated_at > t.updated_at);
--
--  OJO: esto solo borra filas de push_tokens, no las identidades. Los usuarios
--  fantasma siguen en `users` con sus tiempos en los rankings de esos días;
--  eso se limpia aparte y a mano, porque borrar usuarios sí es irreversible.
-- ----------------------------------------------------------------------------
