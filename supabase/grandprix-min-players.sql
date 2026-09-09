-- ============================================================================
--  Grand Prix — mínimo de 3 jugadores para arrancar (JC, 2026-09-09).
--
--  Solo actualiza start_grand_prix (ya está en grandprix.sql con este mismo
--  cambio si repegas el archivo entero — este fichero suelto es por si ya
--  tienes grandprix.sql corrido y solo quieres añadir el mínimo sin repasar
--  todo el archivo).
--
--  Pégalo en Supabase > SQL Editor > Run (después de grandprix.sql).
-- ============================================================================

create or replace function public.start_grand_prix(p_group_id uuid)
returns public.grand_prix
language plpgsql
security definer
set search_path = public
as $$
declare
  gp public.grand_prix;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_group_id not in (select public.my_group_ids()) then raise exception 'NOT_A_MEMBER'; end if;
  if (select count(*) from public.group_members where group_id = p_group_id) < 3 then
    raise exception 'GP_NEEDS_3_PLAYERS';
  end if;
  begin
    insert into public.grand_prix (group_id, created_by) values (p_group_id, auth.uid())
      returning * into gp;
  exception when unique_violation then
    raise exception 'GP_ALREADY_ACTIVE';
  end;
  return gp;
end;
$$;
