// ============================================================================
//  Edge Function: notify-overtakes
//
//  Al batir tu mejor tiempo del día, avisa (push) a la gente de TUS GRUPOS que
//  has adelantado: aquellos cuyo mejor tiempo de hoy queda entre tu nuevo
//  tiempo (mejor) y tu tiempo anterior (peor) -> les has quitado el puesto.
//
//  Lee grupos/miembros/tiempos con el permiso del propio usuario (RLS) y usa
//  service_role SOLO para los tokens (privados). Supabase inyecta SUPABASE_URL,
//  SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY automáticamente.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    // Cliente con el JWT del que llama (RLS del usuario).
    const asUser = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json({ error: 'unauthorized' }, 401);
    const uid = user.id;

    const { day, newMs, prevMs } = await req.json();
    if (!day || typeof newMs !== 'number') return json({ error: 'bad_request' }, 400);

    // Co-miembros de mis grupos (RLS deja ver a los miembros de mis grupos).
    const { data: members, error: emem } = await asUser.from('group_members').select('user_id');
    const memberIds = [...new Set((members ?? []).map((m) => m.user_id))].filter((id) => id !== uid);
    if (memberIds.length === 0) return json({ sent: 0, debug: { members: 0, emem: emem?.message ?? null } });

    // Mi nombre.
    const { data: me } = await asUser.from('users').select('nickname').eq('id', uid).single();
    const myName = me?.nickname ?? 'Alguien';

    // A quién he adelantado hoy: su mejor es peor que mi nuevo tiempo (gt) y, si
    // yo ya tenía tiempo, mejor que el anterior (lt) -> les he quitado el puesto.
    let q = asUser
      .from('attempts')
      .select('user_id, best_ms')
      .eq('day', day)
      .in('user_id', memberIds)
      .gt('best_ms', newMs);
    if (typeof prevMs === 'number') q = q.lt('best_ms', prevMs);
    const { data: passed } = await q;
    const passedIds = [...new Set((passed ?? []).map((p) => p.user_id))];
    if (passedIds.length === 0) return json({ sent: 0, debug: { members: memberIds.length, passed: 0 } });

    // Tokens (service_role: son privados).
    const admin = createClient(url, service);
    const { data: toks, error: etok } = await admin.from('push_tokens').select('token').in('user_id', passedIds);
    const messages = (toks ?? [])
      .filter((t) => t.token)
      .map((t) => ({ to: t.token, title: 'Apexly', body: `${myName} te ha superado`, sound: 'default' }));
    if (messages.length === 0) {
      return json({ sent: 0, debug: { members: memberIds.length, passed: passedIds.length, tokens: 0, hasService: service.length > 0, etok: etok?.message ?? null } });
    }

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
