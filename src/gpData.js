// ============================================================================
//  Grand Prix — helpers compartidos, mismo rol que career.js: un solo sitio
//  para la generación de circuitos/clima (deterministas por semilla) y el
//  cálculo de puntos, para que cliente y servidor (que valida antes de la
//  RPC) usen exactamente los mismos criterios.
//
//  NOTA de nombre: este archivo se llamaba src/grandprix.js, pero en Windows
//  (NTFS, case-insensitive) eso colisiona con src/GrandPrix.js (el archivo de
//  pantallas) — el segundo Write pisó al primero sin avisar. Se renombra a
//  gpData.js para que no puedan volver a chocar.
// ============================================================================

import { tieredCircuit } from './generator';
import { dailyWeather } from './weather';
import { CLOSED_COMBOS, CLOSED_COMBO_LIST, buildClosedCombo } from './pieces';

export function gpSeed(gpId, dayIndex) {
  return 'gp-' + gpId + '-' + dayIndex;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Ronda "de hoy" a partir de started_at — no medianoche, la hora EXACTA en
// que arrancó el GP (JC: "si se arranca un lunes a las 12:15, todos los días
// aparece circuito nuevo a las 12:15"). 1-indexado, con tope en circuit_count.
export function currentRoundIndex(gp) {
  if (!gp) return null;
  const elapsed = Date.now() - new Date(gp.started_at).getTime();
  const idx = Math.floor(elapsed / DAY_MS) + 1;
  return Math.max(1, Math.min(gp.circuit_count, idx));
}

// Cuándo abre la SIGUIENTE ronda (para la cuenta atrás) — null si ya se jugó
// la última.
export function nextRoundUnlockAt(gp) {
  if (!gp) return null;
  const idx = currentRoundIndex(gp);
  if (idx >= gp.circuit_count) return null;
  return new Date(gp.started_at).getTime() + idx * DAY_MS;
}

// El GP termina cuando pasan circuit_count días desde el arranque (aunque el
// campo `status` del servidor tarde en marcarlo 'finished' — el cron lo hace
// cada 15 min, esto es la verdad inmediata en cliente).
export function gpFinished(gp) {
  if (!gp) return false;
  return Date.now() >= new Date(gp.started_at).getTime() + gp.circuit_count * DAY_MS;
}

// Un anuncio en el GP da +1 intento (JC, 2026-09-09: "puedes ver un vídeo y
// tener un intento más, no 3 intentos más" — antes daba +3, como Carrera; el
// GP es una carrera de 3 vueltas, mucho más cara en tiempo que un intento
// suelto de Diario/Carrera, así que +1 ya es un premio real).
export const GP_AD_BATCH = 1;

// Modo "calentar primero" del GP: 1 intento de prueba (no clasifica) + 1 que
// SÍ clasifica — no 2+1 como Diario/Carrera (JC, 2026-09-09: "eso ya no es
// así, solo tendrás un intento de prueba"). Ver isPractice en App.js
// (handleGpFinish) y gpLeftFor, que ya lo usan.
export const GP_FREE_ATTEMPTS = 2;

// Rampa de dificultad MÁS SUAVE que Modo Carrera (t 0.2 -> 0.6, no 0 -> 1):
// un GP es un evento de una semana entre amigos, no una escalera de progreso
// — la ronda 1 tiene que ser accesible el primer día y la 7 tener más mordida,
// sin llegar a los tiers más duros que sí tiene sentido reservar para Carrera.
// BETA (2026-09-07): las rondas del Grand Prix usan ahora los circuitos
// CERRADOS de 3 vueltas (ver CLOSED_COMBOS en pieces.js), en vez del
// generador abierto de siempre — a petición explícita de JC, SOLO para el
// Grand Prix: el Diario y Modo Carrera siguen con `tieredCircuit`/
// `dailyCircuit` tal cual, sin tocar. Reparto determinista por ronda (misma
// ronda -> mismo circuito siempre, sin necesitar semilla): con 8 diseños y
// como mucho `circuitCount` rondas, cada grupo ve una selección fija en
// orden — sencillo y suficiente para probar el formato antes de decidir si
// hace falta variar por grupo.
export function gpCircuitSpec(gpId, dayIndex, circuitCount = 7) {
  const comboId = CLOSED_COMBO_LIST[(dayIndex - 1) % CLOSED_COMBO_LIST.length];
  const combo = CLOSED_COMBOS[comboId];
  const track = buildClosedCombo(comboId, 3);
  return {
    track,
    label: `${combo.name} · 3 vueltas`,
    half: combo.half,
    timeEstimate: Math.round((track.lapLength / 250) * 3),
  };
}

// Generador anterior (circuito abierto de una vuelta), conservado por si se
// quiere volver a comparar o hace falta para otro modo — no se usa ya para
// las rondas del Grand Prix.
export function gpCircuitSpecOpen(gpId, dayIndex, circuitCount = 7) {
  const tt = (dayIndex - 1) / Math.max(1, circuitCount - 1);
  const t = 0.2 + 0.4 * tt;
  return tieredCircuit(gpSeed(gpId, dayIndex), t);
}

// Clima determinista por ronda (misma semilla que el circuito, distinta
// función) — variedad gratis, sin generador propio.
export function gpWeather(gpId, dayIndex) {
  return dailyWeather(gpSeed(gpId, dayIndex));
}

// Nombre de ronda con carácter, reutilizando la etiqueta que ya calcula el
// generador (Horquillas/Chicanes/Técnico/...) en vez de "Circuito 3" a secas.
export function roundLabel(dayIndex, spec) {
  return `Ronda ${dayIndex} · ${spec.label}`;
}

// Tabla de puntos F1 estándar. Solo puntúan las 10 primeras posiciones —
// igual que la F1 real con más de 10 pilotos, así que un grupo de 5 usa solo
// los 5 primeros escalones y uno de 12+ dos se quedan sin puntuar, sin que
// haga falta reescalar nada según el tamaño del grupo.
export const F1_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

// Punto extra por vuelta rápida de la ronda (JC, 2026-09-09) — mismo espíritu
// que la F1 real: un punto de premio, no reemplaza la puntuación por posición.
export const FASTEST_LAP_POINT = 1;

// sectorMs de un resultado de GP = 9 valores en orden vuelta-mayor (3
// sectores × 3 vueltas, ver src/pieces.js/Game.js) — el tiempo de cada
// vuelta es la suma de su propio trío. Filas antiguas (de antes de este
// cambio, con solo 3 valores) devuelven un único "lap" = la suma de los 3,
// que sigue siendo su mejor aproximación razonable. Compartida entre
// GrandPrix.js (banner/panel de vuelta rápida) y computeStandings de aquí
// abajo — un solo criterio, cliente y servidor (gp-tick) deben coincidir.
export function lapTimesFromSectorMs(sectorMs) {
  if (!sectorMs || sectorMs.length === 0) return [];
  const laps = [];
  for (let i = 0; i * 3 < sectorMs.length; i++) {
    const trio = sectorMs.slice(i * 3, i * 3 + 3);
    if (trio.length === 0) break;
    laps.push(trio.reduce((a, b) => a + b, 0));
  }
  return laps;
}

// Agrega resultados crudos (de getGpResults) en la general del campeonato.
// `members`: [{ userId, nickname }] — TODOS los del grupo, para que aparezca
// hasta quien aún no ha clasificado ningún tiempo (con 0 puntos). Quien no
// corrió una ronda concreta simplemente no ocupa puesto ese día (JC: "cero
// puntos ese circuito", el resto se reparte solo entre quien sí clasificó).
// Devuelve un array ordenado por puntos desc: { userId, nickname, points,
// rounds: { [dayIndex]: { ms, pos, pts, fastestLap } } }.
export function computeStandings(results, members) {
  const byUser = new Map();
  const ensure = (userId, nickname, pilotAvatarId) => {
    if (!byUser.has(userId)) {
      byUser.set(userId, { userId, nickname, pilotAvatarId: pilotAvatarId ?? null, points: 0, rounds: {} });
    }
    return byUser.get(userId);
  };
  (members || []).forEach((m) => ensure(m.userId, m.nickname, m.pilotAvatarId));

  const byDay = new Map();
  (results || []).forEach((r) => {
    if (!byDay.has(r.dayIndex)) byDay.set(r.dayIndex, []);
    byDay.get(r.dayIndex).push(r);
  });

  for (const [dayIndex, rows] of byDay) {
    const sorted = [...rows].sort((a, b) => a.ms - b.ms);
    sorted.forEach((r, i) => {
      const pts = F1_POINTS[i] || 0;
      const u = ensure(r.userId, r.nickname, r.pilotAvatarId);
      u.points += pts;
      u.rounds[dayIndex] = { ms: r.ms, pos: i + 1, pts, fastestLap: false };
    });

    // Vuelta rápida de la ronda: la más corta de TODAS las vueltas de TODOS
    // (no el tiempo total) — mismo criterio que fastestLap en GrandPrix.js.
    // +1 punto además de los de posición, y se marca en la celda de esa
    // ronda para el emblema morado de RoundStrip.
    let best = null;
    for (const r of rows) {
      for (const lap of lapTimesFromSectorMs(r.sectorMs)) {
        if (best == null || lap < best.ms) best = { ms: lap, userId: r.userId };
      }
    }
    if (best) {
      const u = byUser.get(best.userId);
      if (u) {
        u.points += FASTEST_LAP_POINT;
        // También en el desglose de la ronda, para que el número de la
        // celda (RoundStrip) sume igual que el total de la general.
        if (u.rounds[dayIndex]) {
          u.rounds[dayIndex].pts += FASTEST_LAP_POINT;
          u.rounds[dayIndex].fastestLap = true;
        }
      }
    }
  }

  return [...byUser.values()].sort((a, b) => b.points - a.points);
}
