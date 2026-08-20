-- ============================================================================
--  Force update — versión mínima obligatoria por plataforma. Si el build
--  instalado es menor que min_build, la app bloquea el juego con una
--  pantalla de "actualiza" (ver App.js, screen === 'force-update').
--
--  Solo lectura desde el cliente (RLS select público, sin auth ni sesión
--  aún activa cuando se consulta). Para forzar una actualización tras
--  publicar un build nuevo, actualiza la fila a mano desde el SQL Editor:
--
--    update public.app_version set min_build = 20 where platform = 'ios';
--    update public.app_version set min_build = 11 where platform = 'android';
--
--  Pégalo en Supabase > SQL Editor > Run.
-- ============================================================================

create table if not exists public.app_version (
  platform   text primary key check (platform in ('ios', 'android')),
  min_build  int not null,
  updated_at timestamptz not null default now()
);

alter table public.app_version enable row level security;

drop policy if exists app_version_select_all on public.app_version;
create policy app_version_select_all on public.app_version
  for select to anon, authenticated using (true);

-- Arranca sin exigir nada (min_build = build actual en producción):
-- súbelo a mano el día que quieras cortar el paso a versiones viejas.
insert into public.app_version (platform, min_build) values
  ('ios', 19),
  ('android', 10)
on conflict (platform) do nothing;
