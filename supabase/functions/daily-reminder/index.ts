// ============================================================================
//  Edge Function: daily-reminder
//
//  A diferencia de notify-overtakes (la dispara el cliente al acabar una
//  vuelta), esta la dispara SOLA una tarea programada (pg_cron, ver
//  supabase/daily-reminder-cron.sql) — no hay JWT de usuario, se usa
//  service_role para leerlo todo.
//
//  A las ~20:00 (hora de España), avisa a TODO el que tenga push registrado
//  y NO haya jugado hoy. "Hoy" se compara contra la fecha del servidor
//  (UTC) — el `day` que guarda cada intento es la fecha LOCAL del jugador en
//  el momento de jugar (mismo criterio que usa el circuito diario), así que
//  cerca de medianoche puede haber algún desfase de una franja horaria; para
//  el tamaño de grupo de esta app es una simplificación aceptable, igual que
//  ya se aceptó para el cambio de circuito.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (_req) => {
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, service);

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

    // Todos los que YA jugaron hoy (para excluirlos).
    const { data: played } = await admin.from('attempts').select('user_id').eq('day', today);
    const playedIds = new Set((played ?? []).map((p) => p.user_id));

    // Todos los tokens de push registrados.
    const { data: toks, error: etok } = await admin.from('push_tokens').select('user_id, token');
    if (etok) return json({ error: etok.message }, 500);

    // Un mismo dispositivo puede tener varias filas (una por cada identidad
    // anónima que dejó atrás, p. ej. al reinstalar la app en pruebas) — todas
    // con el mismo token físico, porque push_tokens tiene user_id como clave
    // primaria y `token` SIN unicidad.
    //
    // Por eso el "¿ha jugado?" se decide por TOKEN y no por fila. Un aviso se
    // manda a un DISPOSITIVO, así que basta con que UNA de las identidades de
    // ese móvil haya jugado hoy para que no haya nada que recordar.
    //
    // Antes esto se filtraba fila a fila (`playedIds.has(t.user_id)`) y se
    // deduplicaba DESPUÉS: si la identidad vieja —que no juega nunca— salía
    // antes en la consulta, se quedaba ella con el token, la identidad buena
    // se descartaba por duplicada y el aviso salía igualmente. Como el orden
    // de las filas lo decide Postgres, el fallo era intermitente y parecía
    // cosa de iOS, cuando en realidad pasaba en las dos plataformas.
    const playedTokens = new Set<string>();
    for (const t of toks ?? []) {
      if (t.token && playedIds.has(t.user_id)) playedTokens.add(t.token);
    }

    const seenTokens = new Set<string>();
    const pending = (toks ?? []).filter((t) => {
      if (!t.token || playedTokens.has(t.token)) return false;
      if (seenTokens.has(t.token)) return false;
      seenTokens.add(t.token);
      return true;
    });
    if (pending.length === 0) return json({ sent: 0, debug: { tokens: (toks ?? []).length, played: playedIds.size } });

    const messages = pending.map((t) => ({
      to: t.token,
      title: 'Apexly',
      body: 'Hoy no has pisado el asfalto. Tu grupo no te va a esperar.',
      sound: 'default',
    }));

    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });

    return json({ sent: messages.length });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
