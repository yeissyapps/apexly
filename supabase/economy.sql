-- ============================================================================
--  Circuito Diario — Economía de monedas + sobres
--
--  Pégalo en Supabase > SQL Editor > Run (después de economy_prereq.sql).
--
--  Monedas por racha (reutiliza users.current_streak) + por posición en el
--  ranking del día (cron aparte, ver close-ranking-rewards-cron.sql),
--  gastables en sobres de 125 monedas con una pieza aleatoria del garaje sin
--  duplicados. Todo el estado vive server-side: wallet/wallet_transactions/
--  inventory se escriben SOLO a través de las funciones de este archivo (o
--  del cron por service_role) — nunca por UPDATE/INSERT directo del cliente,
--  mismo patrón que sector_bests en sectors.sql.
-- ============================================================================

create table if not exists public.wallet (
  user_id       uuid primary key references public.users (id) on delete cascade,
  balance       integer not null default 0 check (balance >= 0),
  pending_packs integer not null default 0 check (pending_packs >= 0),
  updated_at    timestamptz not null default now()
);

create table if not exists public.wallet_transactions (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.users (id) on delete cascade,
  day        date not null,
  reason     text not null check (reason in ('streak', 'ranking', 'pack_open')),
  amount     integer not null,
  created_at timestamptz not null default now()
);

-- Como mucho 1 recompensa de racha y 1 de ranking por usuario y día (evita
-- doble cobro bajo llamadas concurrentes) — un sobre SÍ puede comprarse
-- varias veces el mismo día, por eso el índice es parcial (solo streak/ranking).
create unique index if not exists wallet_tx_once_per_day
  on public.wallet_transactions (user_id, day, reason)
  where reason in ('streak', 'ranking');

create table if not exists public.inventory (
  user_id     uuid not null references public.users (id) on delete cascade,
  category    text not null, -- 'color' | 'wing' | 'livery'
  piece_id    text not null, -- mismo id que car.js (CAR_COLORS/WING_SHAPES/LIVERY_PATTERNS)
  acquired_at timestamptz not null default now(),
  primary key (user_id, category, piece_id)
);

-- Catálogo de piezas sorteables (19: colores 12 premium, alerones 4, libreas
-- 3 premium). `hex` solo aplica a category='color': es el valor real que se
-- guarda en car_body_color/car_wing_color/car_livery (esas columnas guardan
-- el hex, no el id — para alerón/librea el id SÍ es directamente el valor
-- guardado). OJO: si se toca el catálogo de src/car.js, actualizar esta
-- semilla a mano (no hay generación automática entre los dos).
create table if not exists public.catalog_pieces (
  category text not null,
  piece_id text not null,
  rarity   text not null check (rarity in ('rara', 'epica', 'legendaria')),
  hex      text,
  primary key (category, piece_id)
);

insert into public.catalog_pieces (category, piece_id, rarity, hex) values
  ('color', 'morado_metalizado', 'rara', '#7a5ea8'),
  ('color', 'verde_metalizado',  'rara', '#3f7a52'),
  ('color', 'azul_metalizado',   'rara', '#3a6ea5'),
  ('color', 'rojo_metalizado',   'rara', '#a13f3f'),
  ('color', 'oro',     'epica', '#d4af37'),
  ('color', 'plata',   'epica', '#c0c0c0'),
  ('color', 'grafito', 'epica', '#5b5f66'),
  ('color', 'bronce',  'epica', '#8a5a34'),
  ('color', 'holografico_arcoiris',                 'legendaria', '#ff5c8a'),
  ('color', 'holografico_verde_amarillo_morado',    'legendaria', '#5ce87a'),
  ('color', 'holografico_rosa_cian_azul',           'legendaria', '#ff6fa8'),
  ('color', 'holografico_ambar_magenta_violeta',    'legendaria', '#ffb84d'),
  ('wing', 'cuello_cisne',  'rara', null),
  ('wing', 'gt',            'rara', null),
  ('wing', 'barrido',       'epica', null),
  ('wing', 'cola_de_pato',  'legendaria', null),
  ('livery', 'doble',    'rara', null),
  ('livery', 'diagonal', 'epica', null),
  ('livery', 'numero',   'legendaria', null)
on conflict (category, piece_id) do nothing;

alter table public.wallet              enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.inventory           enable row level security;
alter table public.catalog_pieces      enable row level security;

drop policy if exists wallet_select_self on public.wallet;
create policy wallet_select_self on public.wallet for select to authenticated using (auth.uid() = user_id);

drop policy if exists wallet_tx_select_self on public.wallet_transactions;
create policy wallet_tx_select_self on public.wallet_transactions for select to authenticated using (auth.uid() = user_id);

drop policy if exists inventory_select_self on public.inventory;
create policy inventory_select_self on public.inventory for select to authenticated using (auth.uid() = user_id);

drop policy if exists catalog_select_all on public.catalog_pieces;
create policy catalog_select_all on public.catalog_pieces for select to authenticated using (true);

-- Sin policies de insert/update en wallet/wallet_transactions/inventory:
-- se escriben SOLO vía las funciones de abajo, o vía el cron de ranking por
-- service_role (que salta RLS). catalog_pieces se siembra a mano arriba
-- (el owner del SQL editor salta RLS al ejecutar ahí directamente).

-- ----------------------------------------------------------------------------
--  save_loadout(): sustituye al UPDATE directo de saveLoadout() en api.js.
--  Valida que cada pieza no-libre venga de tu inventory antes de escribirla
--  — si no, cualquiera podría equiparse cualquier pieza premium con un
--  UPDATE directo por REST, sin pasar nunca por un sobre.
-- ----------------------------------------------------------------------------
create or replace function public.save_loadout(
  p_body_color text, p_wing_shape text, p_wing_color text,
  p_livery text, p_livery_pattern text, p_lights_color text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_free_colors text[] := array['#ffffff','#1a1a1c','#ffd23f','#ff5a1f','#ff5c5c','#4fa9ff','#3fae5c','#6b4a2f'];
  v_free_lights text[] := array['#fff6cf','#ffb84d'];
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;

  if not (p_body_color = any(v_free_colors) or exists(
    select 1 from public.catalog_pieces cp
    join public.inventory i on i.category = cp.category and i.piece_id = cp.piece_id
    where cp.category = 'color' and cp.hex = p_body_color and i.user_id = v_uid
  )) then raise exception 'PIECE_NOT_OWNED: body_color'; end if;

  if not (p_wing_shape = 'sin_aleron' or exists(
    select 1 from public.inventory where user_id = v_uid and category = 'wing' and piece_id = p_wing_shape
  )) then raise exception 'PIECE_NOT_OWNED: wing_shape'; end if;

  if not (p_wing_color = any(v_free_colors) or exists(
    select 1 from public.catalog_pieces cp
    join public.inventory i on i.category = cp.category and i.piece_id = cp.piece_id
    where cp.category = 'color' and cp.hex = p_wing_color and i.user_id = v_uid
  )) then raise exception 'PIECE_NOT_OWNED: wing_color'; end if;

  if p_livery is not null and not (p_livery = any(v_free_colors) or exists(
    select 1 from public.catalog_pieces cp
    join public.inventory i on i.category = cp.category and i.piece_id = cp.piece_id
    where cp.category = 'color' and cp.hex = p_livery and i.user_id = v_uid
  )) then raise exception 'PIECE_NOT_OWNED: livery_color'; end if;

  if not (p_livery_pattern = 'simple' or exists(
    select 1 from public.inventory where user_id = v_uid and category = 'livery' and piece_id = p_livery_pattern
  )) then raise exception 'PIECE_NOT_OWNED: livery_pattern'; end if;

  -- Faros: sin catálogo de desbloqueo esta fase (ver plan), "multicolor"
  -- se queda bloqueado para siempre por ahora — solo se aceptan los 2 libres.
  if not (p_lights_color = any(v_free_lights)) then
    raise exception 'PIECE_NOT_OWNED: lights_color';
  end if;

  update public.users set
    car_body_color = p_body_color,
    car_wing_shape = p_wing_shape,
    car_wing_color = p_wing_color,
    car_livery = p_livery,
    car_livery_pattern = p_livery_pattern,
    car_lights_color = p_lights_color
  where id = v_uid;
end;
$$;

grant execute on function public.save_loadout(text, text, text, text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
--  grant_daily_reward(): SIN argumento de fecha (una fecha inventada por el
--  cliente burlaría la idempotencia y permitiría granjear recompensas de
--  racha infinitas). Calcula su propio día en servidor e inserta la fila de
--  wallet_transactions con INSERT...ON CONFLICT DO NOTHING contra el índice
--  único de arriba — nunca "select exists, luego insert" (esa secuencia es
--  una carrera real bajo llamadas concurrentes).
-- ----------------------------------------------------------------------------
create or replace function public.grant_daily_reward()
returns table(granted boolean, amount int, new_balance int, free_pack boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_streak int;
  v_week_pos int;
  v_amount int;
  v_free boolean := false;
  v_rows int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select current_streak into v_streak from public.users where id = auth.uid();
  v_week_pos := ((coalesce(v_streak, 0) - 1) % 7) + 1;
  v_amount := case v_week_pos
    when 1 then 5 when 2 then 5
    when 3 then 10 when 4 then 10
    when 5 then 15 when 6 then 15
    else 20
  end;
  v_free := (v_week_pos = 7);

  insert into public.wallet_transactions (user_id, day, reason, amount)
  values (auth.uid(), v_day, 'streak', v_amount)
  on conflict (user_id, day, reason) where reason in ('streak', 'ranking') do nothing;
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    return query select false, 0, coalesce((select balance from public.wallet where user_id = auth.uid()), 0), false;
    return;
  end if;

  insert into public.wallet (user_id, balance, pending_packs)
  values (auth.uid(), v_amount, case when v_free then 1 else 0 end)
  on conflict (user_id) do update
    set balance = wallet.balance + excluded.balance,
        pending_packs = wallet.pending_packs + excluded.pending_packs,
        updated_at = now();

  return query select true, v_amount, (select balance from public.wallet where user_id = auth.uid()), v_free;
end;
$$;

grant execute on function public.grant_daily_reward() to authenticated;

-- ----------------------------------------------------------------------------
--  open_pack(): cada rama (gratis/de pago) es UNA sentencia UPDATE
--  condicional (nunca "leer saldo, luego escribir aparte" — esa secuencia es
--  la misma carrera de doble gasto de arriba). El roll de rareza se guarda en
--  una variable una sola vez: llamar random() por separado en cada rama de
--  una comparación re-tira en cada una y descuadra las probabilidades.
-- ----------------------------------------------------------------------------
create or replace function public.open_pack(p_source text default 'paid')
returns table(category text, piece_id text, rarity text, new_balance int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_roll numeric;
  v_tier text;
  v_cat text;
  v_piece text;
  v_rarity text;
  v_balance int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_source not in ('free', 'paid') then raise exception 'INVALID_SOURCE'; end if;

  if p_source = 'free' then
    update public.wallet set pending_packs = pending_packs - 1
      where user_id = auth.uid() and pending_packs >= 1;
    if not found then raise exception 'NO_PENDING_PACK'; end if;
  else
    update public.wallet set balance = balance - 125, updated_at = now()
      where user_id = auth.uid() and balance >= 125;
    if not found then raise exception 'INSUFFICIENT_FUNDS'; end if;
    insert into public.wallet_transactions (user_id, day, reason, amount)
      values (auth.uid(), (now() at time zone 'utc')::date, 'pack_open', -125);
  end if;

  v_roll := random();
  v_tier := case when v_roll < 0.05 then 'legendaria' when v_roll < 0.35 then 'epica' else 'rara' end;

  select c.category, c.piece_id, c.rarity into v_cat, v_piece, v_rarity
  from public.catalog_pieces c
  where c.rarity = v_tier
    and not exists (
      select 1 from public.inventory i
      where i.user_id = auth.uid() and i.category = c.category and i.piece_id = c.piece_id
    )
  order by random() limit 1;

  -- Rareza agotada: cae a cualquier pieza que te falte, de cualquier tier
  -- (a partir de aquí el sorteo deja de respetar 65/30/5 — aceptado, es
  -- mejor que no darte nada).
  if v_piece is null then
    select c.category, c.piece_id, c.rarity into v_cat, v_piece, v_rarity
    from public.catalog_pieces c
    where not exists (
      select 1 from public.inventory i
      where i.user_id = auth.uid() and i.category = c.category and i.piece_id = c.piece_id
    )
    order by random() limit 1;
  end if;

  if v_piece is null then raise exception 'COLLECTION_COMPLETE'; end if;

  insert into public.inventory (user_id, category, piece_id) values (auth.uid(), v_cat, v_piece);
  select balance into v_balance from public.wallet where user_id = auth.uid();

  return query select v_cat, v_piece, v_rarity, v_balance;
end;
$$;

grant execute on function public.open_pack(text) to authenticated;

-- ----------------------------------------------------------------------------
--  credit_wallet(): la ÚNICA función de todo el sistema que acepta un
--  user_id por parámetro en vez de identificar por auth.uid() — porque la
--  llama el cron de cierre de ranking (close-ranking-rewards) por
--  service_role, sin JWT de usuario. Por eso es crítico que jamás se
--  conceda a `authenticated`: si se pudiera llamar como usuario normal,
--  cualquiera podría regalarse (o regalar) saldo a cualquier cuenta.
-- ----------------------------------------------------------------------------
create or replace function public.credit_wallet(p_user_id uuid, p_amount int, p_day date, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int;
begin
  if p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_reason <> 'ranking' then raise exception 'INVALID_REASON'; end if;

  insert into public.wallet_transactions (user_id, day, reason, amount)
  values (p_user_id, p_day, p_reason, p_amount)
  on conflict (user_id, day, reason) where reason in ('streak', 'ranking') do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return; end if;

  insert into public.wallet (user_id, balance) values (p_user_id, p_amount)
  on conflict (user_id) do update set balance = wallet.balance + excluded.balance, updated_at = now();
end;
$$;

revoke execute on function public.credit_wallet(uuid, int, date, text) from public, anon, authenticated;
grant execute on function public.credit_wallet(uuid, int, date, text) to service_role;
