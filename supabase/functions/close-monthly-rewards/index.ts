// ============================================================================
//  Edge Function: close-monthly-rewards
//
//  Igual que close-ranking-rewards pero UNA VEZ AL MES (cron aparte, ver
//  close-monthly-rewards-cron.sql), sin JWT de usuario, service_role.
//
//  Cierra el MES ANTERIOR (UTC) y reparte monedas por percentil de la
//  clasificación mensual — mismo criterio de puntos y de bandas que ya pinta
//  RankingTab.js/api.js en el cliente (pointsForDailyRank + bandValue):
//  cada día jugado del mes reparte puntos F1 (25-18-15…) al 50% mejor de ESE
//  día, se suman todos los días, y la clasificación final por puntos se
//  reparte en 10 bandas del 5% con COIN_BANDS (500…20). Duplicado aquí a
//  propósito — Deno no puede importar el bundle de RN, mismo motivo por el
//  que gp-tick ya duplica F1_POINTS y el cálculo de vuelta rápida.
//
//  La idempotencia REAL vive en el índice único parcial de
//  wallet_transactions (dentro de credit_wallet, reason='monthly'), así que
//  da igual si esta función se dispara dos veces — el chequeo de abajo es
//  solo un atajo para no releer todo el mes si ya se sabe que no hace falta.
//  `day` para credit_wallet es el PRIMER día del mes cerrado (determinista,
//  no depende de cuándo dispara el cron).
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const F1_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const COIN_BANDS = [500, 360, 300, 240, 200, 160, 120, 80, 40, 20];
const BATCH_SIZE = 20;

// Ver bandValue en src/api.js — misma cuenta entera (sin dividir por 0.05)
// para no desplazar jugadores a la banda vecina por redondeo binario.
function bandValue(rank: number, totalPlayers: number, tiers: number[]): number {
  const band = Math.floor(((rank - 1) * 20) / totalPlayers);
  return band < tiers.length ? tiers[band] : 0;
}

Deno.serve(async (_req) => {
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, service);

    // "Ahora" cae en el mes NUEVO (el cron dispara el día 1) — el mes
    // cerrado es el anterior. Todo en UTC, igual que close-ranking-rewards.
    const now = new Date();
    const thisMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const closedMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const startKey = closedMonthStart.toISOString().slice(0, 10);
    const endKey = thisMonthStart.toISOString().slice(0, 10);

    const { count: already } = await admin
      .from('wallet_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('day', startKey)
      .eq('reason', 'monthly');
    if (already && already > 0) return json({ skipped: true, month: startKey });

    // Paginado a propósito — mismo motivo que close-ranking-rewards: sin
    // esto, un mes con más de 1000 partidas se agregaría sobre una lista
    // TRUNCADA. Aquí además el orden estable por (day, best_ms, user_id)
    // importa para que la agrupación por día sea correcta.
    let attempts: { user_id: string; day: string; best_ms: number }[];
    try {
      attempts = await fetchAll((from, to) =>
        admin
          .from('attempts')
          .select('user_id, day, best_ms', { count: 'exact' })
          .gte('day', startKey)
          .lt('day', endKey)
          .order('day', { ascending: true })
          .order('best_ms', { ascending: true })
          .order('user_id', { ascending: true })
          .range(from, to)
      );
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
    if (attempts.length === 0) return json({ month: startKey, rewarded: 0 });

    const byDay = new Map<string, typeof attempts>();
    for (const a of attempts) {
      const arr = byDay.get(a.day);
      if (arr) arr.push(a); else byDay.set(a.day, [a]);
    }

    const points = new Map<string, number>();
    const daysPlayed = new Map<string, number>();
    for (const dayRows of byDay.values()) {
      // Ya viene ordenado por best_ms desde la consulta (orden estable por
      // día), no hace falta volver a ordenar aquí.
      const n = dayRows.length;
      dayRows.forEach((a, i) => {
        points.set(a.user_id, (points.get(a.user_id) ?? 0) + bandValue(i + 1, n, F1_POINTS));
        daysPlayed.set(a.user_id, (daysPlayed.get(a.user_id) ?? 0) + 1);
      });
    }

    // Mismo desempate que el cliente (getMonthlyRanking en api.js): a
    // igualdad de puntos, gana quien ha jugado más días.
    const standing = [...points.keys()].sort((u1, u2) =>
      (points.get(u2)! - points.get(u1)!) || (daysPlayed.get(u2)! - daysPlayed.get(u1)!)
    );

    const total = standing.length;
    const credits = standing
      .map((userId, i) => ({ userId, coins: bandValue(i + 1, total, COIN_BANDS) }))
      .filter((c) => c.coins > 0);

    let rewarded = 0;
    for (let i = 0; i < credits.length; i += BATCH_SIZE) {
      const batch = credits.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map((c) =>
        admin.rpc('credit_wallet', { p_user_id: c.userId, p_amount: c.coins, p_day: startKey, p_reason: 'monthly' })
          .then(() => { rewarded += 1; })
          .catch(() => {})
      ));
    }

    return json({ month: startKey, totalPlayers: total, rewarded });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Trae TODAS las filas de una consulta, página a página — ver el mismo
// helper en close-ranking-rewards/index.ts para la explicación completa.
async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null; count: number | null }>): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  let total = Infinity;
  let from = 0;
  while (out.length < total) {
    const { data, error, count } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (count != null) total = count;
    if (!data || data.length === 0) break;
    out.push(...data);
    from += data.length;
  }
  return out;
}
