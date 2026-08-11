-- ============================================================================
--  Circuito Diario — Grupos (v0.5)
--
--  Pégalo entero en Supabase > SQL Editor > New query > Run (después de
--  schema.sql). Añade grupos privados con código: un usuario puede estar en
--  varios grupos y compite en cada uno + en el Global.
-- ============================================================================

-- ---- Tablas ----------------------------------------------------------------
create table if not exists public.groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  join_code  text not null unique,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id  uuid not null references public.groups (id) on delete cascade,
  user_id   uuid not null references public.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

alter table public.groups        enable row level security;
alter table public.group_members enable row level security;

-- ---- Helper SECURITY DEFINER (evita recursión en las políticas RLS) --------
-- Devuelve los ids de grupo del usuario actual saltándose RLS.
create or replace function public.my_group_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select group_id from public.group_members where user_id = auth.uid();
$$;

-- ---- RLS: solo lees grupos/miembros de los grupos a los que perteneces -----
drop policy if exists groups_select on public.groups;
create policy groups_select on public.groups for select to authenticated
  using (id in (select public.my_group_ids()));

drop policy if exists gm_select on public.group_members;
create policy gm_select on public.group_members for select to authenticated
  using (group_id in (select public.my_group_ids()));

-- Las inserciones van SIEMPRE por las funciones de abajo (SECURITY DEFINER),
-- así que no hay políticas de INSERT directas (quedan bloqueadas a propósito).

-- ---- Crear grupo: genera código único y te añade como miembro --------------
create or replace function public.create_group(p_name text)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.groups;
  code text;
  tries int := 0;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  loop
    code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    begin
      insert into public.groups (name, join_code, created_by)
        values (coalesce(nullif(trim(p_name), ''), 'Grupo'), code, auth.uid())
        returning * into g;
      exit;
    exception when unique_violation then
      tries := tries + 1;
      if tries > 10 then raise; end if;
    end;
  end loop;
  insert into public.group_members (group_id, user_id) values (g.id, auth.uid())
    on conflict do nothing;
  return g;
end;
$$;

-- ---- Unirse a un grupo por código ------------------------------------------
create or replace function public.join_group(p_code text)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.groups;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into g from public.groups where join_code = upper(trim(p_code));
  if g.id is null then raise exception 'GROUP_NOT_FOUND'; end if;
  insert into public.group_members (group_id, user_id) values (g.id, auth.uid())
    on conflict do nothing;
  return g;
end;
$$;

-- ---- Salir de un grupo ------------------------------------------------------
-- Sin restricciones (aunque el grupo tenga un Grand Prix activo): quien se
-- va, se va. El historial de resultados que ya haya clasificado en ese GP
-- NO desaparece (computeStandings en gpData.js sigue mostrándolo aunque ya
-- no esté en group_members) — solo deja de ver el grupo y de poder entrar en
-- futuras rondas. Si el grupo se queda sin nadie, simplemente queda huérfano
-- (gp-tick ya lo salta si no tiene miembros); no hace falta borrarlo.
create or replace function public.leave_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  delete from public.group_members where group_id = p_group_id and user_id = auth.uid();
end;
$$;

grant execute on function public.create_group(text) to authenticated;
grant execute on function public.join_group(text)   to authenticated;
grant execute on function public.my_group_ids()      to authenticated;
grant execute on function public.leave_group(uuid)   to authenticated;
