-- ============================================================================
--  Avatares de piloto — Fase 2: miniatura 2D para listas.
--
--  Por qué existe (ver el plan en
--  C:\Users\JC\.claude\plans\ticklish-dazzling-wand.md): el visor 3D en
--  vivo (PilotViewer.js) es demasiado caro para pintar en cada fila de un
--  ranking con scroll — en vez de eso, el cliente renderiza UNA foto fija
--  del avatar tras equipar/cambiar color, la sube aquí, y las listas pintan
--  esa imagen con un <Image> normal. Mismo patrón que "vuelta del líder"
--  (daily_runs): se genera una vez, se lee barato muchas veces.
--
--  Pégalo en Supabase > SQL Editor > Run.
-- ============================================================================

alter table public.users add column if not exists avatar_thumb_url text;

-- Bucket público de lectura (la miniatura se ve en listas sin autenticar
-- nada extra, igual que cualquier avatar de cualquier app) — la ESCRITURA
-- sí queda restringida a "tu propia carpeta" por las policies de abajo.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists avatars_public_read on storage.objects;
create policy avatars_public_read on storage.objects
  for select using (bucket_id = 'avatars');

-- Convención de ruta: "<user_id>/thumb.png" — storage.foldername(name)[1]
-- es el primer segmento de la ruta, comprobado contra tu propio auth.uid()
-- para que nadie pueda subir/pisar la miniatura de otro.
drop policy if exists avatars_own_write on storage.objects;
create policy avatars_own_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_own_update on storage.objects;
create policy avatars_own_update on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
