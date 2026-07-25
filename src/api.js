// ============================================================================
//  Capa de datos — identidad anónima, guardado del mejor tiempo, leaderboard.
//
//  Auth anónima (sin email/contraseña): cada dispositivo obtiene un usuario
//  anónimo persistido. El nickname se guarda local (rápido) y en `users`.
// ============================================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { todayKey, dayOffset } from './daily';

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
// Devuelve { current, longest, changed, isNewLongest }.
export async function bumpStreak() {
  const user = await ensureSession();
  const today = todayKey();
  const yesterday = dayOffset(today, -1);
  const { data: u } = await supabase
    .from('users')
    .select('current_streak, longest_streak, last_played')
    .eq('id', user.id)
    .maybeSingle();
  if (!u) return null;

  const cur = u.current_streak || 0;
  const lng = u.longest_streak || 0;
  if (u.last_played === today) {
    return { current: cur, longest: lng, changed: false, isNewLongest: false };
  }
  const current = u.last_played === yesterday ? cur + 1 : 1; // consecutivo o reinicio
  const longest = Math.max(lng, current);
  await supabase
    .from('users')
    .update({ current_streak: current, longest_streak: longest, last_played: today })
    .eq('id', user.id);
  return { current, longest, changed: true, isNewLongest: current > lng };
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
