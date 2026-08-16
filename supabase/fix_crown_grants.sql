-- ============================================================================
--  ARREGLO DE SEGURIDAD: grant_world_crowns era llamable por cualquier jugador.
--
--  QUÉ PASABA: en Postgres toda función nace con EXECUTE concedido al pseudo-rol
--  PUBLIC. El frames.sql original revocaba solo `from authenticated, anon`, que
--  NO quita esa concesión heredada — así que la función seguía abierta.
--
--  Comprobado en caliente: una sesión anónima normal la llamó y devolvió 1,
--  es decir, concedió una corona. El daño posible no es solo adelantar el
--  cron: la función acepta FECHA, así que un jugador que ganara un día
--  cualquiera podía adjudicarse su corona cuando quisiera.
--
--  Es el mismo cierre que ya tenía credit_wallet (economy.sql), que estaba
--  bien: revocar a `public` TAMBIÉN, y conceder solo a service_role.
--
--  Pégalo en Supabase > SQL Editor > Run.
-- ============================================================================

revoke execute on function public.grant_world_crowns(date) from public, anon, authenticated;
grant  execute on function public.grant_world_crowns(date) to service_role;

-- Comprobación: debe quedar SOLO service_role (además del dueño).
select p.proname, r.rolname, has_function_privilege(r.rolname, p.oid, 'EXECUTE') as puede
  from pg_proc p
  cross join (values ('anon'),('authenticated'),('service_role')) as r(rolname)
 where p.proname = 'grant_world_crowns'
   and p.pronamespace = 'public'::regnamespace;
