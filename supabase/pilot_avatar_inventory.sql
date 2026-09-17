-- ============================================================================
--  Avatares de piloto — inventario real (JC, 2026-09-16: "selector de
--  avatar... con las 4 rarezas, como en garaje").
--
--  Reutiliza TAL CUAL el sistema de catalog_pieces/inventory/open_pack ya
--  construido para el coche (economy.sql) — exactamente como decía el plan
--  original: "open_pack() NO necesita tocarse, ya elige de todo
--  catalog_pieces sin filtrar por categoría". Category nueva: 'avatar'.
--  piece_id = la misma key que usa avatarCatalog.js ('raro_1', 'epico_2',
--  'legendario'...) — así el cliente no necesita traducir nada.
--
--  Rareza: solo la BASE es gratis de por vida (JC, 2026-09-16: "cuando
--  lancemos la 2.4.4 todos deben tener el base y todos los demás
--  bloqueados") — las 6 comunes YA NO son gratis, entran en catalog_pieces
--  igual que las de pago. catalog_pieces.rarity solo admite
--  ('rara','epica','legendaria') — no hay un cuarto escalón "común" en el
--  sobre — así que las 6 comunes caen en el mismo bombo 'rara' que los 4
--  raros (65% de probabilidad, ahora repartida entre 10 piezas en vez de 4).
--
--  REVISIÓN 2026-09-16: este archivo YA SE CORRIÓ una vez con las comunes
--  como gratis (sin filas de catalog_pieces para ellas). Hay que volver a
--  pegarlo entero en Supabase > SQL Editor > Run — el insert de abajo es
--  aditivo (on conflict do nothing) y el CREATE OR REPLACE de la función
--  sustituye la versión vieja sin tocar pilot_avatar_id ya guardado.
-- ============================================================================

alter table public.users add column if not exists pilot_avatar_id text;

insert into public.catalog_pieces (category, piece_id, rarity, hex) values
  ('avatar', 'comun_1', 'rara', null),
  ('avatar', 'comun_2', 'rara', null),
  ('avatar', 'comun_3', 'rara', null),
  ('avatar', 'comun_4', 'rara', null),
  ('avatar', 'comun_5', 'rara', null),
  ('avatar', 'comun_6', 'rara', null),
  ('avatar', 'raro_1', 'rara', null),
  ('avatar', 'raro_2', 'rara', null),
  ('avatar', 'raro_3', 'rara', null),
  ('avatar', 'raro_4', 'rara', null),
  ('avatar', 'epico_1', 'epica', null),
  ('avatar', 'epico_2', 'epica', null),
  ('avatar', 'legendario', 'legendaria', null)
on conflict (category, piece_id) do nothing;

-- ----------------------------------------------------------------------------
--  save_pilot_avatar(): mismo patrón que save_loadout() — valida en
--  servidor que el avatar elegido sea gratis o esté en tu inventory antes
--  de escribir pilot_avatar_id, así un UPDATE directo por REST no puede
--  equiparte un avatar premium sin haberlo ganado en un sobre.
-- ----------------------------------------------------------------------------
create or replace function public.save_pilot_avatar(p_avatar_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  -- Solo la base es gratis (JC, 2026-09-16) — espejo EXACTO de
  -- isFreeAvatar() en avatarCatalog.js: si cambia uno, cambia el otro.
  v_free text[] := array['base'];
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;

  if not (p_avatar_id = any(v_free) or exists(
    select 1 from public.inventory
    where user_id = v_uid and category = 'avatar' and piece_id = p_avatar_id
  )) then
    raise exception 'PIECE_NOT_OWNED: avatar';
  end if;

  update public.users set pilot_avatar_id = p_avatar_id where id = v_uid;
end;
$$;

grant execute on function public.save_pilot_avatar(text) to authenticated;
