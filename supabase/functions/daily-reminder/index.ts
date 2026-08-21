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

    // Las dos lecturas van PAGINADAS: PostgREST corta la respuesta en el tope
    // de filas del proyecto (1000 por defecto en Supabase), y aqui truncar es
    // especialmente traicionero — un jugador que se quede fuera de la lista de
    // "ya jugaron" recibe el recordatorio despues de haber jugado, que es
    // justo el fallo que esta funcion acaba de arreglar por otro lado.
    //
    // `push_tokens` crece mas rapido de lo que parece: cada reinstalacion deja
    // una fila huerfana pegada al mismo movil (ver mas abajo), asi que la
    // tabla puede tener varias veces mas filas que jugadores reales.
    let played: { user_id: string }[];
    let toks: { user_id: string; token: string }[];
    try {
      played = await fetchAll((from, to) =>
        admin.from('attempts').select('user_id', { count: 'exact' })
          .eq('day', today).order('user_id', { ascending: true }).range(from, to)
      );
      toks = await fetchAll((from, to) =>
        admin.from('push_tokens').select('user_id, token', { count: 'exact' })
          .order('user_id', { ascending: true }).range(from, to)
      );
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
    const playedIds = new Set(played.map((p) => p.user_id));

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
    const pending = toks.filter((t) => {
      if (!t.token || playedTokens.has(t.token)) return false;
      if (seenTokens.has(t.token)) return false;
      seenTokens.add(t.token);
      return true;
    });
    if (pending.length === 0) return json({ sent: 0, debug: { tokens: toks.length, played: playedIds.size } });

    const messages = pending.map((t) => ({
      to: t.token,
      title: 'Apexly',
      body: 'Hoy no has pisado el asfalto. Tu grupo no te va a esperar.',
      sound: 'default',
    }));

    // La API de Expo admite 100 notificaciones por peticion. Esta funcion es
    // la unica que escribe a TODO el mundo a la vez, asi que es la primera que
    // se va a pasar de ahi; mandarlo todo de golpe empezaria a fallar en
    // silencio justo cuando la app crezca.
    const EXPO_MAX = 100;
    for (let i = 0; i < messages.length; i += EXPO_MAX) {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messages.slice(i, i + EXPO_MAX)),
      });
    }

    return json({ sent: messages.length });
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
