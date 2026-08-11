// ============================================================================
//  Edge Function: notify-gp-overtake
//
//  Igual que notify-overtakes, pero para una ronda de Grand Prix: al
//  clasificar un tiempo que mejora el tuyo anterior, avisa (push) a quien te
//  había ganado esa ronda y ahora le has quitado el puesto. Lee grupo/GP/
//  resultados con el permiso del propio usuario (RLS) y usa service_role
//  SOLO para los tokens (privados).
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

    const { gpId, dayIndex, newMs, prevMs } = await req.json();
    if (!gpId || !dayIndex || typeof newMs !== 'number') return json({ error: 'bad_request' }, 400);

    // El GP (RLS ya limita a mis grupos) -> de ahí el group_id.
    const { data: gp, error: egp } = await asUser.from('grand_prix').select('group_id').eq('id', gpId).maybeSingle();
    if (!gp) return json({ sent: 0, debug: { egp: egp?.message ?? 'gp_not_found' } });

    const { data: members, error: emem } = await asUser
      .from('group_members').select('user_id').eq('group_id', gp.group_id);
    const memberIds = [...new Set((members ?? []).map((m) => m.user_id))].filter((id) => id !== uid);
    if (memberIds.length === 0) return json({ sent: 0, debug: { members: 0, emem: emem?.message ?? null } });

    const { data: me } = await asUser.from('users').select('nickname').eq('id', uid).single();
    const myName = me?.nickname ?? 'Alguien';

    // A quién he adelantado en ESTA ronda del GP: su tiempo era peor que mi
    // nuevo tiempo (gt) y, si ya tenía uno antes, mejor que el anterior (lt).
    let q = asUser
      .from('gp_results')
      .select('user_id, ms')
      .eq('gp_id', gpId)
      .eq('day_index', dayIndex)
      .in('user_id', memberIds)
      .gt('ms', newMs);
    if (typeof prevMs === 'number') q = q.lt('ms', prevMs);
    const { data: passed } = await q;
    const passedIds = [...new Set((passed ?? []).map((p) => p.user_id))];
    if (passedIds.length === 0) return json({ sent: 0, debug: { members: memberIds.length, passed: 0 } });

    const admin = createClient(url, service);
    const { data: toks, error: etok } = await admin.from('push_tokens').select('token').in('user_id', passedIds);
    const seenTokens = new Set<string>();
    const messages = (toks ?? [])
      .filter((t) => t.token && !seenTokens.has(t.token) && seenTokens.add(t.token))
      .map((t) => ({
        to: t.token, sound: 'default', title: 'Apexly · Grand Prix',
        body: `${myName} te ha superado en la ronda ${dayIndex}. ¿Lo vas a permitir?`,
      }));
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
