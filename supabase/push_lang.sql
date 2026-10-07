-- ============================================================================
--  Idioma de las notificaciones push (2026-10-07: la app se puede usar en
--  inglés). Se guarda por DISPOSITIVO, junto a su token: un aviso se manda a
--  un móvil, así que manda el idioma de ese móvil.
--
--  register_push_token gana un segundo parámetro, `p_lang`, con valor por
--  defecto 'es'. Se borra la versión de un solo parámetro antes de crear la
--  nueva: si convivieran las dos, PostgREST no sabría a cuál llamar cuando una
--  app vieja manda solo p_token (PGRST203). Con una sola función y el valor
--  por defecto, las apps viejas siguen funcionando igual (sus avisos, en
--  español, como hasta ahora).
--
--  Las Edge Functions leen push_tokens.lang (ver functions/_shared/push.ts) y
--  si la columna no existe caen al español — así que el orden de despliegue no
--  rompe nada, pero lo suyo es correr esto ANTES de publicar la app.
--
--  Pégalo en Supabase > SQL Editor > Run.
-- ============================================================================

alter table public.push_tokens add column if not exists lang text not null default 'es';
alter table public.push_tokens drop constraint if exists push_tokens_lang_check;
alter table public.push_tokens add constraint push_tokens_lang_check check (lang in ('es', 'en'));

drop function if exists public.register_push_token(text);

create or replace function public.register_push_token(p_token text, p_lang text default 'es')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lang text := case when p_lang = 'en' then 'en' else 'es' end;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_token is null or length(p_token) = 0 then
    raise exception 'TOKEN_REQUIRED';
  end if;

  -- Igual que antes (register_push_token.sql): el móvil es este y quien lo
  -- usa ahora es este; las identidades que dejó atrás no reciben nada.
  delete from public.push_tokens
   where token = p_token
     and user_id <> auth.uid();

  insert into public.push_tokens (user_id, token, lang, updated_at)
  values (auth.uid(), p_token, v_lang, now())
  on conflict (user_id) do update
    set token = excluded.token,
        lang = excluded.lang,
        updated_at = now();
end;
$$;

revoke all on function public.register_push_token(text, text) from public;
grant execute on function public.register_push_token(text, text) to authenticated;
