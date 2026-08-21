-- ============================================================================
--  ⚠️  NO CORRER TODAVÍA.  Léelo entero antes de tocar nada.
--
--  Esto cierra la puerta que abre A-01: quita las policies que dejan al
--  cliente escribir `attempts` a mano, para que el único camino sea el RPC
--  submit_time (ver submit_time.sql).
--
--  POR QUÉ NO SE PUEDE CORRER YA
--  -----------------------------
--  Toda versión de la app anterior a la 2.4.1 guarda el tiempo con un upsert
--  directo a la tabla. En el momento en que se ejecute esto, esas versiones
--  DEJAN DE PODER GUARDAR TIEMPOS: el jugador corre su vuelta, cruza la meta
--  y el ranking no se entera. Sin error visible, además.
--
--  EL ORDEN CORRECTO
--  -----------------
--   1. Correr submit_time.sql            (seguro: solo añade, no quita)
--   2. Publicar la 2.4.1 en las dos tiendas
--   3. Subir min_build en app_version    (fuerza a todos a la 2.4.1)
--   4. Esperar a que la gente actualice de verdad
--   5. AHORA sí, correr esto
--
--  El paso 3 es el que hace que esto sea posible sin dejar tirado a nadie —
--  es la primera vez que el force update sirve para algo real.
--
--  CÓMO SABER QUE YA TOCA
--  ----------------------
--  Esta consulta enseña cuántos jugadores siguen escribiendo por el camino
--  viejo. Mientras no dé 0 durante un par de días seguidos, no corras el
--  drop de abajo:
--
--    select count(*) from public.attempts
--     where day >= current_date - 2
--       and updated_at > now() - interval '48 hours';
--
--  (No distingue el camino usado, así que lo fiable de verdad es mirar en
--  Supabase > Logs que no queden llamadas PATCH/POST a /rest/v1/attempts.)
-- ============================================================================

drop policy if exists attempts_insert_self on public.attempts;
drop policy if exists attempts_update_self on public.attempts;

-- La lectura se queda como estaba: el ranking es público entre autenticados.
-- Solo se cierra la escritura, que ahora entra únicamente por submit_time.

-- Comprobación: en `attempts` debe quedar SOLO la policy de select.
select policyname, cmd
  from pg_policies
 where schemaname = 'public' and tablename = 'attempts';
