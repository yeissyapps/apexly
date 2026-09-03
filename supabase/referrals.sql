-- ============================================================================
--  Circuito Diario — Códigos de invitación entre amigos.
--
--  Pégalo en Supabase > SQL Editor > Run (después de economy.sql, que es de
--  donde viene wallet/wallet_transactions).
--
--  Por qué existe: JC, sobre el crecimiento de la app — "a la gente le gusta
--  el concepto pero no aumentan los jugadores". El enlace de "compartir vuelta"
--  (retoLink en links.js) no puede premiar a quien se instala por él: pasa
--  por un redirector a la tienda que no lleva ningún dato, y la tienda no
--  devuelve nada a la app en la primera apertura (sin dominio propio no hay
--  App Links/Universal Links). Un código que el jugador copia y pasa A MANO,
--  y que el amigo escribe él mismo en la Tienda, esquiva ese agujero entero
--  sin necesitar ninguna infraestructura de atribución nueva.
--
--  Modelo, decidido con JC:
--    - Cada jugador tiene un código propio, PERMANENTE — no se apaga al
--      usarlo, sirve para tantos amigos distintos como quiera repartirlo.
--    - Cada CUENTA puede canjear un código ajeno como mucho UNA VEZ EN SU
--      VIDA (nunca el suyo propio) — así no se puede farmear monedas
--      entrando códigos en bucle. Esa es la unicidad real, no el código.
--    - Recompensa igual a los dos lados al canjear: quien invita Y quien
--      entra se llevan REFERRAL_BONUS cada uno.
--
--  Todo el estado se escribe SOLO por la RPC de abajo (security definer),
--  mismo patrón que credit_wallet en economy.sql — nunca INSERT/UPDATE
--  directo del cliente contra wallet ni wallet_transactions.
-- ============================================================================

alter table public.users add column if not exists referral_code text unique;

create table if not exists public.referrals (
  id          bigint generated always as identity primary key,
  referrer_id uuid not null references public.users (id) on delete cascade,
  -- unique: la unicidad real de "una redención por cuenta en toda su vida"
  -- vive aquí, no en ningún contador aparte.
  redeemed_by uuid not null unique references public.users (id) on delete cascade,
  code_used   text not null,
  created_at  timestamptz not null default now()
);

alter table public.referrals enable row level security;

-- Cada uno ve solo las filas donde participa (como quien invita o como quien
-- entró) — nunca la lista completa de quién invitó a quién.
create policy referrals_select_own on public.referrals
  for select using (auth.uid() = redeemed_by or auth.uid() = referrer_id);

-- wallet_transactions.reason (economy.sql) solo admitía streak/ranking/
-- pack_open — se amplía para el nuevo motivo.
alter table public.wallet_transactions drop constraint if exists wallet_transactions_reason_check;
alter table public.wallet_transactions add constraint wallet_transactions_reason_check
  check (reason in ('streak', 'ranking', 'pack_open', 'referral'));

-- Devuelve el código propio, generándolo la primera vez que se pide. 6
-- caracteres, sin 0/O/1/I/L (charset pensado para escribirse a mano sin
-- ambigüedad, no para copiar/pegar).
create or replace function public.get_or_create_referral_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_code    text;
  v_charset text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_try     int := 0;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  select referral_code into v_code from public.users where id = v_uid;
  if v_code is not null then return v_code; end if;

  loop
    v_try := v_try + 1;
    if v_try > 20 then raise exception 'CODE_GEN_FAILED'; end if;
    select string_agg(substr(v_charset, (floor(random() * length(v_charset)) + 1)::int, 1), '')
      into v_code
      from generate_series(1, 6);
    begin
      update public.users set referral_code = v_code where id = v_uid;
      return v_code;
    exception when unique_violation then
      -- Colisión de código (muy improbable con 6 chars de un charset de 32,
      -- pero barato de manejar) — prueba otra vez con un código distinto.
    end;
  end loop;
end;
$$;

grant execute on function public.get_or_create_referral_code() to authenticated;

-- Canjea el código de otro jugador. REFERRAL_BONUS para los dos, una sola
-- vez en la vida de la cuenta que canjea (ver el unique de arriba).
create or replace function public.redeem_referral_code(p_code text)
returns table (bonus int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_referrer uuid;
  -- Ajustable aquí, en un solo sitio. 125 = 1 sobre; 50 es ~40%, notable sin
  -- volar la economía (para comparar: racha/ranking dan 10-30, compartir 5).
  v_bonus    constant int := 50;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  select id into v_referrer from public.users where referral_code = upper(trim(p_code));
  if v_referrer is null then raise exception 'CODE_NOT_FOUND'; end if;
  if v_referrer = v_uid then raise exception 'CANNOT_REDEEM_OWN_CODE'; end if;

  begin
    insert into public.referrals (referrer_id, redeemed_by, code_used)
    values (v_referrer, v_uid, upper(trim(p_code)));
  exception when unique_violation then
    raise exception 'ALREADY_REDEEMED';
  end;

  insert into public.wallet_transactions (user_id, day, reason, amount)
  values (v_uid, current_date, 'referral', v_bonus);
  insert into public.wallet (user_id, balance) values (v_uid, v_bonus)
    on conflict (user_id) do update set balance = wallet.balance + excluded.balance, updated_at = now();

  insert into public.wallet_transactions (user_id, day, reason, amount)
  values (v_referrer, current_date, 'referral', v_bonus);
  insert into public.wallet (user_id, balance) values (v_referrer, v_bonus)
    on conflict (user_id) do update set balance = wallet.balance + excluded.balance, updated_at = now();

  return query select v_bonus;
end;
$$;

grant execute on function public.redeem_referral_code(text) to authenticated;
