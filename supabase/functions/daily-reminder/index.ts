// ============================================================================
//  Edge Function: daily-reminder
//
//  A diferencia de notify-overtakes (la dispara el cliente al acabar una
//  vuelta), esta la dispara SOLA una tarea programada (pg_cron, ver
//  supabase/daily-reminder-cron.sql) — no hay JWT de usuario, se usa
//  service_role para leerlo todo.
//
//  A las 20:00 HORA DE ESPAÑA, avisa a TODO el que tenga push registrado y
//  NO haya jugado hoy. "Hoy" es la fecha de España, que es la que guarda
//  `attempts.day` para casi todos los jugadores (fecha LOCAL del móvil).
//
//  Cambio de hora (auditoría, 2026-10-05): pg_cron va en UTC y no sabe de
//  horario de verano, así que con '0 18 * * *' fijo el aviso pasaba a llegar
//  a las 19:00 en invierno. Ahora el cron la llama a las 18:00 Y a las 19:00
//  UTC (daily-reminder-dst.sql) y la función solo actúa en la llamada que cae
//  en las 20:00 de Madrid — sirve todo el año sin tocar nada.
//
//  Una sola vez al día: la función se puede invocar con la clave pública
//  (como cualquier Edge Function de este proyecto), así que sin un cerrojo
//  cualquiera podía dispararla en bucle y mandar el aviso a todo el mundo
//  una y otra vez. `reminder_runs` (clave = día) lo impide.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { pushText } from '../_shared/push.ts';

const TZ = 'Europe/Madrid';

function madridParts(d: Date) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(d));
  return { day, hour };
}

Deno.serve(async (_req) => {
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, service);

    const now = new Date();
    const { day: today, hour } = madridParts(now);
    if (hour !== 20) return json({ skipped: 'no son las 20:00 en Madrid', hour });

    // Cerrojo de una vez al día (ver cabecera). Clave primaria: el segundo
    // intento del mismo día choca con 23505 y se sale sin mandar nada.
    const { error: lockErr } = await admin.from('reminder_runs').insert({ day: today });
    // Cualquier otro fallo del cerrojo (p. ej. la tabla aún no existe porque
    // daily-reminder-dst.sql no se ha corrido) NO frena el envío: mejor un
    // aviso repetido que ninguno.
    if (lockErr && lockErr.code === '23505') return json({ skipped: 'ya enviado hoy' });

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
    let toks: { user_id: string; token: string; lang?: string }[];
    const tokensWith = (cols: string) => fetchAll((from, to) =>
      admin.from('push_tokens').select(cols, { count: 'exact' })
        .order('user_id', { ascending: true }).range(from, to)
    );
    try {
      played = await fetchAll((from, to) =>
        admin.from('attempts').select('user_id', { count: 'exact' })
          .eq('day', today).order('user_id', { ascending: true }).range(from, to)
      );
      // Con idioma si ya existe la columna (push_lang.sql); si no, como antes.
      try { toks = await tokensWith('user_id, token, lang'); } catch (_) { toks = await tokensWith('user_id, token'); }
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

    // Racha en juego: quien corrió AYER y tiene racha >= 2 la pierde esta
    // noche si no corre. `last_played` lo escribe bump_streak con la fecha
    // UTC; a las 20:00 de Madrid (18-19 UTC) el día UTC y el de Madrid son
    // el mismo, así que "ayer" vale para los dos.
    const yesterday = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10) - 1))
      .toISOString().slice(0, 10);
    let streakRows: { id: string; current_streak: number }[] = [];
    try {
      streakRows = await fetchAll((from, to) =>
        admin.from('users').select('id, current_streak', { count: 'exact' })
          .gte('current_streak', 2).eq('last_played', yesterday)
          .order('id', { ascending: true }).range(from, to)
      );
    } catch (_) { /* sin racha personalizada: se manda el texto general */ }
    const streakOf = new Map(streakRows.map((u) => [u.id, u.current_streak]));
    // Un móvil puede tener varias identidades (ver arriba): vale la mayor racha.
    const tokenStreak = new Map<string, number>();
    for (const t of toks) {
      const s = streakOf.get(t.user_id);
      if (s && t.token && s > (tokenStreak.get(t.token) ?? 0)) tokenStreak.set(t.token, s);
    }

    // Antes era "Tu grupo no te va a esperar" para todos, también para quien
    // no tiene ningún grupo. Ahora habla de lo que de verdad se pierde.
    const messages = pending.map((t) => {
      const s = tokenStreak.get(t.token);
      return {
        to: t.token,
        title: 'Apexly',
        body: s ? pushText(t.lang, 'reminderStreak', { n: s }) : pushText(t.lang, 'reminder'),
        sound: 'default',
      };
    });

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
