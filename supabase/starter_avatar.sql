-- ============================================================================
--  Piloto de bienvenida — un avatar COMÚN al azar para cada jugador nuevo
--  (auditoría de diseño, 2026-10-05).
--
--  Problema: como solo la base es gratis (pilot_avatar_inventory.sql), el
--  podio de Inicio y el ranking eran filas del MISMO muñeco repetido. Con un
--  común de regalo al registrarse, la parrilla se ve variada desde el primer
--  día y el jugador nuevo ya tiene "su" piloto.
--
--  No cambia la regla de JC del 2026-09-16 ("todos los demás bloqueados"): los
--  comunes siguen sin ser gratis y siguen saliendo en sobres; esto regala UNO,
--  una sola vez, a quien todavía no tenga ningún avatar en su inventario.
--
--  La llama la app justo después de guardar el nombre (api.js,
--  grantStarterAvatar). Idempotente: una segunda llamada no da nada.
--
--  Pégalo en Supabase > SQL Editor > Run.
-- ============================================================================

create or replace function public.grant_starter_avatar()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_pick text;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not exists (select 1 from public.users where id = v_uid) then return null; end if;
  if exists (select 1 from public.inventory where user_id = v_uid and category = 'avatar') then
    return null;
  end if;

  v_pick := (array['comun_1', 'comun_2', 'comun_3', 'comun_4', 'comun_5', 'comun_6'])[1 + floor(random() * 6)::int];

  insert into public.inventory (user_id, category, piece_id)
  values (v_uid, 'avatar', v_pick)
  on conflict (user_id, category, piece_id) do nothing;

  -- Se lo pone solo si sigue con la base (o sin nada): no pisa una elección.
  update public.users set pilot_avatar_id = v_pick
   where id = v_uid and coalesce(pilot_avatar_id, 'base') = 'base';

  return v_pick;
end;
$$;

revoke all on function public.grant_starter_avatar() from public;
grant execute on function public.grant_starter_avatar() to authenticated;

-- ----------------------------------------------------------------------------
--  OPCIONAL — regalar también a los jugadores que YA existen y siguen sin
--  ningún avatar (hoy, casi todos). Decisión de economía: no se ejecuta salvo
--  que quites los comentarios. Mismo reparto al azar.
-- ----------------------------------------------------------------------------
-- with sin_avatar as (
--   select u.id,
--          (array['comun_1','comun_2','comun_3','comun_4','comun_5','comun_6'])[1 + floor(random() * 6)::int] as pick
--   from public.users u
--   where not exists (select 1 from public.inventory i where i.user_id = u.id and i.category = 'avatar')
-- ), ins as (
--   insert into public.inventory (user_id, category, piece_id)
--   select id, 'avatar', pick from sin_avatar
--   on conflict (user_id, category, piece_id) do nothing
--   returning user_id, piece_id
-- )
-- update public.users u set pilot_avatar_id = ins.piece_id
--   from ins
--  where u.id = ins.user_id and coalesce(u.pilot_avatar_id, 'base') = 'base';
