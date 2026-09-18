// ============================================================================
//  Edge Function: notify-duel-challenge
//
//  Avisa por push a la otra parte de un duelo en dos momentos, según `kind`:
//    'challenge' -> al opponent, justo después de create_duel().
//    'accepted'  -> al challenger, justo después de accept_duel().
//  Un solo endpoint para los dos (mismo shape de trabajo: buscar el duelo,
//  validar que quien llama es la parte correcta, avisar al otro) en vez de
//  duplicar notify-overtakes/notify-gp-overtake para algo tan parecido.
//
//  `data: {duelId}` va en el payload — a diferencia de notify-overtakes
//  (que no lleva data), aquí hace falta para que el cliente pueda abrir
//  directo la pantalla del duelo al tocar la notificación.
//
//  Invocada por el cliente justo después de su propia RPC (create_duel /
//  accept_duel), no por cron — mismo patrón que notify-overtakes. Lee el
//  duelo con el permiso del propio usuario (RLS de duels.sql ya restringe a
//  los dos participantes) y usa service_role SOLO para leer el token
//  (privado) de la otra parte.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    const asUser = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json({ error: 'unauthorized' }, 401);
    const uid = user.id;

    const { duelId, kind } = await req.json();
    if (!duelId || (kind !== 'challenge' && kind !== 'accepted')) return json({ error: 'bad_request' }, 400);

    const { data: duel } = await asUser
      .from('duels')
      .select('challenger_id, opponent_id, wager')
      .eq('id', duelId)
      .single();
    if (!duel) return json({ error: 'duel_not_found' }, 404);

    // Solo quien acaba de hacer la acción puede disparar su propio aviso —
    // evita que cualquiera reenvíe notificaciones a nombre de otro duelo.
    const targetId = kind === 'challenge' ? duel.opponent_id : duel.challenger_id;
    const actingId = kind === 'challenge' ? duel.challenger_id : duel.opponent_id;
    if (uid !== actingId) return json({ error: 'forbidden' }, 403);

    const { data: me } = await asUser.from('users').select('nickname').eq('id', uid).single();
    const myName = me?.nickname ?? 'Alguien';

    const body = kind === 'challenge'
      ? `${myName} te reta a una carrera por ${duel.wager} monedas. ¿Aceptas?`
      : `${myName} ha aceptado tu reto — tienes 15 minutos para correr.`;

    const admin = createClient(url, service);
    const { data: toks } = await admin.from('push_tokens').select('token').eq('user_id', targetId);
    const seenTokens = new Set<string>();
    const messages = (toks ?? [])
      .filter((t) => t.token && !seenTokens.has(t.token) && seenTokens.add(t.token))
      .map((t) => ({ to: t.token, title: 'Apexly', body, sound: 'default', data: { duelId, kind } }));
    if (messages.length === 0) return json({ sent: 0 });

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
