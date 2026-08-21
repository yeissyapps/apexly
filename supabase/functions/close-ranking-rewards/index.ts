// ============================================================================
//  Edge Function: close-ranking-rewards
//
//  Igual que daily-reminder: la dispara SOLA una tarea programada (pg_cron,
//  ver supabase/close-ranking-rewards-cron.sql), sin JWT de usuario, con
//  service_role para leer/escribir todo.
//
//  Cierra el día ANTERIOR (ayer, UTC) y reparte monedas de ranking por
//  tercio de posición: top 30, medio 20, cola 10 — con mínimo garantizado de
//  1 jugador en los extremos (Math.max(1, round(N/3))), recortado para que
//  con muy pocos jugadores el top y la cola no se solapen (Math.min contra
//  N - topCount). "Ayer" se calcula en UTC; attempts.day se guarda en fecha
//  LOCAL del dispositivo (todayKey()) — mismo desfase ya aceptado en
//  daily-reminder (ver su comentario), aquí con la cautela extra de
//  programar el cron bien pasada la medianoche de España (ver el .sql).
//
//  La idempotencia REAL vive en el índice único parcial de
//  wallet_transactions (dentro de credit_wallet), así que da igual si esta
//  función se dispara dos veces — el chequeo de abajo es solo un atajo para
//  no releer attempts si ya se sabe que hoy no hace falta.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TOP_AMOUNT = 30;
const MID_AMOUNT = 20;
const BOTTOM_AMOUNT = 10;
const BATCH_SIZE = 20;

Deno.serve(async (_req) => {
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, service);

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const { count: already } = await admin
      .from('wallet_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('day', yesterday)
      .eq('reason', 'ranking');
    if (already && already > 0) return json({ skipped: true, day: yesterday });

    // Paginado a proposito: PostgREST corta la respuesta en el tope de filas
    // del proyecto (1000 por defecto en Supabase). Sin esto, en cuanto se
    // pasen las 1000 partidas en un dia los tercios se calcularian sobre una
    // lista TRUNCADA y la gente cobraria lo que no le toca, sin ningun error
    // visible. El desempate por user_id es imprescindible: ordenar solo por
    // best_ms deja las paginas inestables cuando hay tiempos repetidos, y se
    // colarian filas duplicadas o perdidas entre pagina y pagina.
    let attempts: { user_id: string; best_ms: number }[];
    try {
      attempts = await fetchAll((from, to) =>
        admin
          .from('attempts')
          .select('user_id, best_ms', { count: 'exact' })
          .eq('day', yesterday)
          .order('best_ms', { ascending: true })
          .order('user_id', { ascending: true })
          .range(from, to)
      );
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
    if (attempts.length === 0) return json({ day: yesterday, rewarded: 0 });

    const n = attempts.length;
    const topCount = Math.max(1, Math.round(n / 3));
    const bottomCount = Math.min(Math.max(1, Math.round(n / 3)), n - topCount);

    const credits = attempts.map((a, i) => {
      const amount = i < topCount ? TOP_AMOUNT : i >= n - bottomCount ? BOTTOM_AMOUNT : MID_AMOUNT;
      return { user_id: a.user_id, amount };
    });

    let rewarded = 0;
    for (let i = 0; i < credits.length; i += BATCH_SIZE) {
      const batch = credits.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map((c) =>
        admin.rpc('credit_wallet', { p_user_id: c.user_id, p_amount: c.amount, p_day: yesterday, p_reason: 'ranking' })
          .then(() => { rewarded += 1; })
          .catch(() => {})
      ));
    }

    return json({ day: yesterday, total: n, rewarded });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Trae TODAS las filas de una consulta, pagina a pagina.
//
// Avanza por lo realmente recibido y no por el tamano de pagina pedido, y usa
// el `count` exacto como condicion de parada. Asi funciona igual sea cual sea
// el tope de filas configurado en el proyecto: si el servidor devuelve menos
// de lo pedido porque lo ha recortado, el bucle sigue desde donde toca en vez
// de creerse que ya no hay mas.
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
