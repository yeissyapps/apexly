// ============================================================================
//  Edge Function: gp-tick
//
//  Disparada por cron cada ~15 min (gp-tick-cron.sql) — a diferencia de
//  daily-reminder/close-ranking-rewards (una vez al día, hora fija UTC), un
//  Grand Prix arranca a la hora que decida cada grupo, así que hay que
//  comprobar con frecuencia si a alguno le toca abrir ronda, avisar de
//  última llamada, o cerrar.
//
//  Sin JWT de usuario (como daily-reminder): usa service_role para leer/
//  escribir todo. Idempotencia real vía gp_notify_log (unique gp_id+kind+
//  day_index) — el chequeo de tiempo es solo para no reprocesar de más, la
//  garantía de "no se manda dos veces" es la tabla, igual que ya se explica
//  en close-ranking-rewards.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const DAY_MS = 24 * 60 * 60 * 1000;
const LAST_CHANCE_WINDOW_MS = 2 * 60 * 60 * 1000; // últimas 2h de la ronda
const F1_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

Deno.serve(async (_req) => {
  const url = Deno.env.get('SUPABASE_URL')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(url, service);

  const { data: gps, error } = await admin
    .from('grand_prix').select('id, group_id, started_at, circuit_count').eq('status', 'active');
  if (error) return json({ error: error.message }, 500);
  if (!gps || gps.length === 0) return json({ checked: 0 });

  let roundOpenSent = 0, lastChanceSent = 0, finishedSent = 0;

  for (const gp of gps) {
    const startedAt = new Date(gp.started_at).getTime();
    const now = Date.now();
    const roundIdx = Math.max(1, Math.min(gp.circuit_count, Math.floor((now - startedAt) / DAY_MS) + 1));
    const roundCloseAt = startedAt + roundIdx * DAY_MS;
    const gpEndsAt = startedAt + gp.circuit_count * DAY_MS;

    const { data: members } = await admin.from('group_members').select('user_id').eq('group_id', gp.group_id);
    const memberIds = (members ?? []).map((m) => m.user_id);
    if (memberIds.length === 0) continue;

    // --- GP terminado -------------------------------------------------------
    if (now >= gpEndsAt) {
      const { data: closed } = await admin
        .from('grand_prix').update({ status: 'finished' }).eq('id', gp.id).eq('status', 'active').select('id');
      if (closed && closed.length > 0) {
        const sent = await notifyIfNew(admin, gp.id, 'finished', 0, async () => {
          const { data: results } = await admin.from('gp_results').select('day_index, user_id, ms').eq('gp_id', gp.id);
          const { data: users } = await admin.from('users').select('id, nickname').in('id', memberIds);
          const names = new Map((users ?? []).map((u) => [u.id, u.nickname]));
          const standing = computeStandings(results ?? [], memberIds, names);
          const podium = standing.slice(0, 3).map((s, i) => `${i + 1}. ${s.nickname} (${s.points})`).join(' · ');
          return pushToUsers(admin, memberIds, 'Apexly · Grand Prix', `¡Terminado! ${podium || 'Sin resultados esta vez.'}`);
        });
        if (sent) finishedSent++;
      }
      continue; // un GP recién cerrado no necesita más avisos en este tick
    }

    // --- Ronda nueva abierta (a partir de la 2ª) -----------------------------
    if (roundIdx >= 2) {
      const roundOpenAt = startedAt + (roundIdx - 1) * DAY_MS;
      if (now - roundOpenAt < 20 * 60 * 1000) { // se acaba de abrir (margen para el intervalo del cron)
        const sent = await notifyIfNew(admin, gp.id, 'round_open', roundIdx, () =>
          pushToUsers(admin, memberIds, 'Apexly · Grand Prix', `Circuito ${roundIdx}/${gp.circuit_count} ya disponible.`)
        );
        if (sent) roundOpenSent++;
      }
    }

    // --- Última llamada de la ronda en curso --------------------------------
    if (roundCloseAt - now <= LAST_CHANCE_WINDOW_MS) {
      const { data: already } = await admin
        .from('gp_results').select('user_id').eq('gp_id', gp.id).eq('day_index', roundIdx);
      const doneIds = new Set((already ?? []).map((r) => r.user_id));
      const pendingIds = memberIds.filter((id) => !doneIds.has(id));
      if (pendingIds.length > 0) {
        const sent = await notifyIfNew(admin, gp.id, 'last_chance', roundIdx, () =>
          pushToUsers(admin, pendingIds, 'Apexly · Grand Prix', `Últimas horas para clasificar en el circuito de hoy.`)
        );
        if (sent) lastChanceSent++;
      }
    }
  }

  return json({ checked: gps.length, roundOpenSent, lastChanceSent, finishedSent });
});

// Inserta el log ANTES de mandar (si ya existe, unique_violation -> no se
// manda dos veces aunque el cron se solape). `send` solo se llama si el
// insert tuvo éxito.
async function notifyIfNew(admin: any, gpId: string, kind: string, dayIndex: number, send: () => Promise<void>) {
  const { error } = await admin.from('gp_notify_log').insert({ gp_id: gpId, kind, day_index: dayIndex });
  if (error) return false; // ya estaba (unique_violation) u otro fallo -> no se manda
  await send();
  return true;
}

async function pushToUsers(admin: any, userIds: string[], title: string, body: string) {
  const { data: toks } = await admin.from('push_tokens').select('token').in('user_id', userIds);
  const seen = new Set<string>();
  const messages = (toks ?? [])
    .filter((t: any) => t.token && !seen.has(t.token) && seen.add(t.token))
    .map((t: any) => ({ to: t.token, sound: 'default', title, body }));
  if (messages.length === 0) return;
  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(messages),
  });
}

function computeStandings(results: { day_index: number; user_id: string; ms: number }[], memberIds: string[], names: Map<string, string>) {
  const byUser = new Map<string, { userId: string; nickname: string; points: number }>();
  for (const id of memberIds) byUser.set(id, { userId: id, nickname: names.get(id) ?? '—', points: 0 });
  const byDay = new Map<number, typeof results>();
  for (const r of results) {
    if (!byDay.has(r.day_index)) byDay.set(r.day_index, []);
    byDay.get(r.day_index)!.push(r);
  }
  for (const rows of byDay.values()) {
    const sorted = [...rows].sort((a, b) => a.ms - b.ms);
    sorted.forEach((r, i) => {
      const u = byUser.get(r.user_id);
      if (u) u.points += F1_POINTS[i] || 0;
    });
  }
  return [...byUser.values()].sort((a, b) => b.points - a.points);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
