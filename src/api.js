// ============================================================================
//  Capa de datos — identidad anónima, guardado del mejor tiempo, leaderboard.
//
//  Auth anónima (sin email/contraseña): cada dispositivo obtiene un usuario
//  anónimo persistido. El nickname se guarda local (rápido) y en `users`.
// ============================================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { todayKey, dayOffset } from './daily';
import { CAR_DEFAULTS } from './car';

const NICK_KEY = 'nickname';

// Asegura una sesión anónima (la crea si no existe). Devuelve el user.
export async function ensureSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) return session.user;
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return data.user;
}

export async function getLocalNickname() {
  return AsyncStorage.getItem(NICK_KEY);
}

// Guarda el nickname (local + tabla users). Crea la sesión anónima si hace falta.
export async function saveNickname(nickname) {
  const clean = nickname.trim().slice(0, 16);
  const user = await ensureSession();
  const { error } = await supabase
    .from('users')
    .upsert({ id: user.id, nickname: clean });
  if (error) throw error;
  await AsyncStorage.setItem(NICK_KEY, clean);
  return clean;
}

// Registra (idempotente) el circuito del día (etiqueta descriptiva).
export async function ensureDailyTrack(label) {
  const day = todayKey();
  await supabase
    .from('daily_track')
    .upsert({ day, combo_id: label || 'generado' }, { onConflict: 'day', ignoreDuplicates: true });
}

// Envía un tiempo (ms). Solo guarda si mejora el mejor del día.
// Devuelve { isBest, bestMs } (bestMs = mejor del día tras el envío).
export async function submitTime(ms) {
  const user = await ensureSession();
  const day = todayKey();
  const { data: existing } = await supabase
    .from('attempts')
    .select('best_ms')
    .eq('user_id', user.id)
    .eq('day', day)
    .maybeSingle();

  if (existing && existing.best_ms <= ms) {
    return { isBest: false, bestMs: existing.best_ms, prevMs: existing.best_ms };
  }
  const { error } = await supabase
    .from('attempts')
    .upsert(
      { user_id: user.id, day, best_ms: ms, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,day' }
    );
  if (error) throw error;
  return { isBest: true, bestMs: ms, prevMs: existing?.best_ms ?? null };
}

// Mejor tiempo de cada sector HOY, entre todos los jugadores (para el morado
// estilo F1: el mejor de la sesión, no "más rápido que el líder"). Devuelve
// { [sectorIndex]: ms }; sector sin ningún tiempo aún = no aparece en el objeto.
export async function getSectorBests(day = todayKey()) {
  const { data, error } = await supabase.from('sector_bests').select('sector, ms').eq('day', day);
  if (error) return {};
  const out = {};
  (data || []).forEach((r) => { out[r.sector] = r.ms; });
  return out;
}

// Envía tus splits de sector de esta vuelta (TODAS las vueltas, no solo tu
// mejor tiempo global — un sector suelto puede ser tu mejor aunque la vuelta
// entera no lo sea, igual que en la F1 real). El propio servidor decide si
// mejora el mejor de hoy (función submit_sector_best); aquí solo se dispara.
export async function submitSectorSplits(sectorMs, day = todayKey()) {
  await ensureSession();
  await Promise.all(sectorMs.map((ms, i) =>
    supabase.rpc('submit_sector_best', { p_day: day, p_sector: i, p_ms: Math.round(ms) }).catch(() => {})
  ));
}

// Avisa (push) a la gente de tus grupos que has adelantado. Fire-and-forget:
// nunca bloquea ni rompe el flujo si falla.
export async function notifyOvertakes(newMs, prevMs, day = todayKey()) {
  try {
    await supabase.functions.invoke('notify-overtakes', { body: { day, newMs, prevMs } });
  } catch (_) {
    // sin conexión / función no desplegada -> se ignora
  }
}

// ---- Racha -----------------------------------------------------------------
// Actualiza la racha al jugar (solo cambia en el PRIMER intento del día).
// RPC server-side (ver economy_prereq.sql): el día ya no lo decide el
// cliente, así que no se puede granjear racha llamando con fechas
// inventadas. Devuelve { current, longest, changed, isNewLongest }.
export async function bumpStreak() {
  await ensureSession();
  const { data, error } = await supabase.rpc('bump_streak');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    current: row.current_streak,
    longest: row.longest_streak,
    changed: row.changed,
    isNewLongest: row.is_new_longest,
  };
}

// Racha actual del usuario (para mostrar en Inicio). Ajusta a 0 si perdió la
// racha (última jugada anterior a ayer) sin necesidad de escribir.
export async function getMyStreak() {
  const user = await ensureSession();
  const { data: u } = await supabase
    .from('users')
    .select('current_streak, longest_streak, last_played')
    .eq('id', user.id)
    .maybeSingle();
  if (!u) return { current: 0, longest: 0 };
  const today = todayKey();
  const yesterday = dayOffset(today, -1);
  const alive = u.last_played === today || u.last_played === yesterday;
  return { current: alive ? u.current_streak || 0 : 0, longest: u.longest_streak || 0 };
}

// ---- Coche (garaje) ---------------------------------------------------------
// Loadout guardado del usuario. Si no hay fila o faltan columnas, cae a
// CAR_DEFAULTS (mismo criterio que usa CarSprite si no le llega loadout).
export async function getMyLoadout() {
  const user = await ensureSession();
  const { data } = await supabase
    .from('users')
    .select('car_body_color, car_wing_shape, car_wing_color, car_livery, car_livery_pattern, car_lights_color')
    .eq('id', user.id)
    .maybeSingle();
  if (!data) return { ...CAR_DEFAULTS };
  return {
    bodyColor: data.car_body_color || CAR_DEFAULTS.bodyColor,
    wingShape: data.car_wing_shape || CAR_DEFAULTS.wingShape,
    wingColor: data.car_wing_color || CAR_DEFAULTS.wingColor,
    livery: data.car_livery,
    liveryPattern: data.car_livery_pattern || CAR_DEFAULTS.liveryPattern,
    lightsColor: data.car_lights_color || CAR_DEFAULTS.lightsColor,
  };
}

// Guarda el loadout completo (se aplica al vuelo desde el garaje, sin botón
// de "guardar" — cada toque en una pieza dispara esto). RPC server-side (ver
// economy.sql): valida que cada pieza no-libre esté en tu inventory antes de
// escribirla, así no se puede equipar una pieza premium sin haberla ganado.
export async function saveLoadout(loadout) {
  await ensureSession();
  const { error } = await supabase.rpc('save_loadout', {
    p_body_color: loadout.bodyColor,
    p_wing_shape: loadout.wingShape,
    p_wing_color: loadout.wingColor,
    p_livery: loadout.livery,
    p_livery_pattern: loadout.liveryPattern,
    p_lights_color: loadout.lightsColor,
  });
  if (error) throw error;
}

// ---- Economía (monedas / sobres) --------------------------------------------
// Saldo + sobres pendientes. Fallback a 0 si el usuario aún no tiene fila en
// wallet (se crea sola en el primer grant_daily_reward/open_pack).
export async function getWallet() {
  const user = await ensureSession();
  const { data } = await supabase
    .from('wallet')
    .select('balance, pending_packs')
    .eq('user_id', user.id)
    .maybeSingle();
  return { balance: data?.balance ?? 0, pendingPacks: data?.pending_packs ?? 0 };
}

// Recompensas de racha/ranking desde `sinceDay` (para el pop-up de "premios
// de ayer" al abrir la app). `day` se guarda en UTC en wallet_transactions,
// así que el llamador pasa un margen de un par de días hacia atrás para no
// perder nada por el desfase con la fecha local (mismo desfase ya aceptado
// en el resto de la economía).
export async function getRecentRewards(sinceDay) {
  const user = await ensureSession();
  const { data, error } = await supabase
    .from('wallet_transactions')
    .select('reason, amount')
    .eq('user_id', user.id)
    .in('reason', ['streak', 'ranking'])
    .gte('day', sinceDay);
  if (error) return { streak: 0, ranking: 0 };
  const out = { streak: 0, ranking: 0 };
  for (const row of data || []) out[row.reason] = (out[row.reason] || 0) + row.amount;
  return out;
}

// Recompensa por compartir el resultado (+5 monedas, 1 vez al día — idempotente
// server-side igual que claimDailyReward). Se llama tras compartir con éxito.
export async function claimShareReward() {
  await ensureSession();
  try {
    const { data, error } = await supabase.rpc('claim_share_reward');
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return { granted: row.granted, newBalance: row.new_balance };
  } catch (_) {
    return null;
  }
}

// Reclama la recompensa diaria de racha (idempotente server-side: si ya se
// reclamó hoy, granted vuelve false). Fire-and-forget: no debe bloquear el
// flujo de Inicio si falla.
export async function claimDailyReward() {
  await ensureSession();
  try {
    const { data, error } = await supabase.rpc('grant_daily_reward');
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return {
      granted: row.granted,
      amount: row.amount,
      newBalance: row.new_balance,
      freePack: row.free_pack,
    };
  } catch (_) {
    return null;
  }
}

// Abre un sobre ('paid' gasta 125 monedas, 'free' consume uno de los
// pendientes). Lanza si falla (saldo insuficiente, sin sobre pendiente,
// colección completa) — el usuario lo pidió, hay que mostrarlo.
export async function openPack(source = 'paid') {
  await ensureSession();
  const { data, error } = await supabase.rpc('open_pack', { p_source: source });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    category: row.category,
    pieceId: row.piece_id,
    rarity: row.rarity,
    newBalance: row.new_balance,
  };
}

// Piezas premium que ya posees. Devuelve pares { category, pieceId }.
export async function getInventory() {
  const user = await ensureSession();
  const { data, error } = await supabase
    .from('inventory')
    .select('category, piece_id')
    .eq('user_id', user.id);
  if (error) return [];
  return (data || []).map((r) => ({ category: r.category, pieceId: r.piece_id }));
}

// ---- Modo Carrera (niveles con gap) -----------------------------------------
// Nivel más alto ya superado (0 = ninguno todavía).
export async function getCareerProgress() {
  const user = await ensureSession();
  const { data } = await supabase
    .from('career_progress')
    .select('cleared')
    .eq('user_id', user.id)
    .maybeSingle();
  return data?.cleared ?? 0;
}

// Reclama un nivel superado. El servidor recalcula que sea el siguiente en
// la escalera (WRONG_LEVEL si no) — lanza si falla, lo llama CareerMode tras
// comprobar el gap-time en cliente.
export async function claimCareerLevel(level, ms) {
  await ensureSession();
  const { data, error } = await supabase.rpc('claim_career_level', { p_level: level, p_ms: ms });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row?.cleared ?? level;
}

// ---- Grupos ----------------------------------------------------------------
// Lista los grupos del usuario (a los que pertenece).
export async function listMyGroups() {
  await ensureSession();
  const { data, error } = await supabase
    .from('groups')
    .select('id, name, join_code')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

// Crea un grupo (devuelve { id, name, join_code }).
export async function createGroup(name) {
  await ensureSession();
  const { data, error } = await supabase.rpc('create_group', { p_name: name });
  if (error) throw error;
  return data;
}

// Se une a un grupo por código. Lanza si el código no existe.
export async function joinGroup(code) {
  await ensureSession();
  const { data, error } = await supabase.rpc('join_group', { p_code: code });
  if (error) throw error;
  return data;
}

// Sale de un grupo (sin restricciones, aunque tenga GP activo). Tu historial
// de resultados ya clasificados en ese GP no desaparece.
export async function leaveGroup(groupId) {
  await ensureSession();
  const { error } = await supabase.rpc('leave_group', { p_group_id: groupId });
  if (error) throw error;
}

// ---- Grand Prix (ver supabase/grandprix.sql) --------------------------------
// GP activo de un grupo, o null si no hay ninguno arrancado. Lectura directa
// (RLS ya limita a tus grupos) — no hace falta RPC solo para leer.
export async function getActiveGrandPrix(groupId) {
  await ensureSession();
  const { data, error } = await supabase
    .from('grand_prix')
    .select('id, group_id, started_at, circuit_count, status')
    .eq('group_id', groupId)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Arranca un GP para el grupo. Lanza 'GP_ALREADY_ACTIVE' si ya hay uno.
export async function startGrandPrix(groupId) {
  await ensureSession();
  const { data, error } = await supabase.rpc('start_grand_prix', { p_group_id: groupId });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

// Miembros del grupo (todos, aunque no hayan corrido nada aún) — para que la
// general del GP los muestre con 0 puntos en vez de solo a quien ya jugó.
export async function getGroupMembers(groupId) {
  await ensureSession();
  const { data, error } = await supabase
    .from('group_members')
    .select('user_id, users(nickname)')
    .eq('group_id', groupId);
  if (error) throw error;
  return (data || []).map((m) => ({ userId: m.user_id, nickname: m.users?.nickname ?? '—' }));
}

// Todos los resultados clasificados de un GP (todas las rondas, todo el
// grupo) — de aquí sale la general completa, se agrega en cliente
// (computeStandings, en src/grandprix.js) igual que getLeaderboard.
export async function getGpResults(gpId) {
  await ensureSession();
  const { data, error } = await supabase
    .from('gp_results')
    .select('day_index, user_id, ms, sector_ms, users(nickname)')
    .eq('gp_id', gpId);
  if (error) throw error;
  return (data || []).map((r) => ({
    dayIndex: r.day_index,
    userId: r.user_id,
    nickname: r.users?.nickname ?? '—',
    ms: r.ms,
    sectorMs: r.sector_ms ?? null,
  }));
}

// El mejor tiempo de una ronda del GP (con sus splits) — para la "batalla de
// sectores": comparar tu vuelta recién clasificada contra la del líder.
export async function getGpRoundLeader(gpId, dayIndex) {
  await ensureSession();
  const { data, error } = await supabase
    .from('gp_results')
    .select('user_id, ms, sector_ms, users(nickname)')
    .eq('gp_id', gpId).eq('day_index', dayIndex)
    .order('ms', { ascending: true }).limit(1).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { userId: data.user_id, nickname: data.users?.nickname ?? '—', ms: data.ms, sectorMs: data.sector_ms ?? null };
}

// Clasifica un tiempo (solo se llama desde la 3ª vuelta en adelante — las 2
// de práctica no pasan por aquí, ver App.js). `sectorMs` (opcional, array de
// 3) es para la "batalla de sectores" en la clasificación. Lanza si el
// servidor rechaza (ronda aún no abierta, GP ya cerrado, etc.) — el llamador
// decide qué mostrar, igual que submitTime.
export async function submitGpResult(gpId, dayIndex, ms, sectorMs) {
  await ensureSession();
  const { data, error } = await supabase.rpc('submit_gp_result', {
    p_gp_id: gpId, p_day_index: dayIndex, p_ms: Math.round(ms),
    p_sector_ms: sectorMs ? sectorMs.map((x) => Math.round(x)) : null,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { isBest: !!row?.is_best, prevMs: row?.prev_ms ?? null };
}

// Avisa (push) a tu grupo que les has adelantado EN EL GP. Fire-and-forget,
// mismo contrato que notifyOvertakes.
export async function notifyGpOvertake(gpId, dayIndex, newMs, prevMs) {
  try {
    await supabase.functions.invoke('notify-gp-overtake', { body: { gpId, dayIndex, newMs, prevMs } });
  } catch (_) {
    // sin conexión / función no desplegada -> se ignora
  }
}

// Leaderboard GLOBAL escalable (miles de tiempos): NO baja todas las filas.
// Devuelve el top 6 (podio + "quién te persigue" cuando vas top-3), tu
// posición, hasta 2 vecinos a cada lado (para poder centrar la ventana de 3
// incluso en los bordes: 4.º puesto o último) y el total. Consultas ligeras
// (limit/count por best_ms). Para grupos, usa getLeaderboard.
export async function getGlobalBoard(day = todayKey()) {
  const { data: { session } } = await supabase.auth.getSession();
  const myId = session?.user?.id ?? null;

  const SEL = 'best_ms, updated_at, user_id, users(nickname, current_streak)';
  const mapRow = (r, rank, leaderMs) => ({
    userId: r.user_id,
    nickname: r.users?.nickname ?? '—',
    streak: r.users?.current_streak ?? 0,
    bestMs: r.best_ms,
    rank,
    isMe: r.user_id === myId,
    gapToLeaderMs: leaderMs != null ? r.best_ms - leaderMs : 0,
  });

  // Total del día + top 6 (una consulta de conteo + una limitada).
  const [totalRes, topRes] = await Promise.all([
    supabase.from('attempts').select('user_id', { count: 'exact', head: true }).eq('day', day),
    supabase.from('attempts').select(SEL).eq('day', day).order('best_ms', { ascending: true }).limit(6),
  ]);
  const total = totalRes.count ?? 0;
  const topRows = topRes.data || [];
  const leaderMs = topRows[0]?.best_ms ?? null;
  const top = topRows.map((r, i) => mapRow(r, i + 1, leaderMs));

  // ¿He jugado hoy? Si no, solo top + total.
  let me = null, aboveRows = [], belowRows = [];
  if (myId) {
    const { data: mine } = await supabase
      .from('attempts').select('best_ms, users(nickname, current_streak)')
      .eq('day', day).eq('user_id', myId).maybeSingle();
    if (mine) {
      const myBest = mine.best_ms;
      // rank = cuántos van por delante (best_ms menor) + 1. Hasta 2 vecinos a
      // cada lado: hacen falta para poder mostrar SIEMPRE una ventana de 3
      // aunque vayas 4.º (no hay "arriba" real, solo "abajo") o último (no
      // hay "abajo", solo "arriba") — ver GlobalBoard() en Leaderboard.js.
      const [fasterRes, aboveRes, belowRes] = await Promise.all([
        supabase.from('attempts').select('user_id', { count: 'exact', head: true }).eq('day', day).lt('best_ms', myBest),
        supabase.from('attempts').select(SEL).eq('day', day).lt('best_ms', myBest).order('best_ms', { ascending: false }).limit(2),
        supabase.from('attempts').select(SEL).eq('day', day).gt('best_ms', myBest).order('best_ms', { ascending: true }).limit(2),
      ]);
      const myRank = (fasterRes.count ?? 0) + 1;
      me = {
        userId: myId,
        nickname: mine.users?.nickname ?? 'Tú',
        streak: mine.users?.current_streak ?? 0,
        bestMs: myBest,
        rank: myRank,
        isMe: true,
        gapToLeaderMs: leaderMs != null ? myBest - leaderMs : 0,
      };
      // aboveRes viene ordenado más-cercano-primero (rank-1, rank-2); belowRes
      // igual (rank+1, rank+2).
      aboveRows = (aboveRes.data || []).map((r, i) => mapRow(r, myRank - 1 - i, leaderMs));
      belowRows = (belowRes.data || []).map((r, i) => mapRow(r, myRank + 1 + i, leaderMs));
    }
  }

  return { total, leaderMs, top, me, aboveRows, belowRows };
}

// Leaderboard del día. `scope` = 'global' o el id de un grupo. Lista ordenada
// (mejor primero) con datos ya calculados para la UI (soporta percentil).
export async function getLeaderboard(scope = 'global', day = todayKey()) {
  const { data: { session } } = await supabase.auth.getSession();
  const myId = session?.user?.id ?? null;

  let memberIds = null;
  if (scope && scope !== 'global') {
    const { data: members, error: mErr } = await supabase
      .from('group_members')
      .select('user_id')
      .eq('group_id', scope);
    if (mErr) throw mErr;
    memberIds = (members || []).map((m) => m.user_id);
    if (memberIds.length === 0) return [];
  }

  let q = supabase
    .from('attempts')
    .select('best_ms, updated_at, user_id, users(nickname, current_streak)')
    .eq('day', day)
    .order('best_ms', { ascending: true });
  if (memberIds) q = q.in('user_id', memberIds);
  const { data, error } = await q;
  if (error) throw error;

  const rows = data || [];
  const total = rows.length;
  const leaderMs = rows[0]?.best_ms ?? null;

  return rows.map((r, i) => {
    const rank = i + 1;
    return {
      userId: r.user_id,
      nickname: r.users?.nickname ?? '—',
      streak: r.users?.current_streak ?? 0,
      bestMs: r.best_ms,
      rank,
      total,
      isMe: r.user_id === myId,
      gapToLeaderMs: leaderMs != null ? r.best_ms - leaderMs : 0,
      // "top X%" (1 = el mejor). Con pocos usuarios no dice mucho, pero la
      // estructura ya lo soporta para el futuro.
      topPercent: total > 0 ? Math.max(1, Math.round((rank / total) * 100)) : 100,
    };
  });
}
