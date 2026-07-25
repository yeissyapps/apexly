-- ============================================================================
--  Circuito Diario — Tokens de notificación push (v0.5)
--
--  Pégalo en Supabase > SQL Editor > Run (después de schema.sql y groups.sql).
--  Tabla aparte y PRIVADA: cada usuario solo ve/escribe su propio token. La
--  Edge Function `notify-overtakes` los lee con service_role para enviar push.
-- ============================================================================

create table if not exists public.push_tokens (
  user_id    uuid primary key references public.users (id) on delete cascade,
  token      text not null,
  updated_at timestamptz not null default now()
);

alter table public.push_tokens enable row level security;

drop policy if exists pt_select_self on public.push_tokens;
drop policy if exists pt_insert_self on public.push_tokens;
drop policy if exists pt_update_self on public.push_tokens;
create policy pt_select_self on public.push_tokens for select to authenticated using (auth.uid() = user_id);
create policy pt_insert_self on public.push_tokens for insert to authenticated with check (auth.uid() = user_id);
create policy pt_update_self on public.push_tokens for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
