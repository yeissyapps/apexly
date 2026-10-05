// ============================================================================
//  Reto del día — un objetivo secundario, el mismo para todos, que cambia cada
//  día y paga +15 monedas una vez (JC, 2026-10-05: "el circuito diario siento
//  que es prácticamente lo mismo todos los días").
//
//  Todos los retos son RELATIVOS — a ti mismo o a otro jugador — y ninguno
//  depende de bajar del "objetivo" del circuito: medido con los tiempos de
//  septiembre, ni el 1.º del día bajaba de él en la mitad de los días (el
//  clima lo hace imposible algunos días), así que un reto absoluto sería
//  injusto según el tiempo que haga.
//
//  Tampoco depende de ganar el día: la idea es que haya algo que conseguir
//  aunque haya alguien imbatible arriba del todo.
//
//  Se decide en el cliente, como los tiempos; el servidor solo garantiza que
//  se cobra una vez (supabase/day_challenge.sql).
// ============================================================================

import AsyncStorage from '@react-native-async-storage/async-storage';

import { claimDayChallenge, countPassed, ensureSession, getBestOn, getMonthlyRanking, isDayChallengeClaimed } from './api';

export const DAY_CHALLENGE_COINS = 15;

// Mejora mínima del reto "medio segundo".
const MEDIO_MS = 500;

const DEFS = {
  rival: {
    title: (c) => (c.rival ? `Bate a ${c.rival.nickname}` : 'Bate a tu rival del mes'),
    desc: 'Tu rival del mes es quien va justo por delante de ti en la clasificación. Haz hoy mejor tiempo que su mejor vuelta.',
  },
  adelanta: {
    title: () => 'Adelanta a alguien',
    desc: 'Mejora tu tiempo de hoy y sube al menos un puesto en el ranking del día.',
  },
  limpia: {
    title: () => 'Récord sin tocar el muro',
    desc: 'Mejora tu tiempo de hoy con una vuelta en la que no toques el muro ni una vez.',
  },
  sectores: {
    title: () => 'Tres sectores mejores',
    desc: 'Bate a tu fantasma en los tres sectores de la misma vuelta: los tres en verde o morado.',
  },
  medio: {
    title: () => 'Medio segundo',
    desc: 'Mejora en medio segundo tu primera vuelta del día.',
  },
};

// Ciclo de 7 días: el de rival sale 2 veces y el de adelantar otras 2 — los
// que dependen de otros jugadores son los que más cuestan y más enganchan.
const CYCLE = ['rival', 'limpia', 'adelanta', 'sectores', 'rival', 'medio', 'adelanta'];

function dayNumber(dayKey) {
  const [y, m, d] = dayKey.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

export function challengeIdFor(dayKey) {
  return CYCLE[dayNumber(dayKey) % CYCLE.length];
}

// ---- Estado local del día ---------------------------------------------------
// { rival: {userId, nickname} | null, rivalResolved, firstMs, done }
const key = (day) => `dayChallenge:v1:${day}`;

async function loadState(day) {
  try {
    const raw = await AsyncStorage.getItem(key(day));
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

async function saveState(day, st) {
  try { await AsyncStorage.setItem(key(day), JSON.stringify(st)); } catch (_) {}
}

// El rival se fija UNA vez al día (si no, cambiaría a media tarde cada vez que
// se mueve la clasificación): quien va justo por delante en el ranking del
// mes; si vas 1.º, el 2.º; si aún no estás en la clasificación, el último.
// Sin nadie más en la clasificación (día 1 del mes a primera hora), no hay
// rival y el reto pasa a ser "adelanta a alguien".
async function resolveRival(st) {
  if (st.rivalResolved) return;
  const { rows } = await getMonthlyRanking();
  const idx = rows.findIndex((r) => r.isMe);
  let pick = null;
  if (idx > 0) pick = rows[idx - 1];
  else if (idx === 0) pick = rows[1] || null;
  else if (rows.length) pick = rows[rows.length - 1];
  st.rival = pick ? { userId: pick.userId, nickname: pick.nickname } : null;
  st.rivalResolved = true;
}

function effectiveId(id, st) {
  return id === 'rival' && st.rivalResolved && !st.rival ? 'adelanta' : id;
}

function view(day, id, st, extra = {}) {
  const c = { day, id, rival: st.rival || null, firstMs: st.firstMs ?? null, done: !!st.done, ...extra };
  c.title = DEFS[id].title(c);
  c.desc = DEFS[id].desc;
  c.coins = DAY_CHALLENGE_COINS;
  return c;
}

// Cobra y marca como cumplido. Si el cobro falla (red, o el SQL aún sin
// correr) NO se marca: se volverá a intentar en la siguiente comprobación.
async function complete(day, st) {
  await claimDayChallenge(day);
  st.done = true;
  await saveState(day, st);
}

// Tiempos del reto de rival: el tuyo y el suyo de hoy. Si ya vas por delante
// cuenta como cumplido aunque no acabes de correr (p. ej. el rival corrió
// DESPUÉS que tú y quedó por detrás).
async function rivalTimes(day, st) {
  const me = await ensureSession();
  const [myMs, rivalMs] = await Promise.all([getBestOn(me.id, day), getBestOn(st.rival.userId, day)]);
  return { myMs, rivalMs };
}

// Para Inicio: qué reto toca hoy y en qué estado está. Comprueba de paso el
// de rival, que se puede cumplir sin correr (ver rivalTimes). `justDone` =
// se acaba de cumplir en esta llamada (para refrescar el saldo).
export async function loadDayChallenge(day) {
  const st = await loadState(day);
  let id = challengeIdFor(day);
  if (!st.done && (await isDayChallengeClaimed(day))) {
    st.done = true;
    await saveState(day, st);
  }
  if (id === 'rival') {
    try { await resolveRival(st); await saveState(day, st); } catch (_) {}
  }
  id = effectiveId(id, st);
  if (id !== 'rival' || !st.rival) return view(day, id, st);

  let times = {};
  try { times = await rivalTimes(day, st); } catch (_) {}
  let justDone = false;
  if (!st.done && times.myMs != null && times.rivalMs != null && times.myMs < times.rivalMs) {
    try { await complete(day, st); justDone = true; } catch (_) {}
  }
  return view(day, id, st, { ...times, justDone });
}

// Tras una vuelta del Diario YA guardada en el servidor. `lap`:
// { ms, isBest, prevMs, impacts, sectorColors, sectorDeltas }.
export async function checkDayChallenge(day, lap) {
  const st = await loadState(day);
  // Primera vuelta del día (para "medio segundo"). Si ya habías corrido hoy
  // antes de tener esta versión, tu mejor marca previa hace de punto de partida.
  if (st.firstMs == null) {
    st.firstMs = lap.prevMs ?? lap.ms;
    await saveState(day, st);
  }
  let id = challengeIdFor(day);
  if (id === 'rival') {
    try { await resolveRival(st); await saveState(day, st); } catch (_) {}
  }
  id = effectiveId(id, st);

  let met = false;
  let extra = {};
  if (id === 'rival') {
    if (st.rival) {
      try { extra = await rivalTimes(day, st); } catch (_) {}
      met = extra.myMs != null && extra.rivalMs != null && extra.myMs < extra.rivalMs;
    }
  } else if (id === 'adelanta') {
    if (lap.isBest && lap.prevMs != null) {
      try { met = (await countPassed(lap.ms, lap.prevMs, day)) > 0; } catch (_) {}
    }
  } else if (id === 'limpia') {
    met = !!lap.isBest && lap.prevMs != null && lap.impacts === 0;
  } else if (id === 'sectores') {
    const cols = lap.sectorColors || [];
    const deltas = lap.sectorDeltas || [];
    // Sin fantasma (primera vuelta del día) todos los sectores salen verdes
    // porque no hay contra qué comparar: el delta null lo delata.
    met = cols.length >= 3
      && deltas.length === cols.length
      && deltas.every((d) => d != null)
      && cols.every((c) => c === 'purple' || c === 'green');
  } else if (id === 'medio') {
    met = lap.ms <= st.firstMs - MEDIO_MS;
  }

  let justDone = false;
  if (met && !st.done) {
    try { await complete(day, st); justDone = true; } catch (_) {}
  }
  return view(day, id, st, { ...extra, justDone });
}
