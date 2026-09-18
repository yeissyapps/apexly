-- ============================================================================
--  Presencia — "última vez visto" por jugador, para la insignia EN LÍNEA
--  del ranking mensual y del perfil (JC, 2026-09-17: presencia real, no una
--  pantalla nueva de explorar quién está online).
--
--  Sin infraestructura de tiempo real: la app llama a touch_presence() cada
--  ~60s mientras está en primer plano (AppState), y "en línea" en el
--  cliente es simplemente "last_seen de hace menos de ~3 minutos" — el
--  mismo tipo de aproximación por sondeo que usa todo lo demás en este
--  proyecto (no hay websockets en ningún sitio del codebase).
--
--  Pégalo en Supabase > SQL Editor > Run.
-- ============================================================================

create table if not exists public.presence (
  user_id   uuid primary key references public.users (id) on delete cascade,
  last_seen timestamptz not null default now()
);

alter table public.presence enable row level security;

-- Un timestamp de "última vez activo" no es más sensible que el tiempo o la
-- racha, que ya son públicos en el ranking — lectura abierta a todos los
-- autenticados.
drop policy if exists presence_select_all on public.presence;
create policy presence_select_all on public.presence
  for select to authenticated using (true);

-- Sin policies de insert/update: solo se escribe por aquí.
create or replace function public.touch_presence()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  insert into public.presence (user_id, last_seen)
  values (auth.uid(), now())
  on conflict (user_id) do update set last_seen = now();
end;
$$;

revoke all on function public.touch_presence() from public;
grant execute on function public.touch_presence() to authenticated;
