-- ============================================================================
--  Duelos 1vs1 — v2 (correr DESPUÉS de duels.sql; se puede repetir sin daño)
--
--  1. create_duel ahora comprueba el saldo. Antes no miraba la cartera: se
--     podía retar por 15 con 15 monedas... o por 1000 con 15. La apuesta se
--     sigue cobrando solo al ACEPTAR (accept_duel), pero no se deja lanzar un
--     reto que uno no podría pagar. Los retos que uno ya tiene pendientes de
--     respuesta cuentan como comprometidos, para no poder lanzar cinco retos
--     de 15 a la vez con 15 monedas.
--  2. cancel_duel: el retador puede retirar un reto que aún no han aceptado.
--     Sin esto, un reto enviado a alguien que no responde bloqueaba el 1vs1
--     entre los dos durante 10 minutos sin forma de salir.
-- ============================================================================

-- Nuevo estado 'cancelled'. Se busca la restricción por su contenido y no por
-- nombre, por si en Supabase quedó con otro distinto al que da Postgres.
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.duels'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%status%'
  loop
    execute format('alter table public.duels drop constraint %I', c.conname);
  end loop;
end;
$$;

alter table public.duels
  add constraint duels_status_check
  check (status in ('pending', 'accepted', 'declined', 'expired', 'finished', 'cancelled'));

create or replace function public.create_duel(p_opponent_id uuid, p_wager int)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_balance int;
  v_committed int;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_opponent_id = auth.uid() then raise exception 'CANNOT_CHALLENGE_SELF'; end if;
  if p_wager is null or p_wager <= 0 then raise exception 'INVALID_WAGER'; end if;
  if not exists (select 1 from public.users where id = p_opponent_id) then
    raise exception 'OPPONENT_NOT_FOUND';
  end if;

  if exists (
    select 1 from public.duels
    where status in ('pending', 'accepted')
      and (
        (challenger_id = auth.uid() and opponent_id = p_opponent_id)
        or (challenger_id = p_opponent_id and opponent_id = auth.uid())
      )
  ) then
    raise exception 'DUEL_ALREADY_PENDING';
  end if;

  select coalesce(balance, 0) into v_balance from public.wallet where user_id = auth.uid();
  select coalesce(sum(wager), 0) into v_committed
  from public.duels
  where challenger_id = auth.uid() and status = 'pending' and accept_deadline > now();

  if coalesce(v_balance, 0) - v_committed < p_wager then
    raise exception 'INSUFFICIENT_FUNDS';
  end if;

  insert into public.duels (challenger_id, opponent_id, wager, status, accept_deadline)
  values (auth.uid(), p_opponent_id, p_wager, 'pending', now() + interval '10 minutes')
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_duel(uuid, int) from public;
grant execute on function public.create_duel(uuid, int) to authenticated;

create or replace function public.cancel_duel(p_duel_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_duel public.duels;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_duel from public.duels where id = p_duel_id for update;
  if not found then raise exception 'DUEL_NOT_FOUND'; end if;
  if v_duel.challenger_id <> auth.uid() then raise exception 'NOT_YOUR_DUEL'; end if;
  if v_duel.status <> 'pending' then raise exception 'DUEL_NOT_PENDING'; end if;

  update public.duels set status = 'cancelled' where id = p_duel_id;
end;
$$;

revoke all on function public.cancel_duel(uuid) from public;
grant execute on function public.cancel_duel(uuid) to authenticated;
