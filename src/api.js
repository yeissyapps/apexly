// ============================================================================
//  Capa de datos — identidad anónima, guardado del mejor tiempo, leaderboard.
//
//  Auth anónima (sin email/contraseña): cada dispositivo obtiene un usuario
//  anónimo persistido. El nickname se guarda local (rápido) y en `users`.
// ============================================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { Asset } from 'expo-asset';
import { toByteArray } from 'base64-js';
import { supabase } from './supabase';
import { todayKey, dayOffset } from './daily';
import { CAR_DEFAULTS } from './car';
import { CONFIG } from './config';
import { F1_POINTS } from './gpData';

const NICK_KEY = 'nickname';

// Asegura una sesión anónima (la crea si no existe). Devuelve el user.
export async function ensureSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) return session.user;
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return data.user;
}

// Build mínimo exigido para `platform` ('ios'|'android'), o null si no hay
// fila (no bloquea) o si falla la red (nunca queremos tumbar el arranque
// por esto — ver app_version.sql).
export async function getMinBuild(platform) {
  const { data, error } = await supabase
    .from('app_version')
    .select('min_build')
    .eq('platform', platform)
    .maybeSingle();
  if (error || !data) return null;
  return data.min_build;
}

// Id del usuario actual. Hace falta para saber cuál de las filas de un
// ranking eres tú cuando la consulta no lo marca (grupos, Grand Prix).
export async function getMyId() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
}

export async function getLocalNickname() {
  return AsyncStorage.getItem(NICK_KEY);
}

// Guarda el nickname (local + tabla users). Crea la sesión anónima si hace
// falta. Rechaza nombres ya en uso (comparación sin mayúsculas): lanza un
// error con code='NICKNAME_TAKEN' que el onboarding atrapa para pedir otro
// nombre, en vez de dejar avanzar a un jugador con un nombre duplicado.
export async function saveNickname(nickname) {
  const clean = nickname.trim().slice(0, 16);
  const user = await ensureSession();
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .ilike('nickname', clean)
    .neq('id', user.id)
    .maybeSingle();
  if (existing) {
    const err = new Error('Ese nombre ya lo tiene otro jugador.');
    err.code = 'NICKNAME_TAKEN';
    throw err;
  }
  const { error } = await supabase
    .from('users')
    .upsert({ id: user.id, nickname: clean });
  if (error) {
    // Respaldo por si dos jugadores mandan el mismo nombre casi a la vez (el
    // check de arriba no ve al otro todavía) — lo atrapa el índice único.
    if (error.code === '23505') {
      const err = new Error('Ese nombre ya lo tiene otro jugador.');
      err.code = 'NICKNAME_TAKEN';
      throw err;
    }
    throw error;
  }
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
// Devuelve { isBest, bestMs, prevMs } (prevMs = tu mejor ANTES de esta vuelta,
// null si era la primera del día).
//
// Va por RPC y no por upsert directo desde que se cerró A-01: la comprobación
// de "solo si mejora" estaba aquí, en el cliente, o sea en ningún sitio. Con
// la clave anon —que es pública y viaja dentro del APK— se podía escribir un
// best_ms arbitrario. Ver supabase/submit_time.sql.
export async function submitTime(ms) {
  await ensureSession();
  const { data, error } = await supabase.rpc('submit_time', {
    p_day: todayKey(),
    p_ms: Math.round(ms),
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('SUBMIT_TIME_EMPTY');
  return { isBest: row.is_best, bestMs: row.best_ms, prevMs: row.prev_ms };
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
    supabase.rpc('submit_sector_best', { p_day: day, p_sector: i, p_ms: Math.round(ms) })
      // Los sectores son accesorios: si uno falla, la vuelta ya está guardada
      // y no hay nada que hacer al respecto. El log se queda solo en modo
      // diagnóstico, que es cuando sirve para algo.
      .then(({ error }) => {
        if (error && CONFIG.DIAG) console.log('[sector_submit_err]', i, error.code, error.message);
      })
      .catch((e) => { if (CONFIG.DIAG) console.log('[sector_submit_throw]', i, e?.message || String(e)); })
  ));
}

// Equivalentes de getSectorBests/submitSectorSplits para el Grand Prix — el
// morado ahí compara "con respecto al resto de vueltas de los jugadores del
// grupo" (JC, 2026-09-09), no solo tu propio intento anterior (refSectors),
// así que hace falta la misma tabla de mejores por sector que ya tiene el
// Diario, pero acotada a (gp_id, day_index). `sector` es el índice
// GEOGRÁFICO (0-2, el tramo del circuito) — con 3 vueltas cerradas cada
// intento manda 9 valores, 3 por cada uno de los 3 sectores geográficos
// (i % 3), sin importar de qué vuelta salió cada uno (igual que en la F1
// real, el morado de la sesión puede venir de cualquier vuelta).
export async function getGpSectorBests(gpId, dayIndex) {
  const { data, error } = await supabase
    .from('gp_sector_bests').select('sector, ms').eq('gp_id', gpId).eq('day_index', dayIndex);
  if (error) return {};
  const out = {};
  (data || []).forEach((r) => { out[r.sector] = r.ms; });
  return out;
}

// Igual que getGpSectorBests pero con QUIÉN lo tiene (holder_id) — para la
// clasificación diaria, que ahora enseña "récord de sector: fulano, X.XXs"
// (JC, 2026-09-09), no solo el número para colorear en pista. Función
// aparte en vez de cambiar la forma de getGpSectorBests: esa la sigue
// leyendo Game.js esperando { [sector]: ms } a secas, no romper eso.
export async function getGpSectorRecords(gpId, dayIndex) {
  const { data, error } = await supabase
    .from('gp_sector_bests').select('sector, ms, holder_id').eq('gp_id', gpId).eq('day_index', dayIndex);
  if (error) return {};
  const out = {};
  (data || []).forEach((r) => { out[r.sector] = { ms: r.ms, holderId: r.holder_id }; });
  return out;
}

export async function submitGpSectorSplits(gpId, dayIndex, sectorMs9) {
  await ensureSession();
  await Promise.all(sectorMs9.map((ms, i) =>
    supabase.rpc('submit_gp_sector_best', { p_gp_id: gpId, p_day_index: dayIndex, p_sector: i % 3, p_ms: Math.round(ms) })
      .then(({ error }) => {
        if (error && CONFIG.DIAG) console.log('[gp_sector_submit_err]', i, error.code, error.message);
      })
      .catch((e) => { if (CONFIG.DIAG) console.log('[gp_sector_submit_throw]', i, e?.message || String(e)); })
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
    .select('car_chassis, car_frame, car_body_color, car_wing_shape, car_wing_color, car_livery, car_livery_pattern, car_lights_color')
    .eq('id', user.id)
    .maybeSingle();
  if (!data) return { ...CAR_DEFAULTS };
  return {
    // car_chassis solo existe si se corrió supabase/chassis.sql; sin él,
    // `data.car_chassis` llega undefined y cae al GT de siempre.
    chassis: data.car_chassis || CAR_DEFAULTS.chassis,
    frame: data.car_frame || CAR_DEFAULTS.frame,
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
    p_chassis: loadout.chassis || 'gt',
    p_frame: loadout.frame || 'sin_marco',
    p_body_color: loadout.bodyColor,
    p_wing_shape: loadout.wingShape,
    p_wing_color: loadout.wingColor,
    p_livery: loadout.livery,
    p_livery_pattern: loadout.liveryPattern,
    p_lights_color: loadout.lightsColor,
  });
  if (error) throw error;
}

// ---- Vuelta del líder (coche real en carrera) -------------------------------
// Sube la traza de tu vuelta, para que quien vaya por detrás pueda correr
// contra TU coche si eres el líder. Solo se llama cuando has mejorado tu marca
// (mismo disparador que notifyOvertakes), y el servidor vuelve a comprobar que
// mejora antes de sobrescribir. Fire-and-forget: si falla no pasa nada, el
// tiempo ya está guardado por submitTime — esto es solo el adorno.
export async function submitDailyRun(ms, trace, day = todayKey()) {
  await ensureSession();
  const { error } = await supabase.rpc('submit_daily_run', {
    p_day: day,
    p_ms: Math.round(ms),
    p_trace: trace,
  });
  if (error) throw error;
}

// Vuelta del líder de hoy: { userId, nickname, ms, trace, loadout } o null.
// Devuelve null también si el líder eres TÚ (no hay coche ajeno que enseñar,
// y tu propio fantasma local ya está en pista).
//
// OJO con la palabra "líder": esto es el más rápido DE LOS QUE HAN SUBIDO
// TRAZA hoy, que no siempre es el primero del ranking. Las trazas solo se
// suben desde la versión que estrenó daily_runs, así que un jugador en una
// versión vieja puede ir 1.º en `attempts` y no tener fila aquí. El force
// update (ver app_version.sql) es lo que hace que esa diferencia tienda a
// cero. Mientras tanto se prefiere enseñar al más rápido disponible antes que
// no enseñar a nadie — por eso el texto en pantalla NO afirma que sea el 1.º
// del mundo, solo que es el tiempo más rápido en pista.
export async function getLeaderRun(day = todayKey()) {
  const user = await ensureSession();
  const { data: run } = await supabase
    .from('daily_runs')
    .select('user_id, ms, trace')
    .eq('day', day)
    .order('ms', { ascending: true })
    .limit(1)
    .maybeSingle();
  // Con LIDER_DE_PRUEBA encendido, tu propia vuelta vale como "la del líder":
  // es la única forma de ver esto en solitario (ver config.js).
  if (!run) return null;
  if (run.user_id === user.id && !CONFIG.LIDER_DE_PRUEBA) return null;

  const { data: who } = await supabase
    .from('users')
    .select('nickname, car_chassis, car_frame, car_body_color, car_wing_shape, car_wing_color, car_livery, car_livery_pattern, car_lights_color')
    .eq('id', run.user_id)
    .maybeSingle();

  return {
    userId: run.user_id,
    nickname: who?.nickname || 'Líder',
    ms: run.ms,
    trace: run.trace,
    loadout: who
      ? {
          chassis: who.car_chassis || CAR_DEFAULTS.chassis,
          frame: who.car_frame || CAR_DEFAULTS.frame,
          bodyColor: who.car_body_color || CAR_DEFAULTS.bodyColor,
          wingShape: who.car_wing_shape || CAR_DEFAULTS.wingShape,
          wingColor: who.car_wing_color || CAR_DEFAULTS.wingColor,
          livery: who.car_livery,
          liveryPattern: who.car_livery_pattern || CAR_DEFAULTS.liveryPattern,
          lightsColor: who.car_lights_color || CAR_DEFAULTS.lightsColor,
        }
      : { ...CAR_DEFAULTS },
  };
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

// ---- Códigos de invitación (ver supabase/referrals.sql) --------------------

// Código propio, generándolo la primera vez que se pide (idempotente en
// servidor: siempre devuelve el mismo a partir de ahí).
export async function getMyReferralCode() {
  await ensureSession();
  const { data, error } = await supabase.rpc('get_or_create_referral_code');
  if (error) throw error;
  return data;
}

// ¿Ya ha canjeado esta cuenta un código ajeno alguna vez? Lectura directa
// (RLS ya limita a las filas propias) — no hace falta RPC solo para mirar.
export async function hasRedeemedReferral() {
  const user = await ensureSession();
  const { data, error } = await supabase
    .from('referrals')
    .select('id')
    .eq('redeemed_by', user.id)
    .maybeSingle();
  if (error) return false;
  return !!data;
}

// Canjea el código de otro jugador. Lanza con el código de error del
// servidor (CODE_NOT_FOUND / CANNOT_REDEEM_OWN_CODE / ALREADY_REDEEMED) para
// que la pantalla decida el mensaje.
export async function redeemReferralCode(code) {
  await ensureSession();
  const { data, error } = await supabase.rpc('redeem_referral_code', { p_code: code });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row?.bonus ?? null;
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
// userId opcional: sin él, la tuya (como siempre). Con él, la de OTRO
// jugador — perfil público, ver Profile.js. inventory ahora es de lectura
// pública (supabase/public_profiles.sql, 2026-09-15), igual que ya lo era
// player_stats desde el principio. `ensureSession()` se llama SIEMPRE (no
// solo cuando falta userId): sigue haciendo falta estar autenticado tú
// mismo para leer nada, aunque el dato pedido sea el de otro.
export async function getInventory(userId) {
  const user = await ensureSession();
  const uid = userId || user.id;
  const { data, error } = await supabase
    .from('inventory')
    .select('category, piece_id')
    .eq('user_id', uid);
  if (error) return [];
  return (data || []).map((r) => ({ category: r.category, pieceId: r.piece_id }));
}

// ---- Stats de jugador (Perfil) ---------------------------------------------
// Contadores de por vida: vueltas, choques, tiempo en pista, mejor vuelta.
// Devuelve null si la tabla todavía no existe (supabase/stats.sql sin correr),
// para que el Perfil enseñe un guion en esas casillas en vez de romperse.
export async function getPlayerStats(userId) {
  const user = await ensureSession();
  const { data, error } = await supabase
    .from('player_stats')
    .select('laps, crashes, race_ms, best_ms')
    .eq('user_id', userId || user.id)
    .maybeSingle();
  if (error) return null;
  if (!data) return { laps: 0, crashes: 0, raceMs: 0, bestMs: null };
  return { laps: data.laps, crashes: data.crashes, raceMs: Number(data.race_ms), bestMs: data.best_ms };
}

// Suma una vuelta terminada a los contadores. Fire-and-forget desde el final
// de carrera: son datos de vitrina, si se pierde uno no pasa nada — nunca
// debe bloquear ni romper el flujo de resultado.
export async function recordLap(ms, crashes) {
  try {
    await ensureSession();
    await supabase.rpc('record_lap', { p_ms: Math.round(ms), p_crashes: crashes | 0 });
  } catch (_) {
    // tabla sin crear todavía, o sin red: se descarta en silencio
  }
}

// ---- Miniatura de avatar (Fase 2 de avatares de piloto) --------------------
// Sube la foto capturada por PilotViewer.capture() a Supabase Storage. Ruta
// "<user_id>/<fileName>" — las policies de pilot_avatar.sql solo dejan
// escribir en tu propia carpeta. `fileName` por defecto es "thumb.png" (el
// uso normal, uno por jugador); PilotColorTest.js lo usa también con
// "variant-N.png" para generar las variantes por defecto SIN pisar tu
// propia miniatura real, subiendo varios archivos a tu misma carpeta.
//
// `updateUser`: solo la miniatura REAL del jugador (thumb.png) debe quedar
// apuntada en users.avatar_thumb_url — las variantes de plantilla son
// contenido de la app, no tu avatar, así que no tocan tu fila.
//
// OJO: se pasa el ArrayBuffer directo a .upload(), NUNCA envuelto en un
// `new Blob([...])` — React Native no soporta construir Blobs a partir de
// ArrayBuffer/ArrayBufferView (mismo fallo ya visto con GLTFLoader en
// PilotViewer.js). supabase-js sí acepta ArrayBuffer tal cual como cuerpo,
// sin pasar por Blob.
export async function uploadPilotThumbnail(localUri, fileName = 'thumb.png', updateUser = true) {
  const user = await ensureSession();
  const base64 = await FileSystem.readAsStringAsync(localUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const bytes = toByteArray(base64);
  const path = `${user.id}/${fileName}`;

  const { error: upErr } = await supabase.storage.from('avatars').upload(path, bytes.buffer, {
    contentType: 'image/png',
    upsert: true,
  });
  if (upErr) throw upErr;

  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  // Cache-buster: la URL pública es siempre la misma ruta, así que sin esto
  // el <Image> de React Native podría seguir enseñando la miniatura vieja
  // cacheada tras subir una nueva.
  const url = `${data.publicUrl}?v=${Date.now()}`;

  if (!updateUser) return url;

  const { error } = await supabase.from('users').update({ avatar_thumb_url: url }).eq('id', user.id);
  if (error) throw error;

  return url;
}

// ---- Selección real de avatar (Fase 4, inventario de verdad) --------------
// Avatar equipado ahora mismo (userId opcional: sin él, el tuyo). null si
// nunca eligió ninguno (perfiles de antes de este sistema) — el cliente cae
// entonces al hash determinista de siempre (ver Profile.js).
export async function getPilotAvatarId(userId) {
  const user = await ensureSession();
  const { data } = await supabase
    .from('users')
    .select('pilot_avatar_id')
    .eq('id', userId || user.id)
    .maybeSingle();
  return data?.pilot_avatar_id || null;
}

// Guarda el avatar elegido — RPC server-side (pilot_avatar_inventory.sql):
// valida que sea gratis o esté en tu inventory antes de escribirlo, mismo
// candado que save_loadout() para las piezas del coche.
//
// JC, 2026-09-17: "ya no se hace el tema de la miniatura no? si ya tenemos
// el avatar entero" — tenía razón: subir una foto a Storage (como sí hace
// falta con las piezas TEÑIDAS del coche, únicas por jugador) no sirve de
// nada con un catálogo cerrado de 14 diseños fijos, cada uno con su PNG ya
// empaquetado en la app (avatarCatalog.js). Rankings/GP ahora pintan por
// pilot_avatar_id directamente (ver AvatarThumb.js) — no hay nada que
// capturar ni subir, y de paso desaparece el hueco donde el RPC podía
// triunfar y la subida fallar después, dejando avatar_thumb_url desincroni-
// zado del pilot_avatar_id ya guardado.
export async function savePilotAvatar(avatarId) {
  await ensureSession();
  const { error } = await supabase.rpc('save_pilot_avatar', { p_avatar_id: avatarId });
  if (error) throw error;
}

// Tus mejores tiempos por día (para el gráfico de evolución del Perfil).
// Devuelve [{ day, ms }] de más antiguo a más reciente.
export async function getMyDailyHistory(limit = 30, userId) {
  const user = await ensureSession();
  const { data, error } = await supabase
    .from('attempts')
    .select('day, best_ms')
    .eq('user_id', userId || user.id)
    .order('day', { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data || [])
    .map((r) => ({ day: r.day, ms: r.best_ms }))
    .reverse();
}

// Cuántos sectores del día tienes en tu poder (los "morados" estilo F1) y
// cuántos hay en total. Es la stat de presumir: no es tu tiempo, es cuántos
// trozos del circuito de hoy son tuyos y de nadie más.
export async function getMyPurpleSectors(day = todayKey(), userId) {
  const user = await ensureSession();
  const uid = userId || user.id;
  const { data, error } = await supabase
    .from('sector_bests')
    .select('sector, holder_id')
    .eq('day', day);
  if (error) return { mine: 0, total: 0 };
  const rows = data || [];
  return { mine: rows.filter((r) => r.holder_id === uid).length, total: rows.length };
}

// Monedas ganadas en total (solo ingresos: los gastos van en negativo y no
// cuentan para "cuánto has ganado jugando").
export async function getLifetimeCoins() {
  const user = await ensureSession();
  const { data, error } = await supabase
    .from('wallet_transactions')
    .select('amount')
    .eq('user_id', user.id)
    .gt('amount', 0);
  if (error) return 0;
  return (data || []).reduce((sum, r) => sum + r.amount, 0);
}

// ---- Modo Carrera (niveles con gap) -----------------------------------------
// Nivel más alto ya superado (0 = ninguno todavía).
export async function getCareerProgress(userId) {
  const user = await ensureSession();
  const { data } = await supabase
    .from('career_progress')
    .select('cleared')
    .eq('user_id', userId || user.id)
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
    .select('user_id, users(nickname, pilot_avatar_id)')
    .eq('group_id', groupId);
  if (error) throw error;
  return (data || []).map((m) => ({
    userId: m.user_id,
    nickname: m.users?.nickname ?? '—',
    pilotAvatarId: m.users?.pilot_avatar_id ?? null,
  }));
}

// Todos los resultados clasificados de un GP (todas las rondas, todo el
// grupo) — de aquí sale la general completa, se agrega en cliente
// (computeStandings, en src/grandprix.js) igual que getLeaderboard.
export async function getGpResults(gpId) {
  await ensureSession();
  const { data, error } = await supabase
    .from('gp_results')
    .select('day_index, user_id, ms, sector_ms, users(nickname, pilot_avatar_id)')
    .eq('gp_id', gpId);
  if (error) throw error;
  return (data || []).map((r) => ({
    dayIndex: r.day_index,
    userId: r.user_id,
    nickname: r.users?.nickname ?? '—',
    pilotAvatarId: r.users?.pilot_avatar_id ?? null,
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

// Tus splits de sector del MEJOR intento que ya tienes en esta ronda del GP.
// Sirven de referencia en pista: sin mejor mundial (cada circuito es de un
// grupo) ni fantasma cargado, es lo unico contra lo que tiene sentido medirse
// dentro de una ronda donde solo cuenta tu mejor vuelta.
//
// null si aun no has clasificado en esa ronda, o si la vuelta que clasifico
// se guardo antes de que existiera la columna sector_ms.
export async function getMyGpRoundSectors(gpId, dayIndex) {
  const user = await ensureSession();
  const { data, error } = await supabase
    .from('gp_results')
    .select('sector_ms')
    .eq('gp_id', gpId)
    .eq('day_index', dayIndex)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error || !data) return null;
  return data.sector_ms ?? null;
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

// Cuántas veces ha sido cada uno 1.º del mundo (ver supabase/
// world_crowns_history.sql) — no si lo ha sido, cuántas. Una sola consulta
// por lote de userIds visibles en pantalla, no una por fila.
export async function getWorldWinCounts(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (ids.length === 0) return {};
  const { data, error } = await supabase
    .from('world_win_counts')
    .select('user_id, wins')
    .in('user_id', ids);
  if (error) return {};
  const out = {};
  for (const row of data || []) out[row.user_id] = row.wins;
  return out;
}

// Leaderboard GLOBAL escalable (miles de tiempos): NO baja todas las filas.
// Devuelve el top 6 (podio + "quién te persigue" cuando vas top-3), tu
// posición, hasta 2 vecinos a cada lado (para poder centrar la ventana de 3
// incluso en los bordes: 4.º puesto o último) y el total. Consultas ligeras
// (limit/count por best_ms). Para grupos, usa getLeaderboard.
// El puesto de HOY de un jugador concreto (perfil público de otro —
// Profile.js — no necesita el tablero entero de getGlobalBoard, solo su
// número). null si no ha jugado hoy.
export async function getPlayerRankToday(userId, day = todayKey()) {
  await ensureSession();
  const { data: mine } = await supabase
    .from('attempts').select('best_ms').eq('day', day).eq('user_id', userId).maybeSingle();
  if (!mine) return null;
  const { count } = await supabase
    .from('attempts').select('user_id', { count: 'exact', head: true })
    .eq('day', day).lt('best_ms', mine.best_ms);
  return (count ?? 0) + 1;
}

export async function getGlobalBoard(day = todayKey()) {
  const { data: { session } } = await supabase.auth.getSession();
  const myId = session?.user?.id ?? null;

  const SEL = 'best_ms, updated_at, user_id, users(nickname, current_streak, car_frame, pilot_avatar_id)';
  const mapRow = (r, rank, leaderMs) => ({
    userId: r.user_id,
    nickname: r.users?.nickname ?? '—',
    pilotAvatarId: r.users?.pilot_avatar_id ?? null,
    streak: r.users?.current_streak ?? 0,
    frame: r.users?.car_frame || 'sin_marco',
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
      .from('attempts').select('best_ms, users(nickname, current_streak, car_frame, pilot_avatar_id)')
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
        pilotAvatarId: mine.users?.pilot_avatar_id ?? null,
        streak: mine.users?.current_streak ?? 0,
        frame: mine.users?.car_frame || 'sin_marco',
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

// Página del ranking GLOBAL completo de un día, para la pestaña "Ranking"
// (a diferencia de getGlobalBoard, aquí SÍ se puede recorrer toda la lista,
// pero SIEMPRE por páginas — nunca de golpe, el motivo por el que existe
// getGlobalBoard en vez de esto para la vista compacta de Inicio).
// Devuelve también `total` (no solo la página): hace falta saber cuántos
// jugadores hay HOY para pintar las bandas de puntos por percentil (ver
// pointsForDailyRank) desde la primera página, sin esperar a haber cargado
// la lista entera.
export async function getRankingPage(day = todayKey(), offset = 0, limit = 30) {
  const { data: { session } } = await supabase.auth.getSession();
  const myId = session?.user?.id ?? null;

  const [{ count }, { data, error }] = await Promise.all([
    supabase.from('attempts').select('user_id', { count: 'exact', head: true }).eq('day', day),
    supabase
      .from('attempts')
      .select('best_ms, user_id, users(nickname, current_streak, car_frame, pilot_avatar_id)')
      .eq('day', day)
      .order('best_ms', { ascending: true })
      .range(offset, offset + limit - 1),
  ]);
  if (error) throw error;

  const rows = (data || []).map((r, i) => ({
    userId: r.user_id,
    nickname: r.users?.nickname ?? '—',
    pilotAvatarId: r.users?.pilot_avatar_id ?? null,
    streak: r.users?.current_streak ?? 0,
    frame: r.users?.car_frame || 'sin_marco',
    bestMs: r.best_ms,
    rank: offset + i + 1,
    isMe: r.user_id === myId,
  }));
  return { rows, total: count ?? 0 };
}

// Reparto por PERCENTIL, no por posición fija — una tabla de 10 valores a
// secas (índice = posición-1) solo tiene 10 huecos: con 9 jugadores reparte
// entre todos, pero con 100 el jugador 11 ya no se lleva nada nunca, por
// rápido que sea el grupo. JC, 2026-09-09: "eso habrá que adaptarlo... el
// 50% último no puntúe" — igual que la propia F1, donde puntúa la mitad
// delantera de la parrilla (10 de ~20 coches), esto reparte `tiers` (10
// valores, de mejor a peor) en 10 bandas del 5% cada una sobre el 50% mejor.
// Con 9 jugadores son ~4-5 los que entran, con 100 son 50 — la proporción no
// cambia nunca, a diferencia de un top fijo. Compartida por los puntos del
// ranking diario y las monedas del ranking del mes (mismo reparto, tablas
// de valores distintas).
function bandValue(rank, totalPlayers, tiers) {
  // Entero puro a propósito: dividir dos veces por 0.05 (que no es exacto en
  // binario) desplazaba jugadores a la banda vecina en los límites — con 20
  // jugadores, la posición 4 caía en la banda de la 3 y se quedaban dos
  // bandas sin usar. Multiplicar por 20 (bandas de 5%, 1/0.05) y dividir una
  // sola vez evita el redondeo y reproduce la tabla F1 exacta con 20.
  const band = Math.floor(((rank - 1) * 20) / totalPlayers);
  return band < tiers.length ? tiers[band] : 0;
}

export function pointsForDailyRank(rank, totalPlayers) {
  return bandValue(rank, totalPlayers, F1_POINTS);
}

// Premio en monedas de la clasificación del MES, por banda de posición
// FINAL (no por día) — JC, 2026-09-09: "tiene que ser un premio grande ya
// que es una recompensa mensual". El top casi quintuplica el premio
// semanal del Grand Prix (100, ver gp-tick) y multiplica por 16 el del
// ranking diario (30, ver close-ranking-rewards): se nota que es mensual.
export const COIN_BANDS = [500, 360, 300, 240, 200, 160, 120, 80, 40, 20];

export function coinsForMonthlyRank(rank, totalPlayers) {
  return bandValue(rank, totalPlayers, COIN_BANDS);
}

// Ranking del MES (calendario, se resetea el día 1) — puntos por percentil
// en CADA día jugado (ver pointsForDailyRank arriba), sumados a lo largo
// del mes.
//
// JC, 2026-09-09: la primera versión usaba la MEDIA de tiempo, para que
// sumar tiempos brutos no castigara a quien más juega — pero eso tenía el
// problema contrario: alguien con 6 días muy rápidos quedaba por delante de
// alguien con 9 días algo más lentos de media, cuando jugar más debería
// PREMIAR, no ser neutro. Puntos por posición resuelve las dos cosas a la
// vez: no jugar un día no resta nada (nunca hay puntos negativos, a
// diferencia de sumar tiempos), y cada día jugado de más solo puede sumar —
// así que más constancia siempre pesa más que unos pocos días sueltos,
// por rápidos que sean. No hace falta mínimo de días jugados: el propio
// sistema de puntos ya hace ese trabajo.
//
// Sin RPC ni tabla nueva: `attempts` (day, user_id, best_ms) ya tiene todo lo
// que hace falta — se trae el mes entero y se puntúa aquí, día a día. Si el
// número total de jugadores creciera mucho (miles), esto se movería a un RPC
// que agregue en el servidor, pero a la escala actual no hace falta.
export async function getMonthlyRanking(ref = new Date()) {
  const { data: { session } } = await supabase.auth.getSession();
  const myId = session?.user?.id ?? null;

  const y = ref.getFullYear(), m = ref.getMonth();
  const monthStart = new Date(y, m, 1);
  const monthEnd = new Date(y, m + 1, 1);
  const startKey = todayKey(monthStart);
  const endKey = todayKey(monthEnd);

  const { data, error } = await supabase
    .from('attempts')
    .select('user_id, day, best_ms, users(nickname, car_frame, pilot_avatar_id)')
    .gte('day', startKey)
    .lt('day', endKey);
  if (error) throw error;

  const byDay = new Map();
  for (const r of data || []) {
    if (!byDay.has(r.day)) byDay.set(r.day, []);
    byDay.get(r.day).push(r);
  }

  const byUser = new Map();
  for (const dayRows of byDay.values()) {
    dayRows.sort((a, b) => a.best_ms - b.best_ms);
    const n = dayRows.length;
    dayRows.forEach((r, i) => {
      let e = byUser.get(r.user_id);
      if (!e) {
        e = {
          userId: r.user_id,
          nickname: r.users?.nickname ?? '—',
          pilotAvatarId: r.users?.pilot_avatar_id ?? null,
          frame: r.users?.car_frame || 'sin_marco',
          points: 0,
          daysPlayed: 0,
        };
        byUser.set(r.user_id, e);
      }
      e.points += pointsForDailyRank(i + 1, n);
      e.daysPlayed += 1;
    });
  }

  // Empate a puntos: gana quien ha jugado MÁS días — mismo espíritu que el
  // resto del sistema, la constancia desempata a favor de quien más juega.
  const sorted = [...byUser.values()].sort((a, b) => b.points - a.points || b.daysPlayed - a.daysPlayed);
  const totalPlayers = sorted.length;
  const rows = sorted.map((e, i) => ({
    ...e,
    rank: i + 1,
    isMe: e.userId === myId,
    coins: coinsForMonthlyRank(i + 1, totalPlayers),
  }));

  return { rows };
}

// Busca jugadores por nombre (parcial, sin mayúsculas) en el ranking de hoy
// y devuelve sus filas YA con el puesto calculado (mismo criterio que
// getGlobalBoard: cuántos van por delante + 1). Pensado para "¿en qué
// puesto va fulano?" sin tener que pasar página a página hasta encontrarlo.
export async function searchRanking(query, day = todayKey()) {
  const clean = (query || '').trim();
  if (!clean) return [];
  const { data: { session } } = await supabase.auth.getSession();
  const myId = session?.user?.id ?? null;

  const { data: matches, error } = await supabase
    .from('attempts')
    .select('best_ms, user_id, users!inner(nickname, current_streak, car_frame, pilot_avatar_id)')
    .eq('day', day)
    .ilike('users.nickname', `%${clean}%`)
    .limit(10);
  if (error) throw error;

  const results = await Promise.all((matches || []).map(async (r) => {
    const { count } = await supabase
      .from('attempts')
      .select('user_id', { count: 'exact', head: true })
      .eq('day', day)
      .lt('best_ms', r.best_ms);
    return {
      userId: r.user_id,
      nickname: r.users?.nickname ?? '—',
      pilotAvatarId: r.users?.pilot_avatar_id ?? null,
      streak: r.users?.current_streak ?? 0,
      frame: r.users?.car_frame || 'sin_marco',
      bestMs: r.best_ms,
      rank: (count ?? 0) + 1,
      isMe: r.user_id === myId,
    };
  }));
  return results.sort((a, b) => a.rank - b.rank);
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
    .select('best_ms, updated_at, user_id, users(nickname, current_streak, car_frame, pilot_avatar_id)')
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
      pilotAvatarId: r.users?.pilot_avatar_id ?? null,
      streak: r.users?.current_streak ?? 0,
      frame: r.users?.car_frame || 'sin_marco',
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

// ---- Duelos 1vs1 -------------------------------------------------------------
// Reto directo con apuesta entre dos jugadores (duels.sql). Nadie ve la
// traza del rival mientras corre — solo al terminar los DOS se puede pedir
// el reveal (getDuelReveal). Ver el plan completo:
// ver supabase/duels.sql para las reglas de servidor (cobro solo al
// aceptar, empate devuelve la apuesta, plazos de 10min/15min).

// Mismo mapeo de columnas car_* -> loadout que getMyLoadout/getLeaderRun
// (arriba) — no se tocan esas dos para no arriesgar código ya en
// producción, pero el reveal necesita construir DOS loadouts a la vez, así
// que aquí sí vale la pena no triplicar la lista de columnas a mano.
function loadoutFromRow(who) {
  if (!who) return { ...CAR_DEFAULTS };
  return {
    chassis: who.car_chassis || CAR_DEFAULTS.chassis,
    frame: who.car_frame || CAR_DEFAULTS.frame,
    bodyColor: who.car_body_color || CAR_DEFAULTS.bodyColor,
    wingShape: who.car_wing_shape || CAR_DEFAULTS.wingShape,
    wingColor: who.car_wing_color || CAR_DEFAULTS.wingColor,
    livery: who.car_livery,
    liveryPattern: who.car_livery_pattern || CAR_DEFAULTS.liveryPattern,
    lightsColor: who.car_lights_color || CAR_DEFAULTS.lightsColor,
  };
}

// Lanza el reto — sin mover monedas todavía (se cobra al aceptar). Avisa al
// rival por push (fire-and-forget: si la notificación falla, el reto ya
// quedó creado igualmente, se verá al abrir la app).
export async function createDuel(opponentId, wager) {
  await ensureSession();
  const { data, error } = await supabase.rpc('create_duel', {
    p_opponent_id: opponentId,
    p_wager: Math.round(wager),
  });
  if (error) throw error;
  try {
    await supabase.functions.invoke('notify-duel-challenge', { body: { duelId: data, kind: 'challenge' } });
  } catch (_) {
    // sin conexión / función no desplegada -> se ignora, mismo criterio que notifyOvertakes
  }
  return data;
}

// Acepta el reto — aquí es donde de verdad se cobra la apuesta a los dos
// (ver accept_duel en duels.sql). Devuelve el plazo para correr.
export async function acceptDuel(duelId) {
  await ensureSession();
  const { error } = await supabase.rpc('accept_duel', { p_duel_id: duelId });
  if (error) throw error;
  try {
    await supabase.functions.invoke('notify-duel-challenge', { body: { duelId, kind: 'accepted' } });
  } catch (_) {}
}

export async function declineDuel(duelId) {
  await ensureSession();
  const { error } = await supabase.rpc('decline_duel', { p_duel_id: duelId });
  if (error) throw error;
}

// Sube tu vuelta del duelo — mismo shape de traza que submitDailyRun. Si el
// rival ya había corrido, el servidor liquida el duelo en el momento y esta
// misma llamada devuelve ya el resultado (evita una segunda ida y vuelta).
export async function submitDuelRun(duelId, ms, trace) {
  await ensureSession();
  const { data, error } = await supabase.rpc('submit_duel_run', {
    p_duel_id: duelId,
    p_ms: Math.round(ms),
    p_trace: trace,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    duelStatus: row?.duel_status ?? 'accepted',
    winnerId: row?.winner_id ?? null,
    opponentDone: !!row?.opponent_done,
  };
}

// Un duelo concreto con los datos de las dos partes ya listos para pintar
// (decisión de aceptar/rechazar, o pantalla de espera). `myId` se usa para
// que el cliente no tenga que volver a mirar quién es quién.
export async function getDuel(duelId) {
  const user = await ensureSession();
  const { data: duel, error } = await supabase
    .from('duels')
    .select('id, challenger_id, opponent_id, wager, status, accept_deadline, accepted_at, race_deadline, winner_id')
    .eq('id', duelId)
    .maybeSingle();
  if (error) throw error;
  if (!duel) return null;

  const { data: people } = await supabase
    .from('users')
    .select('id, nickname, pilot_avatar_id')
    .in('id', [duel.challenger_id, duel.opponent_id]);
  const byId = new Map((people || []).map((p) => [p.id, p]));
  const challenger = byId.get(duel.challenger_id);
  const opponent = byId.get(duel.opponent_id);

  return {
    id: duel.id,
    myId: user.id,
    challengerId: duel.challenger_id,
    opponentId: duel.opponent_id,
    wager: duel.wager,
    status: duel.status,
    acceptDeadline: duel.accept_deadline,
    acceptedAt: duel.accepted_at,
    raceDeadline: duel.race_deadline,
    winnerId: duel.winner_id,
    challengerName: challenger?.nickname || '—',
    challengerAvatarId: challenger?.pilot_avatar_id || null,
    opponentName: opponent?.nickname || '—',
    opponentAvatarId: opponent?.pilot_avatar_id || null,
  };
}

// Retos que me han hecho y siguen pendientes de mi respuesta — para la
// insignia en el perfil propio (mismo criterio visual que
// wallet.pendingPacks: un punto, no un número).
export async function getMyPendingDuels() {
  const user = await ensureSession();
  const { data } = await supabase
    .from('duels')
    .select('id, challenger_id, wager, created_at')
    .eq('opponent_id', user.id)
    .eq('status', 'pending')
    .gt('accept_deadline', new Date().toISOString())
    .order('created_at', { ascending: false });
  const rows = data || [];
  if (rows.length === 0) return [];

  // Dos consultas en vez de un embed de PostgREST: duels tiene DOS foreign
  // keys a users (challenger_id/opponent_id), y el embed sin desambiguar
  // (`users(nickname)`) es justo el caso que PostgREST no puede resolver
  // solo — más simple traer los nombres aparte y cruzar en cliente, mismo
  // patrón que getDuel/getDuelReveal.
  const { data: people } = await supabase
    .from('users')
    .select('id, nickname')
    .in('id', rows.map((d) => d.challenger_id));
  const byId = new Map((people || []).map((p) => [p.id, p]));

  return rows.map((d) => ({
    id: d.id,
    challengerId: d.challenger_id,
    challengerName: byId.get(d.challenger_id)?.nickname || '—',
    wager: d.wager,
  }));
}

// Las dos trazas ya terminadas + loadout/nombre de cada uno, para el reveal
// lado a lado. null si el duelo aún no está 'finished' (nada que enseñar
// todavía) o si falta alguna traza.
export async function getDuelReveal(duelId) {
  const { data: duel } = await supabase
    .from('duels')
    .select('id, challenger_id, opponent_id, wager, status, winner_id')
    .eq('id', duelId)
    .maybeSingle();
  if (!duel || duel.status !== 'finished') return null;

  const { data: runs } = await supabase
    .from('duel_runs')
    .select('user_id, ms, trace')
    .eq('duel_id', duelId);
  const byUser = new Map((runs || []).map((r) => [r.user_id, r]));
  const challengerRun = byUser.get(duel.challenger_id);
  const opponentRun = byUser.get(duel.opponent_id);
  if (!challengerRun || !opponentRun) return null;

  const { data: people } = await supabase
    .from('users')
    .select('id, nickname, car_chassis, car_frame, car_body_color, car_wing_shape, car_wing_color, car_livery, car_livery_pattern, car_lights_color')
    .in('id', [duel.challenger_id, duel.opponent_id]);
  const byId = new Map((people || []).map((p) => [p.id, p]));

  const sideFor = (userId, run) => ({
    userId,
    nickname: byId.get(userId)?.nickname || '—',
    ms: run.ms,
    trace: run.trace,
    loadout: loadoutFromRow(byId.get(userId)),
  });

  return {
    wager: duel.wager,
    winnerId: duel.winner_id,
    challenger: sideFor(duel.challenger_id, challengerRun),
    opponent: sideFor(duel.opponent_id, opponentRun),
  };
}

// ---- Presencia ("en línea") --------------------------------------------------
// Late al servidor cada ~60s mientras la app está en primer plano (ver el
// AppState listener en App.js). Fire-and-forget de verdad: nunca debe
// bloquear ni avisar de error, es puro adorno de UI.
export async function touchPresence() {
  try {
    await ensureSession();
    await supabase.rpc('touch_presence');
  } catch (_) {}
}

// "En línea" es una aproximación por sondeo (no hay tiempo real en este
// proyecto): el cliente decide el umbral, esta función solo trae los
// last_seen crudos. Devuelve un Map(userId -> Date) para lookup O(1) fila a
// fila en las listas de ranking.
export async function getPresenceMap(userIds) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return new Map();
  const { data } = await supabase.from('presence').select('user_id, last_seen').in('user_id', ids);
  return new Map((data || []).map((p) => [p.user_id, new Date(p.last_seen)]));
}
