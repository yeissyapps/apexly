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

    const { data: attempts, error } = await admin
      .from('attempts')
      .select('user_id, best_ms')
      .eq('day', yesterday)
      .order('best_ms', { ascending: true });
    if (error) return json({ error: error.message }, 500);
    if (!attempts || attempts.length === 0) return json({ day: yesterday, rewarded: 0 });

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
