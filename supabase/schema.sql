-- ============================================================================
--  Circuito Diario — esquema Supabase (v0.3)
--
--  Pégalo entero en Supabase > SQL Editor > New query > Run.
--  Requiere además: Auth > Providers > "Allow anonymous sign-ins" = ON.
--
--  Modelo: grupo cerrado de amigos. Todos leen los nombres y tiempos de todos
--  (para el leaderboard "de mi grupo"); cada uno solo escribe LO SUYO.
-- ============================================================================

-- ---- Tablas ----------------------------------------------------------------
create table if not exists public.users (
  id         uuid primary key references auth.users (id) on delete cascade,
  nickname   text not null,
  created_at timestamptz not null default now()
);

-- Circuito del día. El combo se decide de forma determinística por fecha en el
-- cliente (src/daily.js); esta tabla lo deja registrado (y permite curar/forzar
-- un día en el futuro sin actualizar la app).
create table if not exists public.daily_track (
  day        date primary key,
  combo_id   text not null,
  created_at timestamptz not null default now()
);

-- Solo el MEJOR tiempo del día por usuario (no el histórico de cada intento).
create table if not exists public.attempts (
  user_id    uuid not null references public.users (id) on delete cascade,
  day        date not null,
  best_ms    integer not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

-- ---- Row Level Security ----------------------------------------------------
alter table public.users       enable row level security;
alter table public.daily_track enable row level security;
alter table public.attempts    enable row level security;

-- users: todos (autenticados) leen; cada uno inserta/edita SOLO su fila.
drop policy if exists users_select_all  on public.users;
drop policy if exists users_insert_self on public.users;
drop policy if exists users_update_self on public.users;
create policy users_select_all  on public.users for select to authenticated using (true);
create policy users_insert_self on public.users for insert to authenticated with check (auth.uid() = id);
create policy users_update_self on public.users for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- daily_track: todos leen; inserción idempotente por cualquiera autenticado.
drop policy if exists daily_select_all on public.daily_track;
drop policy if exists daily_insert_any on public.daily_track;
create policy daily_select_all on public.daily_track for select to authenticated using (true);
create policy daily_insert_any on public.daily_track for insert to authenticated with check (true);

-- attempts: todos leen (leaderboard); cada uno escribe SOLO lo suyo.
drop policy if exists attempts_select_all  on public.attempts;
drop policy if exists attempts_insert_self on public.attempts;
drop policy if exists attempts_update_self on public.attempts;
create policy attempts_select_all  on public.attempts for select to authenticated using (true);
create policy attempts_insert_self on public.attempts for insert to authenticated with check (auth.uid() = user_id);
create policy attempts_update_self on public.attempts for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
